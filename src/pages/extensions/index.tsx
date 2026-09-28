import '@css/tailwind.css';
import '@css/global.scss';
import '@css/internal.scss';
import 'basecoat-css/all';
import '@pages/shared/themeInit';
import '@utils/global/panic';
import { createIcons, icons } from 'lucide';
import { coverIdentity } from '@core/shared/build-runtime';

interface HeliumExtMgrLike {
  installFromBytes(bytes: Uint8Array): Promise<{ id: string; name?: string }>;
  uninstall(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  listAll?(): Promise<
    Array<{
      id: string;
      name?: string;
      version?: string;
      enabled?: boolean;
      manifestVersion?: number;
    }>
  >;
  listAllWithManifest?: () => Promise<
    Array<{
      id: string;
      name: string;
      version: string;
      manifestVersion: 2 | 3;
      enabled: boolean;
      origin: string;
      manifest: Record<string, unknown>;
    }>
  >;
  list(): Array<{
    id: string;
    name?: string;
    version?: string;
    enabled?: boolean;
    manifestVersion?: number;
  }>;
  isRunning(id: string): boolean;
  getIconDataUrl?: (extId: string, iconPath: string) => Promise<string | null>;
  getManifest?: (extId: string) => unknown;
  on(
    event: 'installed' | 'uninstalled' | 'enabled' | 'disabled',
    listener: (id: string) => void,
  ): void;
}

interface ExtensionViewModel {
  id: string;
  name: string;
  version: string;
  description: string;
  iconPath: string | null;
  enabled: boolean;
  manifestVersion: number;
  origin: string;
  homepageUrl?: string;
  permissions: string[];
  hostPermissions: string[];
  /**
   * Slots this extension's manifest declares via chrome_url_overrides.
   * Used by the card UI to render per-slot toggles. Empty when the
   * extension doesn't declare any overrides.
   */
  urlOverrides: Array<'newtab' | 'bookmarks' | 'history'>;
  /** True if the manifest declares `options_page` or `options_ui.page`. */
  hasOptions: boolean;
}

interface ExtTargetLike {
  extId: string;
  targetId: string;
  kind: 'background' | 'popup' | 'options' | 'devtools-page' | 'content-script';
  label: string;
  tabId?: string;
}

interface ExtDevtoolsLike {
  listFor(extId: string): ExtTargetLike[];
  isOpen(extId: string, targetId: string): boolean;
  openTarget(extId: string, targetId: string): Promise<void>;
  closeTarget(extId: string, targetId: string): void;
  subscribe(
    listener: (e: { kind: 'added' | 'removed'; extId?: string; target?: ExtTargetLike }) => void,
  ): () => void;
}

function getExtDevtools(): ExtDevtoolsLike | null {
  const candidates: Window[] = [window];
  try {
    if (window.parent && window.parent !== window) candidates.push(window.parent);
  } catch {
    /* ignore */
  }
  try {
    if (window.top && window.top !== window) candidates.push(window.top);
  } catch {
    /* ignore */
  }
  for (const w of candidates) {
    try {
      const cand = (w as { extDevtools?: ExtDevtoolsLike }).extDevtools;
      if (cand) return cand;
    } catch {
      /* cross-origin */
    }
  }
  return null;
}

interface UrlOverrideState {
  active: { newtab?: string; bookmarks?: string; history?: string };
  pending: { newtab?: string; bookmarks?: string; history?: string };
  declined: { newtab?: string[]; bookmarks?: string[]; history?: string[] };
}

interface ExtensionUrlOverridesLike {
  getState(): Promise<UrlOverrideState>;
  confirmPending(
    kind: 'newtab' | 'bookmarks' | 'history',
    lookupManifest: (extId: string) => unknown,
  ): Promise<void>;
  declinePending(kind: 'newtab' | 'bookmarks' | 'history'): Promise<void>;
  clearActive(kind: 'newtab' | 'bookmarks' | 'history'): Promise<void>;
  setActive(
    kind: 'newtab' | 'bookmarks' | 'history',
    extId: string,
    lookupManifest: (extId: string) => unknown,
  ): Promise<void>;
  subscribe(listener: (state: UrlOverrideState) => void): () => void;
}

function getUrlOverrides(): ExtensionUrlOverridesLike | null {
  const candidates: Window[] = [window];
  try {
    if (window.parent && window.parent !== window) candidates.push(window.parent);
  } catch { /* ignore */ }
  try {
    if (window.top && window.top !== window) candidates.push(window.top);
  } catch { /* ignore */ }
  for (const w of candidates) {
    try {
      const cand = (w as { extensionUrlOverrides?: ExtensionUrlOverridesLike }).extensionUrlOverrides;
      if (cand) return cand;
    } catch { /* cross-origin */ }
  }
  return null;
}

function getHeliumExtMgr(): HeliumExtMgrLike | null {
  const candidates: Window[] = [window];
  try {
    if (window.parent && window.parent !== window) candidates.push(window.parent);
  } catch {
    /* cross-origin */
  }
  try {
    if (window.top && window.top !== window) candidates.push(window.top);
  } catch {
    /* cross-origin */
  }
  console.log(`[helium/extfs/dbg] [page] getHeliumExtMgr scanning ${candidates.length} window(s)`);
  for (let i = 0; i < candidates.length; i++) {
    const w = candidates[i]!;
    try {
      const mgr = (w as unknown as { extensions?: HeliumExtMgrLike }).extensions;
      const label = i === 0 ? 'self' : i === 1 ? 'parent' : 'top';
      if (mgr && typeof mgr.installFromBytes === 'function') {
        console.log(`[helium/extfs/dbg] [page] getHeliumExtMgr: FOUND on window.${label}`);
        return mgr;
      }
      console.log(`[helium/extfs/dbg] [page] getHeliumExtMgr: window.${label} extensions=${typeof mgr}`);
    } catch (err) {
      console.log(`[helium/extfs/dbg] [page] getHeliumExtMgr: candidate[${i}] threw (cross-origin?):`, err);
    }
  }
  console.warn(`[helium/extfs/dbg] [page] getHeliumExtMgr: NO MANAGER FOUND on any window`);
  return null;
}

async function listAllExtensions(): Promise<ExtensionViewModel[]> {
  const mgr = getHeliumExtMgr();
  if (!mgr) {
    console.warn('[helium/extfs/dbg] [page] listAllExtensions: no manager → returning []');
    return [];
  }
  if (mgr.listAllWithManifest) {
    try {
      console.log('[helium/extfs/dbg] [page] listAllExtensions: calling listAllWithManifest...');
      const entries = await mgr.listAllWithManifest();
      console.log(`[helium/extfs/dbg] [page] listAllExtensions: listAllWithManifest returned ${entries.length} entries`);
      return entries.map((e) => toViewModel(e));
    } catch (err) {
      console.warn('[extensions] listAllWithManifest failed:', err);
    }
  }
  if (mgr.listAll) {
    try {
      console.log('[helium/extfs/dbg] [page] listAllExtensions: falling back to listAll...');
      const entries = await mgr.listAll();
      console.log(`[helium/extfs/dbg] [page] listAllExtensions: listAll returned ${entries.length} entries`);
      return entries.map((e) => ({
        id: e.id,
        name: e.name ?? e.id,
        version: e.version ?? '',
        description: '',
        iconPath: null,
        enabled: e.enabled !== false,
        manifestVersion: e.manifestVersion ?? 3,
        origin: `${e.id}.ddx`,
        permissions: [],
        hostPermissions: [],
        urlOverrides: [],
        hasOptions: false,
      }));
    } catch (err) {
      console.warn('[extensions] listAll failed:', err);
    }
  }
  const running = mgr.list();
  console.log(`[helium/extfs/dbg] [page] listAllExtensions: last-resort list() returned ${running.length} running entries`);
  return running.map((e) => ({
    id: e.id,
    name: e.name ?? e.id,
    version: e.version ?? '',
    description: '',
    iconPath: null,
    enabled: e.enabled !== false,
    manifestVersion: e.manifestVersion ?? 3,
    origin: `${e.id}.ddx`,
    permissions: [],
    hostPermissions: [],
    urlOverrides: [],
    hasOptions: false,
  }));
}

function toViewModel(e: {
  id: string;
  name: string;
  version: string;
  manifestVersion: 2 | 3;
  enabled: boolean;
  origin: string;
  manifest: Record<string, unknown>;
}): ExtensionViewModel {
  const m = e.manifest as {
    description?: string;
    homepage_url?: string;
    permissions?: unknown[];
    host_permissions?: unknown[];
    icons?: Record<string, string>;
    action?: { default_icon?: string | Record<string, string> };
    browser_action?: { default_icon?: string | Record<string, string> };
    chrome_url_overrides?: Record<string, string>;
    options_page?: string;
    options_ui?: { page?: string };
  };
  const hasOptions =
    typeof m.options_page === 'string' && m.options_page.length > 0 ||
    typeof m.options_ui?.page === 'string' && (m.options_ui.page as string).length > 0;
  const declaredOverrides: Array<'newtab' | 'bookmarks' | 'history'> = [];
  if (m.chrome_url_overrides && typeof m.chrome_url_overrides === 'object') {
    for (const kind of ['newtab', 'bookmarks', 'history'] as const) {
      if (typeof m.chrome_url_overrides[kind] === 'string' && m.chrome_url_overrides[kind]!.length > 0) {
        declaredOverrides.push(kind);
      }
    }
  }
  return {
    id: e.id,
    name: e.name,
    version: e.version,
    description: typeof m.description === 'string' ? m.description : '',
    iconPath: pickIconPath(m),
    enabled: e.enabled,
    manifestVersion: e.manifestVersion,
    origin: e.origin,
    homepageUrl:
      typeof m.homepage_url === 'string' ? m.homepage_url : undefined,
    permissions: Array.isArray(m.permissions)
      ? m.permissions.filter((p): p is string => typeof p === 'string')
      : [],
    hostPermissions: Array.isArray(m.host_permissions)
      ? m.host_permissions.filter((p): p is string => typeof p === 'string')
      : [],
    urlOverrides: declaredOverrides,
    hasOptions,
  };
}

function pickIconPath(m: {
  icons?: Record<string, string>;
  action?: { default_icon?: string | Record<string, string> };
  browser_action?: { default_icon?: string | Record<string, string> };
}): string | null {
  const fromAction =
    m.action?.default_icon ?? m.browser_action?.default_icon ?? null;
  if (typeof fromAction === 'string') return fromAction;
  if (fromAction && typeof fromAction === 'object') {
    const picked = pickLargestIcon(fromAction);
    if (picked) return picked;
  }
  if (m.icons) {
    const picked = pickLargestIcon(m.icons);
    if (picked) return picked;
  }
  return null;
}

function pickLargestIcon(map: Record<string, string>): string | null {
  for (const size of ['128', '64', '48', '32', '16']) {
    if (typeof map[size] === 'string') return map[size]!;
  }
  const first = Object.values(map).find((v) => typeof v === 'string');
  return first ?? null;
}

function status(message: string, kind: 'info' | 'success' | 'error'): void {
  const container = document.getElementById('helium-install-status');
  if (!container) return;
  const div = document.createElement('div');
  div.className = [
    'px-3 py-2 rounded-md text-sm',
    kind === 'success' &&
      'bg-green-500/10 text-green-400 border border-green-500/20',
    kind === 'error' && 'bg-red-500/10 text-red-400 border border-red-500/20',
    kind === 'info' &&
      'bg-[var(--white-05)] text-[var(--text)] border border-[var(--white-10)]',
  ]
    .filter(Boolean)
    .join(' ');
  div.textContent = message;
  container.appendChild(div);
  setTimeout(
    () => {
      div.style.transition = 'opacity 0.4s';
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 400);
    },
    kind === 'error' ? 8000 : 4000,
  );
}

