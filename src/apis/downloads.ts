
import { SettingsAPI } from './settings';

export type DownloadState = 'in_progress' | 'interrupted' | 'complete';
export type DownloadDangerType =
  | 'safe' | 'file' | 'url' | 'content' | 'uncommon' | 'host'
  | 'unwanted' | 'accepted' | 'allowlistedByPolicy' | 'asyncScanning';
export type DownloadInterruptReason =
  | 'FILE_FAILED' | 'FILE_ACCESS_DENIED' | 'FILE_NO_SPACE'
  | 'FILE_NAME_TOO_LONG' | 'FILE_TOO_LARGE' | 'FILE_VIRUS_INFECTED'
  | 'FILE_TRANSIENT_ERROR' | 'FILE_BLOCKED' | 'FILE_SECURITY_CHECK_FAILED'
  | 'FILE_TOO_SHORT' | 'FILE_HASH_MISMATCH'
  | 'NETWORK_FAILED' | 'NETWORK_TIMEOUT' | 'NETWORK_DISCONNECTED'
  | 'NETWORK_SERVER_DOWN' | 'NETWORK_INVALID_REQUEST'
  | 'SERVER_FAILED' | 'SERVER_NO_RANGE' | 'SERVER_BAD_CONTENT'
  | 'SERVER_UNAUTHORIZED' | 'SERVER_CERT_PROBLEM' | 'SERVER_FORBIDDEN'
  | 'SERVER_UNREACHABLE' | 'SERVER_CONTENT_LENGTH_MISMATCH'
  | 'SERVER_CROSS_ORIGIN_REDIRECT'
  | 'USER_CANCELED' | 'USER_SHUTDOWN'
  | 'CRASH';

export interface DownloadOptions {
  /** Source URL. */
  url: string;
  /** Suggested filename. The provider may override. */
  filename?: string;
  /** HTTP method. */
  method?: 'GET' | 'POST';
  /** Optional headers. */
  headers?: Array<{ name: string; value: string }>;
  /** Optional body for POST. */
  body?: string;
  /** Save dialog behavior: 'uniquify' (default), 'overwrite', 'prompt'. */
  conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
  /** Prompt for save location even if user has default set. */
  saveAs?: boolean;
  /** Provider name to route through. Defaults to first registered. */
  provider?: string;
}

/**
 * One download in the manager. Roughly mirrors Chrome's DownloadItem.
 */
export interface DownloadItem {
  id: number;
  url: string;
  finalUrl: string;
  referrer: string;
  filename: string;
  /** Inferred MIME type. */
  mime: string;
  /** When the download started, epoch ms. */
  startTime: number;
  /** When the download ended, epoch ms (if finished). */
  endTime?: number;
  state: DownloadState;
  paused: boolean;
  canResume: boolean;
  error?: DownloadInterruptReason;
  /** Bytes received so far. */
  bytesReceived: number;
  /** Total bytes, or -1 if unknown. */
  totalBytes: number;
  /** Bytes that won't be received (e.g. canceled mid-flight). */
  fileSize: number;
  /** Whether the file exists on disk (relevant for non-web providers). */
  exists: boolean;
  /** Provider that owns this download. */
  providerName: string;
  /** Danger classification (informational only). */
  danger: DownloadDangerType;
}

export interface DownloadController {
  /** Report progress. `totalBytes: -1` for unknown total. */
  reportProgress(received: number, totalBytes: number): void;
  /** Report successful completion. */
  reportComplete(finalUrl?: string, filename?: string): void;
  /** Report failure with a Chrome-compatible interrupt reason. */
  reportError(reason: DownloadInterruptReason): void;
  /** The current item; provider can read but should not mutate directly. */
  readonly item: Readonly<DownloadItem>;
}

