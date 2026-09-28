
import { scriptInjectionRegistry } from '../scriptInjection';
import type { ScriptInjectionRegistry } from '../scriptInjection';
import type { Tabs } from '@browser/tabs';
import type { Proxy } from '@apis/proxy';
import type { SettingsAPI } from '@apis/settings';
import { Handshake, NYX_ORIGINS_DEFAULT, isNyxOrigin } from './handshake';
import { NyxChannel } from './channel';
import { TabResolver } from './tabResolver';
import { HandleStore } from './handleStore';
import { METHOD_REGISTRY, PROTOCOL_VERSION } from './api';
import { basePath } from '@core/shared/path';
import { dispatch } from './handlers';
import { CdpHelper } from './cdp';
import type { AgentMessage } from './frameTransport';
import { dispatchEventToFrame } from './frameDispatch';
import './handlers/_loadAll';

/**
 * Payload for a `?`-prefix / "Ask Nyx" prefill from DDX → NyxAI. The
 * NyxBridge buffers one of these per iframe between when DDX navigates
 * the active tab to ddx://ai and when NyxAI's handshake completes,
 * then dispatches it as a `__nyx_prefill` CustomEvent into the proxied
 * iframe's window.
 */
export interface PrefillPayload {
	query: string;
}

export interface NyxBridgeDeps {
	scriptInjectionRegistry: Pick<ScriptInjectionRegistry, 'register' | 'unregister'>;
	tabs: Tabs;
	proxy: Proxy;
	settings: SettingsAPI;
}

export class NyxBridge {
	private deps: NyxBridgeDeps;
	private initialized = false;
	private hostMarker = '';
	private allowlist: readonly string[] = [];
	private handshake!: Handshake;
	private channel!: NyxChannel;
	private tabResolver!: TabResolver;
	private handleStore = new HandleStore();
	private cdp = new CdpHelper();
	/**
	 * Per-iframe prefill queue. Populated by `queuePrefill()` (typically
	 * from DDX's omnibox `?`-mode), drained inside the post-handshake
	 * callback wired up in `init()`. WeakMap-keyed so frames that get
	 * destroyed without ever handshaking don't pin payloads.
	 */
	private pendingPrefills = new WeakMap<HTMLIFrameElement, PrefillPayload>();

	constructor(deps: NyxBridgeDeps) {
		this.deps = deps;
	}

	/**
	 * Queue a prefill payload for the next NyxAI iframe handshake. DDX's
	 * omnibox `?`-mode calls this immediately before navigating the
	 * active tab to `ddx://ai`; once the new iframe boots and completes
	 * its handshake, the payload is dispatched as a `__nyx_prefill`
	 * CustomEvent into the proxied window.
	 *
	 * One pending payload per iframe — calling again before the
	 * previous drained replaces it (last-write-wins). Calling for an
	 * iframe that's already past handshake DOES NOT auto-fire; the
	 * handshake completion is the trigger, so a late call sits idle.
	 * Callers that need to push to an already-loaded NyxAI tab should
	 * use `dispatchPrefillNow()` instead.
	 */
	queuePrefill(iframe: HTMLIFrameElement, payload: PrefillPayload): void {
		this.pendingPrefills.set(iframe, payload);
	}

	/**
	 * Push a prefill payload directly into an already-loaded NyxAI
	 * iframe (i.e. one that has already completed its handshake).
	 * Returns true if the dispatch attempt succeeded (the CustomEvent
	 * was fired), false if the iframe had no contentWindow.
	 *
	 * No-op-on-failure semantics: NyxAI's listener may not exist yet
	 * if the tab is mid-boot; in that case the event simply has no
	 * receiver and the user sees nothing. Use `queuePrefill()` instead
	 * when you don't know the iframe's lifecycle state.
	 */
	dispatchPrefillNow(iframe: HTMLIFrameElement, payload: PrefillPayload): boolean {
		const win = iframe.contentWindow;
		if (!win) return false;
		return dispatchEventToFrame(win, '__nyx_prefill', payload);
	}