function formatError(err: unknown): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || String(err);
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.name === 'string' && e.name) return e.name;
    try {
      const j = JSON.stringify(err);
      if (j && j !== '{}') return j;
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

async function installFile(file: File): Promise<void> {
  const mgr = getHeliumExtMgr();
  if (!mgr) {
    status(
      `ExtensionManager not available — load this page from inside ${coverIdentity().product}.`,
      'error',
    );
    return;
  }
  status(`Installing ${file.name}…`, 'info');
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const entry = await mgr.installFromBytes(bytes);
    const name =
      (entry as { name?: string }).name ??
      (entry as { manifest?: { name?: string } }).manifest?.name ??
      entry.id;
    status(`✓ Installed "${name}" (${entry.id.slice(0, 8)}…)`, 'success');
  } catch (err) {
    status(`✗ Failed to install ${file.name}: ${formatError(err)}`, 'error');
    console.error('[helium-install]', err);
  } finally {
    try {
      await renderList();
    } catch (renderErr) {
      console.warn('[helium-install] renderList after install failed:', renderErr);
    }
  }
}

async function handleFiles(files: FileList | File[] | null): Promise<void> {
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    if (!/\.(crx|zip|xpi)$/i.test(file.name)) {
      status(`✗ Skipped ${file.name}: not a .crx/.zip/.xpi file`, 'error');
      continue;
    }
    await installFile(file);
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );
}