export interface DownloadProvider {
  /** Stable identifier; used for `options.provider` selection. */
  readonly name: string;
  /**
   * Start a download. Called by the manager after the item has been
   * allocated. The provider may resolve synchronously or async; it
   * must use the controller to report progress + completion.
   *
   * Optional: return a per-download cancel/pause/resume tuple. The
   * manager calls those instead of the class methods if provided.
   */
  start(
    options: DownloadOptions,
    controller: DownloadController,
  ):
    | void
    | Promise<void>
    | { pause?: () => void; resume?: () => void; cancel?: () => void }
    | Promise<{ pause?: () => void; resume?: () => void; cancel?: () => void }>;

  /** Optional class-level controls applied to any download owned by the provider. */
  pause?(id: number): void;
  resume?(id: number): void;
  cancel?(id: number): void;

  /** Optional bulk-list method (e.g. native platforms enumerate disk). */
  listFiles?(): Promise<DownloadItem[]>;
}

export type DownloadChangeEvent =
  | { type: 'created'; item: DownloadItem }
  | { type: 'changed'; delta: DownloadChangeDelta }
  | { type: 'erased'; id: number };

export interface DownloadChangeDelta {
  id: number;
  state?: { previous: DownloadState; current: DownloadState };
  paused?: { previous: boolean; current: boolean };
  bytesReceived?: { previous: number; current: number };
  totalBytes?: { previous: number; current: number };
  filename?: { previous: string; current: string };
  error?: { previous?: DownloadInterruptReason; current: DownloadInterruptReason };
  endTime?: { previous?: number; current: number };
}

/**
 * Singleton. Manages providers + downloads + history persistence.
 */
export class DownloadsManager {
  private static instance: DownloadsManager | null = null;
  public static getInstance(): DownloadsManager {
    if (!DownloadsManager.instance) DownloadsManager.instance = new DownloadsManager();
    return DownloadsManager.instance;
  }

  private providers = new Map<string, DownloadProvider>();
  private defaultProviderName: string | null = null;
  private items = new Map<number, DownloadItem>();
  private perItemControl = new Map<
    number,
    { pause?: () => void; resume?: () => void; cancel?: () => void }
  >();
  private nextId = 1;

  private readonly store = new SettingsAPI('/data/downloads.json', '/data');
  private readonly storageKey = 'downloads';
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  private readonly changeListeners = new Set<(e: DownloadChangeEvent) => void>();