	async init(): Promise<void> {
		if (this.initialized) return;

		this.hostMarker = crypto.randomUUID();

		const devOrigin = (await this.deps.settings?.getItem?.('aiBridgeDevOrigin')) as string | null;
		this.allowlist = [...NYX_ORIGINS_DEFAULT, ...(devOrigin ? [devOrigin] : [])];

		this.handshake = new Handshake({ hostMarker: this.hostMarker, allowlist: this.allowlist });
		this.tabResolver = new TabResolver(this.deps.tabs, this.deps.proxy);
		this.channel = new NyxChannel({
			handshake: this.handshake,
			dispatchMethod: async (method, args) =>
				dispatch({
					tabResolver: this.tabResolver,
					handleStore: this.handleStore,
					cdp: this.cdp,
					proxy: this.deps.proxy,
					tabs: this.deps.tabs,
					protocols: (window as any).protocols ?? null,
					settings: this.deps.settings,
				}, method, args),
			resolveIframeForSource: (src) => this.tabResolver.resolveIframeForSource(src),
			resolveRealUrl: (iframe) => this.decodeIframeUrl(iframe),
			onHandshakeComplete: (iframe, source) => {
				const payload = this.pendingPrefills.get(iframe);
				if (!payload) return;
				this.pendingPrefills.delete(iframe);
				dispatchEventToFrame(source, '__nyx_prefill', payload);
			},
		});
		this.channel.registerMethods(METHOD_REGISTRY);
		this.channel.install();

		try {
			const clientCode = await this.buildClientScript();
			if (clientCode) {
				console.log(
					'[nyxBridge] client bundle fetched, size=',
					clientCode.length,
					'bytes; allowlist=',
					this.allowlist,
				);
				this.deps.scriptInjectionRegistry.register({
					id: 'nyx-bridge-client',
					match: (url) => {
						const matched = isNyxOrigin(url.toString(), this.allowlist);
						console.log(
							'[nyxBridge] match check:',
							url.toString(),
							'→',
							matched,
						);
						return matched;
					},
					scripts: [{ kind: 'inline', code: clientCode }],
				});
				console.log('[nyxBridge] client injection registered');
			} else {
				console.warn(
					'[nyxBridge] client bundle fetch failed; no injection registered',
				);
			}
		} catch (e) {
			console.warn('[nyxBridge] failed to register client injection:', e);
		}

		this.initialized = true;
		console.log('[nyxBridge] initialized, protocol', PROTOCOL_VERSION);
	}

	/**
	 * Returns the internal HandlerContext used by NyxBridge's own
	 * dispatch. Helium's ExtensionManager consumes the same context to
	 * delegate chrome.tabs.* and other browser-control methods to the
	 * NyxBridge handler ecosystem.
	 *
	 * Throws if called before init().
	 */
	public getHandlerContext(): import('./handlers').HandlerContext {
		if (!this.initialized) {
			throw new Error(
				'[nyxBridge] getHandlerContext called before init()',
			);
		}
		return {
			tabResolver: this.tabResolver,
			handleStore: this.handleStore,
			cdp: this.cdp,
			proxy: this.deps.proxy,
			tabs: this.deps.tabs,
			protocols: (window as any).protocols ?? null,
			settings: this.deps.settings,
		};
	}

	private decodeIframeUrl(iframe: HTMLIFrameElement): string {
		const proxy = this.deps.proxy as any;
		if (proxy && typeof proxy.extractEncodedUrl === 'function') {
			try {
				return proxy.extractEncodedUrl(iframe) ?? '';
			} catch {
				return '';
			}
		}
		return iframe.getAttribute('src') ?? '';
	}

	private async buildClientScript(): Promise<string | null> {
		try {
			const url = `${location.origin}${basePath}assets/nyx-bridge-client.js`;
			const res = await fetch(url);
			if (!res.ok) return null;
			const body = await res.text();
			return `(function(){globalThis.__NYX_HOST_MARKER=${JSON.stringify(this.hostMarker)};${body}})();`;
		} catch {
			return null;
		}
	}

	get isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Called by hookInstaller for every message from a Nyx-agent-bearing
	 * proxied frame. We forward to cdp, and opportunistically map
	 * frameId → tabId when we see `frame-ready` from a window we can
	 * locate in the tabs map.
	 */
	_receiveAgentMessage(frameId: string, msg: AgentMessage, win: Window): void {
		if (msg.kind === 'frame-ready') {
			const map = this.deps.tabs?.frameByTabId as Map<string, HTMLIFrameElement> | undefined;
			if (map) {
				for (const [ddxId, iframe] of map) {
					if (iframe.contentWindow === win) {
						this.cdp.registerFrame(this.tabResolver.toNum(ddxId), frameId, win);
						break;
					}
				}
			}
		}
		this.cdp.handleAgentMessage(frameId, msg, win);
	}

	/** Test/debug accessor. */
	_internals() {
		return { handshake: this.handshake, channel: this.channel, hostMarker: this.hostMarker, cdp: this.cdp };
	}
}

export function createNyxBridge(opts: Omit<NyxBridgeDeps, 'scriptInjectionRegistry'>): NyxBridge {
	return new NyxBridge({ scriptInjectionRegistry, ...opts });
}

export { isNyxOrigin };