function buildOverridesSection(ext: ExtensionViewModel): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'flex flex-col gap-2';

  const header = document.createElement('div');
  header.className =
    'flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--proto)] pt-2';
  header.innerHTML = '<i data-lucide="globe" class="h-3 w-3"></i><span>URL Overrides</span>';
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'flex flex-col gap-1.5';
  root.appendChild(body);

  const rerender = async (): Promise<void> => {
    body.innerHTML = '';
    const overrides = getUrlOverrides();
    if (!overrides) {
      body.innerHTML = '<span class="text-xs text-[var(--proto)]">Coordinator not ready</span>';
      return;
    }
    let state: UrlOverrideState;
    try { state = await overrides.getState(); }
    catch { return; }

    for (const kind of ext.urlOverrides) {
      const row = document.createElement('label');
      row.className =
        'inline-flex items-center gap-2 cursor-pointer text-xs select-none';
      const active = state.active[kind] === ext.id;
      row.innerHTML = `
        <input type="checkbox" ${active ? 'checked' : ''} class="sr-only peer" />
        <span class="relative inline-block w-9 h-5 rounded-full bg-[var(--white-10)] peer-checked:bg-[var(--main)] transition-colors">
          <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4"></span>
        </span>
        <span>Use as ${OVERRIDE_LABELS[kind]}</span>
      `;
      const input = row.querySelector('input') as HTMLInputElement;
      input.addEventListener('change', async () => {
        try {
          if (input.checked) {
            await overrides.setActive(kind, ext.id, (extId) => {
              const m = getHeliumExtMgr();
              return m?.getManifest ? m.getManifest(extId) : null;
            });
          } else {
            await overrides.clearActive(kind);
          }
          await rerender();
        } catch (err) {
          status(`Failed to toggle override: ${formatError(err)}`, 'error');
          input.checked = !input.checked;
        }
      });
      body.appendChild(row);
    }
    createIcons({ icons });
  };
  void rerender();
  return root;
}