  /** Subscribe to lifecycle events. Returns unsubscribe. */
  addChangeListener(fn: (e: DownloadChangeEvent) => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  private emit(event: DownloadChangeEvent): void {
    for (const fn of this.changeListeners) {
      try { fn(event); } catch (err) { console.warn('[DownloadsManager] listener threw:', err); }
    }
  }

  /**
   * Register a provider. The first registered provider becomes the
   * default. To explicitly set the default, call
   * `setDefaultProvider(name)` afterward.
   */
  registerProvider(provider: DownloadProvider): () => void {
    this.providers.set(provider.name, provider);
    if (!this.defaultProviderName) this.defaultProviderName = provider.name;
    return () => {
      this.providers.delete(provider.name);
      if (this.defaultProviderName === provider.name) {
        const next = this.providers.keys().next();
        this.defaultProviderName = next.done ? null : next.value;
      }
    };
  }

  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`DownloadsManager: no provider named "${name}"`);
    }
    this.defaultProviderName = name;
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) { await this.loadPromise; return; }
    this.loadPromise = this.loadFromStorage();
    try { await this.loadPromise; } finally { this.loadPromise = null; }
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const raw = await this.store.getItem<DownloadItem[]>(this.storageKey);
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item?.id !== 'number') continue;
          this.items.set(item.id, item);
          if (item.id >= this.nextId) this.nextId = item.id + 1;
        }
      }
    } catch (err) {
      console.warn('[DownloadsManager] loadFromStorage failed:', err);
    } finally {
      this.loaded = true;
    }
  }

  private enqueueWrite(): void {
    this.writeQueue = this.writeQueue.then(() => this.saveToStorage());
  }

  private async saveToStorage(): Promise<void> {
    try {
      await this.store.setItem(this.storageKey, [...this.items.values()]);
    } catch (err) {
      console.warn('[DownloadsManager] saveToStorage failed:', err);
    }
  }

  /**
   * Programmatic start (called by `chrome.downloads.download` and by
   * the Scramjet plugin when a navigation triggers a download).
   * Returns the allocated id immediately; progress/completion arrives
   * via the change-listener stream.
   */
  async startDownload(options: DownloadOptions): Promise<number> {
    await this.ensureLoaded();
    const providerName = options.provider ?? this.defaultProviderName;
    if (!providerName) {
      throw new Error('DownloadsManager: no provider registered');
    }
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`DownloadsManager: unknown provider "${providerName}"`);
    }
    const id = this.nextId++;
    const item: DownloadItem = {
      id,
      url: options.url,
      finalUrl: options.url,
      referrer: '',
      filename: options.filename ?? inferFilenameFromUrl(options.url),
      mime: inferMimeFromUrl(options.url),
      startTime: Date.now(),
      state: 'in_progress',
      paused: false,
      canResume: false,
      bytesReceived: 0,
      totalBytes: -1,
      fileSize: -1,
      exists: false,
      providerName,
      danger: 'safe',
    };
    this.items.set(id, item);
    this.emit({ type: 'created', item: { ...item } });
    (globalThis as any).__ddxNotify?.(`Download started: ${item.filename}`, { time: 3000 });
    this.enqueueWrite();

    const controller: DownloadController = {
      item,
      reportProgress: (received, totalBytes) => this.applyProgress(id, received, totalBytes),
      reportComplete: (finalUrl, filename) => this.applyComplete(id, finalUrl, filename),
      reportError: (reason) => this.applyError(id, reason),
    };
    try {
      const result = await provider.start(options, controller);
      if (result && typeof result === 'object') {
        this.perItemControl.set(id, result);
      }
    } catch (err) {
      console.warn('[DownloadsManager] provider.start threw:', err);
      this.applyError(id, 'CRASH');
    }
    return id;
  }

  private applyProgress(id: number, received: number, totalBytes: number): void {
    const item = this.items.get(id);
    if (!item || item.state !== 'in_progress') return;
    const delta: DownloadChangeDelta = { id };
    if (item.bytesReceived !== received) {
      delta.bytesReceived = { previous: item.bytesReceived, current: received };
      item.bytesReceived = received;
    }
    if (item.totalBytes !== totalBytes) {
      delta.totalBytes = { previous: item.totalBytes, current: totalBytes };
      item.totalBytes = totalBytes;
    }
    if (Object.keys(delta).length > 1) {
      this.emit({ type: 'changed', delta });
    }
  }

  private applyComplete(id: number, finalUrl?: string, filename?: string): void {
    const item = this.items.get(id);
    if (!item || item.state === 'complete') return;
    const delta: DownloadChangeDelta = { id };
    delta.state = { previous: item.state, current: 'complete' };
    item.state = 'complete';
    item.endTime = Date.now();
    delta.endTime = { current: item.endTime };
    item.exists = true;
    if (typeof finalUrl === 'string' && finalUrl !== item.finalUrl) {
      item.finalUrl = finalUrl;
    }
    if (typeof filename === 'string' && filename !== item.filename) {
      delta.filename = { previous: item.filename, current: filename };
      item.filename = filename;
    }
    if (item.totalBytes > 0 && item.bytesReceived !== item.totalBytes) {
      delta.bytesReceived = { previous: item.bytesReceived, current: item.totalBytes };
      item.bytesReceived = item.totalBytes;
      item.fileSize = item.totalBytes;
    }
    this.emit({ type: 'changed', delta });
    (globalThis as any).__ddxNotify?.(`Download complete: ${item.filename}`, { time: 4000 });
    this.enqueueWrite();
  }

  private applyError(id: number, reason: DownloadInterruptReason): void {
    const item = this.items.get(id);
    if (!item || item.state === 'interrupted') return;
    const delta: DownloadChangeDelta = { id };
    delta.state = { previous: item.state, current: 'interrupted' };
    delta.error = { previous: item.error, current: reason };
    item.state = 'interrupted';
    item.error = reason;
    item.endTime = Date.now();
    delta.endTime = { current: item.endTime };
    this.emit({ type: 'changed', delta });
    this.enqueueWrite();
  }

  async search(query: {
    query?: string[];
    startedBefore?: number | string;
    startedAfter?: number | string;
    endedBefore?: number | string;
    endedAfter?: number | string;
    state?: DownloadState;
    paused?: boolean;
    id?: number;
    limit?: number;
    orderBy?: string[];
  } = {}): Promise<DownloadItem[]> {
    await this.ensureLoaded();
    let results = [...this.items.values()];
    if (query.id !== undefined) {
      results = results.filter((i) => i.id === query.id);
    }
    if (query.state !== undefined) {
      results = results.filter((i) => i.state === query.state);
    }
    if (query.paused !== undefined) {
      results = results.filter((i) => i.paused === query.paused);
    }
    if (Array.isArray(query.query) && query.query.length > 0) {
      const includes: string[] = [];
      const excludes: string[] = [];
      for (const t of query.query) {
        if (t.startsWith('-')) excludes.push(t.slice(1).toLowerCase());
        else includes.push(t.toLowerCase());
      }
      results = results.filter((i) => {
        const hay = `${i.url}\n${i.filename}`.toLowerCase();
        if (excludes.some((e) => hay.includes(e))) return false;
        if (includes.length > 0 && !includes.every((inc) => hay.includes(inc))) return false;
        return true;
      });
    }
    if (query.startedAfter !== undefined) {
      const t = +new Date(query.startedAfter);
      if (Number.isFinite(t)) results = results.filter((i) => i.startTime > t);
    }
    if (query.startedBefore !== undefined) {
      const t = +new Date(query.startedBefore);
      if (Number.isFinite(t)) results = results.filter((i) => i.startTime < t);
    }
    if (query.endedAfter !== undefined && query.endedBefore !== undefined) {
      const after = +new Date(query.endedAfter);
      const before = +new Date(query.endedBefore);
      results = results.filter((i) =>
        i.endTime !== undefined && i.endTime > after && i.endTime < before,
      );
    }
    if (Array.isArray(query.orderBy)) {
      results.sort((a, b) => {
        for (const k of query.orderBy!) {
          const desc = k.startsWith('-');
          const prop = (desc ? k.slice(1) : k) as keyof DownloadItem;
          const av = a[prop];
          const bv = b[prop];
          if (av === bv) continue;
          if (av === undefined) return 1;
          if (bv === undefined) return -1;
          const cmp = av < bv ? -1 : 1;
          return desc ? -cmp : cmp;
        }
        return 0;
      });
    } else {
      results.sort((a, b) => b.startTime - a.startTime);
    }
    if (typeof query.limit === 'number') results = results.slice(0, query.limit);
    return results;
  }

  async pause(id: number): Promise<void> {
    const item = this.items.get(id);
    if (!item || item.state !== 'in_progress') return;
    const control = this.perItemControl.get(id);
    if (control?.pause) {
      control.pause();
    } else {
      const provider = this.providers.get(item.providerName);
      provider?.pause?.(id);
    }
    if (!item.paused) {
      const delta: DownloadChangeDelta = { id, paused: { previous: false, current: true } };
      item.paused = true;
      this.emit({ type: 'changed', delta });
    }
  }

  async resume(id: number): Promise<void> {
    const item = this.items.get(id);
    if (!item || !item.paused) return;
    const control = this.perItemControl.get(id);
    if (control?.resume) {
      control.resume();
    } else {
      const provider = this.providers.get(item.providerName);
      provider?.resume?.(id);
    }
    const delta: DownloadChangeDelta = { id, paused: { previous: true, current: false } };
    item.paused = false;
    this.emit({ type: 'changed', delta });
  }

  async cancel(id: number): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;
    const control = this.perItemControl.get(id);
    if (control?.cancel) {
      control.cancel();
    } else {
      const provider = this.providers.get(item.providerName);
      provider?.cancel?.(id);
    }
    this.applyError(id, 'USER_CANCELED');
  }

  async erase(query: Parameters<DownloadsManager['search']>[0] = {}): Promise<number[]> {
    const items = await this.search(query);
    const erased: number[] = [];
    for (const item of items) {
      this.items.delete(item.id);
      this.perItemControl.delete(item.id);
      this.emit({ type: 'erased', id: item.id });
      erased.push(item.id);
    }
    this.enqueueWrite();
    return erased;
  }

  /** Wipe everything (used by chrome.browsingData.removeDownloads). */
  async clearAll(): Promise<void> {
    await this.erase({});
  }
}

export function inferFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    if (last) return decodeURIComponent(last);
  } catch { /* swallow */ }
  return 'download';
}

export function inferMimeFromUrl(url: string): string {
  try {
    const ext = url.split('?')[0]?.split('#')[0]?.split('.').pop()?.toLowerCase();
    if (!ext) return 'application/octet-stream';
    const map: Record<string, string> = {
      pdf: 'application/pdf',
      zip: 'application/zip',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
      webm: 'video/webm',
      txt: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      svg: 'image/svg+xml',
    };
    return map[ext] ?? 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

/**
 * Default download provider — fetches the URL and triggers a browser
 * download via `<a download>` + `URL.createObjectURL`. Reports
 * progress when the response is stream-readable.
 */
export class DefaultWebDownloadProvider implements DownloadProvider {
  readonly name = 'web';

  async start(options: DownloadOptions, controller: DownloadController): Promise<void> {
    const headers: Record<string, string> = {};
    for (const h of options.headers ?? []) headers[h.name] = h.value;
    const init: RequestInit = {
      method: options.method ?? 'GET',
      ...(options.body ? { body: options.body } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
    let response: Response;
    try {
      response = await fetch(options.url, init);
    } catch (err) {
      console.warn('[downloads/web] fetch failed:', err);
      controller.reportError('NETWORK_FAILED');
      return;
    }
    if (!response.ok) {
      const reason: DownloadInterruptReason = response.status === 401
        ? 'SERVER_UNAUTHORIZED'
        : response.status === 403
          ? 'SERVER_FORBIDDEN'
          : response.status >= 500
            ? 'SERVER_FAILED'
            : 'NETWORK_INVALID_REQUEST';
      controller.reportError(reason);
      return;
    }
    const total = parseInt(response.headers.get('content-length') ?? '0', 10) || -1;
    const cd = response.headers.get('content-disposition') ?? '';
    const inferredName = parseFilenameFromContentDisposition(cd) ?? controller.item.filename;
    if (!response.body) {
      const blob = await response.blob();
      controller.reportProgress(blob.size, blob.size);
      this.triggerDownload(blob, inferredName);
      controller.reportComplete(undefined, inferredName);
      return;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err) {
        console.warn('[downloads/web] stream read error:', err);
        controller.reportError('NETWORK_FAILED');
        return;
      }
      if (result.done) break;
      const chunk = result.value;
      chunks.push(chunk);
      received += chunk.byteLength;
      controller.reportProgress(received, total);
    }
    const blob = new Blob(chunks as BlobPart[], {
      type: response.headers.get('content-type') ?? 'application/octet-stream',
    });
    this.triggerDownload(blob, inferredName);
    controller.reportComplete(undefined, inferredName);
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }
}

/**
 * Parse `Content-Disposition: attachment; filename="foo.zip"` /
 * `filename*=UTF-8''foo.zip` to extract the suggested filename.
 * Returns undefined if not present.
 */
export function parseFilenameFromContentDisposition(cd: string): string | undefined {
  if (!cd) return undefined;
  const star = cd.match(/filename\*\s*=\s*[^']+'[^']*'([^;]+)/i);
  if (star && star[1]) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ }
  }
  const plain = cd.match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
  if (plain && plain[1]) return plain[1].trim();
  return undefined;
}