interface InspectViewsHandle {
  root: HTMLDivElement;
  refresh: () => void;
  dispose: () => void;
}

function buildInspectViewsSection(extId: string): InspectViewsHandle {
  const root = document.createElement('div');
  root.className = 'flex flex-col gap-2';

  const header = document.createElement('div');
  header.className =
    'flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--proto)] pt-2';
  const title = document.createElement('span');
  title.textContent = 'Inspect views';
  const empty = document.createElement('span');
  empty.className = 'text-[10px] text-[var(--proto)] opacity-60';
  empty.textContent = 'none active';
  header.append(title, empty);
  root.appendChild(header);

  const list = document.createElement('div');
  list.className = 'flex flex-wrap gap-1.5';
  root.appendChild(list);

  const refresh = (): void => {
    const ext = getExtDevtools();
    list.innerHTML = '';
    if (!ext) {
      empty.textContent = 'devtools unavailable';
      return;
    }
    const targets = ext.listFor(extId);
    if (targets.length === 0) {
      empty.style.display = '';
      empty.textContent = 'none active';
      return;
    }
    empty.style.display = 'none';
    for (const t of targets) {
      const open = ext.isOpen(t.extId, t.targetId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = open
        ? 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-[var(--main)] text-black transition-colors'
        : 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-[var(--white-05)] text-[var(--text)] hover:bg-[var(--white-10)] transition-colors';
      btn.textContent = t.label;
      btn.title = `${t.kind} · ${t.targetId}`;
      btn.addEventListener('click', () => {
        const dt = getExtDevtools();
        if (!dt) return;
        if (dt.isOpen(t.extId, t.targetId)) {
          dt.closeTarget(t.extId, t.targetId);
        } else {
          void dt.openTarget(t.extId, t.targetId);
        }
      });
      list.appendChild(btn);
    }
  };

  let unsubscribe: (() => void) | null = null;
  const ext = getExtDevtools();
  if (ext) {
    unsubscribe = ext.subscribe((e) => {
      const evExtId = (e as { extId?: string }).extId;
      const targetExtId = (e.target as ExtTargetLike | undefined)?.extId;
      if (evExtId !== undefined && evExtId !== extId) return;
      if (targetExtId !== undefined && targetExtId !== extId) return;
      refresh();
    });
  }
  refresh();

  return {
    root,
    refresh,
    dispose: () => {
      if (unsubscribe) unsubscribe();
    },
  };
}

function accessLabel(ext: ExtensionViewModel): string {
  const allUrls = ext.hostPermissions.some(
    (h) =>
      h === '<all_urls>' ||
      h === '*://*/*' ||
      h === 'http://*/*' ||
      h === 'https://*/*',
  );
  if (allUrls) return 'All sites';
  if (ext.hostPermissions.length > 0)
    return `${ext.hostPermissions.length} site${ext.hostPermissions.length > 1 ? 's' : ''}`;
  if (ext.permissions.includes('activeTab')) return 'On click';
  return 'No site access';
}

function buildCard(ext: ExtensionViewModel): HTMLElement {
  const card = document.createElement('div');
  card.className =
    'rounded-xl border border-[var(--white-08)] bg-[var(--bg-1)] p-5 flex flex-col gap-3 transition-colors';
  card.dataset.heliumExtId = ext.id;
  if (!ext.enabled) card.classList.add('opacity-60');

  const header = document.createElement('div');
  header.className = 'flex items-start gap-3';

  const iconEl = document.createElement('div');
  iconEl.className =
    'h-12 w-12 rounded-lg bg-[var(--white-05)] flex-shrink-0 flex items-center justify-center overflow-hidden';
  iconEl.innerHTML =
    '<i data-lucide="puzzle" class="h-5 w-5 text-[var(--proto)]"></i>';
  if (ext.iconPath) {
    const mgr = getHeliumExtMgr();
    if (mgr?.getIconDataUrl) {
      mgr
        .getIconDataUrl(ext.id, ext.iconPath)
        .then((dataUrl) => {
          if (!dataUrl) return;
          const img = document.createElement('img');
          img.src = dataUrl;
          img.alt = '';
          img.className = 'h-full w-full object-contain';
          img.onerror = () => img.remove();
          iconEl.replaceChildren(img);
        })
        .catch(() => {
          /* keep placeholder */
        });
    }
  }

  const info = document.createElement('div');
  info.className = 'flex-1 min-w-0';
  info.innerHTML = `
    <div class="font-medium text-[var(--text)] truncate">${escapeHtml(ext.name)}</div>
    <div class="text-xs text-[var(--proto)] truncate mt-0.5">
      v${escapeHtml(ext.version || '?')} · MV${ext.manifestVersion} · ${escapeHtml(ext.id.slice(0, 8))}…
    </div>
  `;

  header.append(iconEl, info);

  if (ext.description) {
    const desc = document.createElement('p');
    desc.className = 'text-xs text-[var(--proto)] line-clamp-2';
    desc.textContent = ext.description;
    card.append(header, desc);
  } else {
    card.append(header);
  }

  const accessRow = document.createElement('div');
  accessRow.className = 'flex items-center gap-2 text-xs';
  const chip = document.createElement('span');
  chip.className =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--white-05)] text-[var(--proto)]';
  chip.innerHTML = `<i data-lucide="globe" class="h-3 w-3"></i> ${escapeHtml(accessLabel(ext))}`;
  accessRow.appendChild(chip);
  if (ext.homepageUrl) {
    const homeLink = document.createElement('a');
    homeLink.href = ext.homepageUrl;
    homeLink.target = '_blank';
    homeLink.rel = 'noopener noreferrer';
    homeLink.className =
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[var(--proto)] hover:bg-[var(--white-05)] hover:text-[var(--text)]';
    homeLink.innerHTML =
      '<i data-lucide="external-link" class="h-3 w-3"></i> Homepage';
    accessRow.appendChild(homeLink);
  }
  card.appendChild(accessRow);

  const inspectSection = buildInspectViewsSection(ext.id);
  card.appendChild(inspectSection.root);

  if (ext.urlOverrides.length > 0) {
    card.appendChild(buildOverridesSection(ext));
  }

  const footer = document.createElement('div');
  footer.className =
    'flex items-center justify-between gap-2 pt-3 mt-auto border-t border-[var(--white-08)]';

  const toggleLabel = document.createElement('label');
  toggleLabel.className =
    'inline-flex items-center gap-2 cursor-pointer text-xs select-none';
  toggleLabel.innerHTML = `
    <input type="checkbox" ${ext.enabled ? 'checked' : ''} class="sr-only peer" />
    <span class="relative inline-block w-9 h-5 rounded-full bg-[var(--white-10)] peer-checked:bg-[var(--main)] transition-colors">
      <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4"></span>
    </span>
    <span data-toggle-label>${ext.enabled ? 'Enabled' : 'Disabled'}</span>
  `;
  const toggleInput = toggleLabel.querySelector('input') as HTMLInputElement;
  toggleInput.addEventListener('change', async () => {
    const mgr = getHeliumExtMgr();
    if (!mgr) return;
    const want = toggleInput.checked;
    try {
      await mgr.setEnabled(ext.id, want);
      const lbl = toggleLabel.querySelector(
        '[data-toggle-label]',
      ) as HTMLElement;
      lbl.textContent = want ? 'Enabled' : 'Disabled';
      card.classList.toggle('opacity-60', !want);
    } catch (err) {
      status(`Failed to toggle ${ext.name}: ${formatError(err)}`, 'error');
      toggleInput.checked = !want;
    }
  });

  const actionBtns = document.createElement('div');
  actionBtns.className = 'flex items-center gap-1';

  if (ext.hasOptions) {
    const optionsBtn = document.createElement('button');
    optionsBtn.className =
      'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs hover:bg-[var(--white-05)] transition-colors';
    optionsBtn.innerHTML =
      '<i data-lucide="settings" class="h-3.5 w-3.5"></i> Options';
    optionsBtn.addEventListener('click', async () => {
      try {
        const mgr = getHeliumExtMgr() as HeliumExtMgrLike & {
          openOptionsPage?: (extId: string) => Promise<void>;
        } | null;
        if (mgr?.openOptionsPage) {
          await mgr.openOptionsPage(ext.id);
        } else {
          status('Options page support not yet wired on host', 'error');
        }
      } catch (err) {
        status(`Failed to open options: ${formatError(err)}`, 'error');
      }
    });
    actionBtns.appendChild(optionsBtn);
  }

  const uninstallBtn = document.createElement('button');
  uninstallBtn.className =
    'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-red-400 hover:bg-red-500/10 transition-colors';
  uninstallBtn.innerHTML =
    '<i data-lucide="trash-2" class="h-3.5 w-3.5"></i> Uninstall';
  uninstallBtn.addEventListener('click', async () => {
    if (!confirm(`Uninstall "${ext.name}"? This cannot be undone.`)) return;
    const mgr = getHeliumExtMgr();
    if (!mgr) return;
    try {
      await mgr.uninstall(ext.id);
      status(`✓ Uninstalled "${ext.name}"`, 'success');
      await renderList();
    } catch (err) {
      status(`Failed to uninstall ${ext.name}: ${formatError(err)}`, 'error');
      console.error('[helium-uninstall]', err);
    }
  });
  actionBtns.appendChild(uninstallBtn);

  footer.append(toggleLabel, actionBtns);
  card.appendChild(footer);
  return card;
}

async function renderList(): Promise<void> {
  console.log('[helium/extfs/dbg] [page] renderList() entry');
  const list = document.getElementById('helium-extension-list');
  const empty = document.getElementById('helium-extension-empty');
  const count = document.getElementById('helium-extension-count');
  if (!list) {
    console.warn('[helium/extfs/dbg] [page] renderList: #helium-extension-list not found in DOM');
    return;
  }

  const exts = await listAllExtensions();
  console.log(`[helium/extfs/dbg] [page] renderList: got ${exts.length} extension(s):`, exts.map(e => ({ id: e.id, name: e.name, enabled: e.enabled })));
  exts.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  list.innerHTML = '';

  await renderOverrideBanners(list, exts);

  if (exts.length === 0) {
    console.log('[helium/extfs/dbg] [page] renderList: 0 extensions → showing empty state');
    empty?.classList.remove('hidden');
    if (count) count.textContent = '';
    return;
  }
  console.log(`[helium/extfs/dbg] [page] renderList: rendering ${exts.length} card(s)`);
  empty?.classList.add('hidden');
  if (count) {
    const enabledCount = exts.filter((e) => e.enabled).length;
    count.textContent = `${exts.length} total · ${enabledCount} enabled`;
  }
  for (const ext of exts) {
    list.appendChild(buildCard(ext));
  }
  createIcons({ icons });
}

const OVERRIDE_LABELS: Record<'newtab' | 'bookmarks' | 'history', string> = {
  newtab: 'new tab page',
  bookmarks: 'bookmarks page',
  history: 'history page',
};

async function renderOverrideBanners(
  list: HTMLElement,
  exts: ExtensionViewModel[],
): Promise<void> {
  const overrides = getUrlOverrides();
  if (!overrides) return;
  let state: UrlOverrideState;
  try {
    state = await overrides.getState();
  } catch (err) {
    console.warn('[extensions] urlOverrides.getState failed:', err);
    return;
  }
  const extById = new Map(exts.map((e) => [e.id, e]));

  for (const kind of ['newtab', 'bookmarks', 'history'] as const) {
    const pendingExtId = state.pending[kind];
    if (!pendingExtId) continue;
    const ext = extById.get(pendingExtId);
    if (!ext) continue;

    const banner = document.createElement('div');
    banner.className =
      'mb-3 p-3 rounded-lg border border-[var(--main)]/30 bg-[var(--main)]/10 flex items-center gap-3 text-sm';
    banner.innerHTML = `
      <i data-lucide="alert-triangle" class="h-5 w-5 text-[var(--main)] shrink-0"></i>
      <div class="flex-1 min-w-0">
        <strong>${escapeHtml(ext.name)}</strong> wants to change your ${OVERRIDE_LABELS[kind]}.
      </div>
      <button data-action="keep" class="px-3 py-1 rounded-md text-xs bg-[var(--main)] text-white hover:bg-[var(--main)]/90 transition-colors">Keep changes</button>
      <button data-action="discard" class="px-3 py-1 rounded-md text-xs hover:bg-[var(--white-05)] transition-colors">Discard</button>
    `;
    const keep = banner.querySelector('[data-action="keep"]') as HTMLButtonElement;
    const discard = banner.querySelector('[data-action="discard"]') as HTMLButtonElement;
    keep.addEventListener('click', async () => {
      try {
        await overrides.confirmPending(kind, (extId) => {
          const m = getHeliumExtMgr();
          return m?.getManifest ? m.getManifest(extId) : null;
        });
        await renderList();
      } catch (err) {
        status(`Failed to apply override: ${formatError(err)}`, 'error');
      }
    });
    discard.addEventListener('click', async () => {
      try {
        await overrides.declinePending(kind);
        await renderList();
      } catch (err) {
        status(`Failed to discard override: ${formatError(err)}`, 'error');
      }
    });
    list.appendChild(banner);
  }
}

function setupDropzone(): void {
  const dropzone = document.getElementById('helium-dropzone');
  const fileInput = document.getElementById(
    'helium-file-input',
  ) as HTMLInputElement | null;
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await handleFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('border-[var(--main)]', 'bg-[var(--white-05)]');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        evt === 'dragleave' &&
        (e as DragEvent).relatedTarget &&
        dropzone.contains((e as DragEvent).relatedTarget as Node)
      )
        return;
      dropzone.classList.remove('border-[var(--main)]', 'bg-[var(--white-05)]');
    });
  });
  dropzone.addEventListener('drop', async (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt?.files) await handleFiles(dt.files);
  });
}

function setupEvents(): void {
  const mgr = getHeliumExtMgr();
  if (!mgr) return;
  mgr.on('installed', () => void renderList());
  mgr.on('uninstalled', () => void renderList());
  mgr.on('enabled', () => void renderList());
  mgr.on('disabled', () => void renderList());
}

document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();
  setupEvents();
  void renderList();
  createIcons({ icons });
});
