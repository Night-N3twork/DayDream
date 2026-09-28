import { Logger } from '@apis/logging';
import { SettingsAPI } from '@apis/settings';
import { HostingAPI } from '@apis/platform/hosting';
import { NetworkAPI } from '@apis/platform/network';
import { SearchEngineRegistry, searchImpl } from '@apis/searchEngines';
import { basePath, resolvePath } from '@utils/basepath';
import type LibcurlClient from '@mercuryworkshop/libcurl-transport';
import type PulsarClient from '@pkgs/pulsar';
import { installEventsBridge } from '@apis/eventsBridge';
import { installScriptInjector } from '@apis/scriptInjection';
import { installDevToolsHook } from '@apis/devtools';
import {
	CachePluginManager,
	installCachePluginManager
} from '@apis/cachePlugins';
// Imports kept intentionally while captcha install is commented out
// below (see `void installCaptcha;` marker after the disabled block).
import { installCaptcha, type CaptchaManager } from '@apis/captcha';
import {
	buildTransport,
	resolveTransportConfig,
	transportFetch,
	type TransportKind
} from '@core/shared/transport';
import { buildConfig } from '@core/shared/build-runtime';

interface ProxyInterface {
	searchVar: string;
	transportVar: string;
	wispUrl: string;
	logging: Logger;
	settings: SettingsAPI;
	hosting: HostingAPI;
	network: NetworkAPI;
	isStaticBuild: boolean;
	initReady: Promise<void>;
	setTransports(): Promise<void>;
	getTransports(includeLegacyConnection?: boolean): Promise<{
		active: string;
		controller: any;
		wisp: string;
	}>;
	search(input: string): string;
	registerSW(swConfig: any): Promise<void>;
	updateSW(): void;
	uninstallSW(): void;
	redirect(
		swConfig: Record<any, any>,
		proxySetting: string,
		url: string
	): Promise<void>;
	fetch(
		url: string,
		method?: string,
		body?: any,
		headers?: [string, string][]
	): Promise<Response>;
	getFavicon(url: string): Promise<string | null>;
	generateWispServer(): string;
	checkServerWisp(): Promise<boolean>;
	swapWispServer(url?: string): Promise<void>;
	libcurl: LibcurlClient;
	pulsar: PulsarClient;
	controller: any;
}
class Proxy implements ProxyInterface {
	transportVar!: string;
	wispUrl!: string;
	settings!: SettingsAPI;
	logging!: Logger;
	hosting!: HostingAPI;
	network!: NetworkAPI;
	isStaticBuild: boolean = false;
	initReady: Promise<void>;
	libcurl!: LibcurlClient;
	pulsar!: PulsarClient;
	controller: any;
	private _searchEngines?: SearchEngineRegistry;
	get searchEngines(): SearchEngineRegistry {
		if (this._searchEngines) return this._searchEngines;
		const w = (typeof window !== 'undefined' ? window.searchEngines : undefined);
		if (!w) throw new Error('SearchEngineRegistry not yet initialized on window.searchEngines');
		return w;
	}
	set searchEngines(reg: SearchEngineRegistry) { this._searchEngines = reg; }
	get searchVar(): string { return this.searchEngines.getDefault().urlTemplate; }
	private activeTransport: string = 'libcurl';
	private controllerConfig!: SJConfig;
	private scramjetFlags!: SJFlags;
	constructor(Controller: any, SW: any, config: SJConfig, flags: SJFlags) {
		this.settings = new SettingsAPI();
		this.hosting = new HostingAPI();
		this.network = new NetworkAPI();
		this.logging = new Logger();
		this.isStaticBuild = false;
		this.controllerConfig = config;
		this.scramjetFlags = flags;

		this.initReady = (async () => {
			this.transportVar =
				(await this.settings.getItem('transports')) || 'libcurl';

			// Terbium TAPP: src/terbium/boot.ts may have set a synchronous
			// override on window before this Proxy was constructed. Honor
			// it unconditionally — Terbium's Wisp takes precedence over
			// any saved value so the shared transport stays in sync.
			const terbiumOverride =
				typeof window !== 'undefined'
					? window.__ddxOverrideWisp
					: undefined;
			if (typeof terbiumOverride === 'string' && terbiumOverride) {
				this.wispUrl = terbiumOverride;
				console.log(
					`[Proxy] Using Terbium-provided WISP: ${this.wispUrl}`
				);
				await this.settings.setItem('wisp', terbiumOverride);
				await this.settings.setItem('wisp:encoded', false);
			} else {
				const savedWisp = await this.settings.getItem<string>('wisp');
				// If the saved value is a same-origin URL that is NOT
				// `/wisp/`, it's a stale encoded route from a previous
				// build (the encoded route has been disabled). Discard it
				// and re-probe.
				let usable = savedWisp;
				if (savedWisp) {
					try {
						const parsed = new URL(savedWisp);
						const sameOrigin = parsed.host === location.host;
						if (sameOrigin && parsed.pathname !== '/wisp/') {
							console.log(
								`[Proxy] Discarding stale encoded WISP setting: ${savedWisp}`
							);
							usable = null;
						}
					} catch {
						usable = null;
					}
				}
				if (usable) {
					this.wispUrl = usable;
					console.log(`[Proxy] Using saved WISP: ${this.wispUrl}`);
				} else {
					const probe = await this.probeServer();
					if (probe) {
						this.wispUrl = probe.url;
						await this.settings.setItem('wisp', this.wispUrl);
						await this.settings.setItem(
							'wisp:encoded',
							probe.encoded
						);
						console.log(
							`[Proxy] Using ${probe.encoded ? 'encoded' : 'plain'} WISP endpoint: ${this.wispUrl}`
						);
					} else {
						const generated = this.generateWispServer();
						this.wispUrl = generated;
						await this.settings.setItem('wisp', generated);
						await this.settings.setItem('wisp:encoded', false);
						console.log(
							`[Proxy] No server WISP endpoint responded, defaulting to plain: ${generated}`
						);
					}
				}
			}

			const transportConfig = await this.buildTransportConfig();

			this.controller = new Controller({
				serviceworker: navigator.serviceWorker.controller ?? SW.active,
				transport: transportConfig.instance,
				config: this.controllerConfig,
				scramjetConfig: this.scramjetFlags
			});
			await this.controller.wait();

			installEventsBridge(this.controller);

			installScriptInjector(this.controller);

			installDevToolsHook(this.controller, () => (window as any).devtools);

			try {
				const { installDownloadsSubsystem } = await import(
					'@browser/downloads/install'
				);
				await installDownloadsSubsystem(
					this.controller as unknown as Parameters<typeof installDownloadsSubsystem>[0],
				);
			} catch (e) {
				console.warn('[proxy] failed to install downloads subsystem:', e);
			}

			try {
				const { installSitePermissionsSubsystem } = await import(
					'@browser/sitePermissions/install'
				);
				await installSitePermissionsSubsystem(
					this.controller as unknown as Parameters<typeof installSitePermissionsSubsystem>[0],
				);
			} catch (e) {
				console.warn('[proxy] failed to install sitePermissions subsystem:', e);
			}

			// Installed AFTER downloads: both tap `fetch.preresponse` and
			// run in registration order. The download plugin may consume
			// the response body; the error plugin only reads the status.
			try {
				const { installErrorPageSubsystem } = await import(
					'@browser/tabs/install'
				);
				await installErrorPageSubsystem(
					this.controller as unknown as Parameters<typeof installErrorPageSubsystem>[0],
				);
			} catch (e) {
				console.warn('[proxy] failed to install error page subsystem:', e);
			}

			try {
				const { installNyxBridgeHook } = await import('./nyxBridge/hookInstaller');
				const { NYX_ORIGINS_DEFAULT } = await import('./nyxBridge/handshake');
				installNyxBridgeHook({
					controller: this.controller,
					allowlist: NYX_ORIGINS_DEFAULT,
					resolveRealUrl: (frame: any) => {
						const el = frame?.element as
							| HTMLIFrameElement
							| undefined;
						if (!el) return (frame?.url ?? '') as string;
						return this.extractEncodedUrl(el) ?? '';
					},
					onAgentMessage: (frameId, msg, win) => {
						(window as any).nyxBridge?._receiveAgentMessage?.(frameId, msg, win);
					},
				});
			} catch (e) {
				console.warn('[proxy] failed to install nyxBridge hook:', e);
			}

			// HTTP cache plugin manager. Wraps `controller.createFrame` and
			// attaches one `HttpCachePlugin` per frame so every cacheable
			// GET/HEAD is stored in CacheStorage and served back on revisit.
			//
			// This was disabled while blank pages were being debugged on
			// proxied navigations. Root cause: `buildCacheKeyRequest` built
			// the synthetic key with a hardcoded `GET` method, so a HEAD
			// response (empty body) and a GET response for the same URL
			// shared one entry — a document navigation could be served the
			// HEAD entry's empty body. The key now includes the method.
			// Buckets are also origin-scoped, so one origin's entries can
			// never be served for another.
			//
			// See `src/apis/cachePlugins/` for the plugin code and
			// `docs/superpowers/specs/2026-06-06-opfs-cache-plugin-system-design.md`
			// for the design.
			const cachePluginManager = (window as any).cachePlugins as
				| CachePluginManager
				| undefined;
			if (cachePluginManager) {
				// Wait for persisted policies to load before any frame
				// can issue a fetch — otherwise the first request races
				// the registry load and silently misses the cache.
				await cachePluginManager.ready();
				installCachePluginManager(this.controller, cachePluginManager);
			} else {
				console.warn(
					'[proxy] window.cachePlugins not present; cache plugin manager not installed'
				);
			}

			// Install the Night+ captcha plugin. Registers the in-iframe
			// hook with `scriptInjectionRegistry` (every proxied page
			// gets it before any page script runs), mounts the host-side
			// page→host RPC bridge that gates solves on
			// `checkNightPlusStatus()`, and installs the CF full-page
			// block clearance watcher. See
			// `docs/superpowers/specs/2026-06-07-night-plus-captcha-plugin-design.md`.
			//
			// TEMPORARILY DISABLED: the injected `hook.runtime.js` was
			// filling the console with `[ddx-captcha-hook] port
			// handshake failed:` on every proxied page load (see the
			// dashboard-tab diagnosis session). Skipping install() so
			// nothing gets registered with scriptInjectionRegistry and
			// no page→host bridge is mounted. To re-enable, uncomment
			// the block below.
			//
			// const captchaManager: CaptchaManager = installCaptcha({
			// 	controller: this.controller,
			// 	proxy: this
			// });
			// (window as { captcha?: CaptchaManager }).captcha = captchaManager;
			void installCaptcha;
			void ({} as CaptchaManager);
		})();
	}

	async createFrame(
		element?: HTMLIFrameElement,
		options?: { plugins?: any[] },
	): Promise<any> {
		await this.initReady;
		return this.controller.createFrame(element, options);
	}

	/**
	 * Returns the Scramjet controller's cookieJar object, if available.
	 * Used by chrome.cookies.* host handlers. The exact shape is
	 * controller-internal; consumers should treat it as opaque and rely
	 * on the CookieAccessor abstraction in @apis/data/cookies.
	 */
	public getCookieJar(): unknown {
		return (this.controller as any)?.cookieJar ?? null;
	}

	/**
	 * Navigate a registered scramjet frame to a URL using scramjet's
	 * built-in URL rewriting (Frame.go). This is the v2-correct way to
	 * navigate a proxied frame - it handles encoding, base URL, sourcemaps
	 * etc. internally.
	 *
	 * Returns true on success, false if the frame isn't registered.
	 */
	async navigateFrame(
		target: HTMLIFrameElement | string,
		url: string
	): Promise<boolean> {
		await this.initReady;
		const element = this.resolveFrameElement(target);
		if (!element) return false;

		const frame = this.controller.frames.find(
			(f: any) => f.element === element
		);
		if (!frame || typeof frame.go !== 'function') return false;

		frame.go(url);
		return true;
	}

	deleteFrame(
		target: HTMLIFrameElement | string,
		removeElement: boolean = true
	): boolean {
		if (!this.controller || !Array.isArray(this.controller.frames)) {
			return false;
		}

		const element = this.resolveFrameElement(target);
		if (!element) return false;

		const frames = this.controller.frames;
		const index = frames.findIndex(
			(frame: any) => frame.element === element
		);

		if (index === -1) return false;

		const frame = frames[index];

		try {
			if (typeof frame.destroy === 'function') {
				frame.destroy();
			} else if (typeof frame.dispose === 'function') {
				frame.dispose();
			} else if (typeof frame.close === 'function') {
				frame.close();
			}
		} catch (err) {
			console.warn('[Proxy] Error during frame teardown:', err);
		}

		try {
			if (frame.fetchHandler?.trackedClients?.clear) {
				frame.fetchHandler.trackedClients.clear();
			}
		} catch (err) {
			console.warn('[Proxy] Error clearing tracked clients:', err);
		}

		frames.splice(index, 1);

		if (removeElement && element.parentNode) {
			element.remove();
		}

		return true;
	}

	private resolveFrameElement(
		target: HTMLIFrameElement | string
	): HTMLIFrameElement | null {
		if (typeof target === 'string') {
			const el = document.querySelector(target);
			return el instanceof HTMLIFrameElement ? el : null;
		}
		return target instanceof HTMLIFrameElement ? target : null;
	}

	getPrefixByFrame(target: HTMLIFrameElement | string): string | null {
		const element = this.resolveFrameElement(target);
		if (!element) return null;
		const frames = this.controller.frames;
		for (const frame of frames) {
			if (frame.element === element) {
				return frame.prefix;
			}
		}
		return null;
	}

	getScramObjectByFrame(target: HTMLIFrameElement | string): any | null {
		const element = this.resolveFrameElement(target);
		if (!element) return null;
		const frames = this.controller.frames;
		for (const frame of frames) {
			if (frame.element === element) {
				return frame;
			}
		}
		return null;
	}

	/**
	 * Returns the codec used by the active Scramjet config.
	 * Falls back to encodeURIComponent/decodeURIComponent if controller isn't ready.
	 */
	private getCodec(): {
		encode: (s: string) => string;
		decode: (s: string) => string;
	} {
		const controllerCodec =
			this.controller?.config?.codec ||
			this.controller?.scramjetConfig?.codec;
		if (controllerCodec?.encode && controllerCodec?.decode) {
			return controllerCodec;
		}
		const globalCodec = (self as any).__scramjet$config?.codec;
		if (globalCodec?.encode && globalCodec?.decode) {
			return globalCodec;
		}
		return {
			encode: (s: string) => {
				try {
					return encodeURIComponent(s);
				} catch {
					return s;
				}
			},
			decode: (s: string) => {
				try {
					return decodeURIComponent(s);
				} catch {
					return s;
				}
			}
		};
	}

	/**
	 * Strips leftover Scramjet path segments (controller id, frame id) that
	 * remain when a URL is sliced at a shorter prefix than the one it was
	 * encoded under. `controller.prefix` and the bare config prefix both omit
	 * the frame-id segment, so slicing at their length leaves e.g.
	 * `<frameId>/<token>`. A codec payload never contains `/`, so the final
	 * segment is the token.
	 */
	private stripPrefixSegments(encoded: string): string {
		const slash = encoded.lastIndexOf('/');
		return slash === -1 ? encoded : encoded.slice(slash + 1);
	}

	encodeUrl(url: string): string {
		if (!url) return url;
		return this.getCodec().encode(url.toString());
	}

	decodeUrl(url: string): string {
		if (!url) return url;
		try {
			return this.getCodec().decode(url);
		} catch {
			return url;
		}
	}

	/**
	 * Given an iframe (or selector) whose src is a Scramjet-rewritten URL,
	 * strip the per-frame prefix and decode the underlying URL.
	 * Returns null if the frame isn't registered or the src doesn't match.
	 *
	 * Also accepts a raw URL string + optional explicit prefix as a fallback.
	 *
	 * Scramjet builds rewritten URLs as
	 *     prefix.href + codecEncode(href) + searchPart + hashPart
	 * — the query string and fragment are appended OUTSIDE the codec payload.
	 * If we hand the slice including `?...` / `#...` straight to the codec,
	 * Obscura sees an invalid Z85 string (length not a multiple of 5, or
	 * non-Z85 characters) and throws. So we split those off, decode just the
	 * encoded segment, then reattach.
	 *
	 * Slicing may also leave leftover Scramjet path segments (controller id,
	 * frame id) when the URL was encoded under a longer prefix than the one we
	 * sliced at, so `stripPrefixSegments` normalizes those away first.
	 */
	extractEncodedUrl(
		target: HTMLIFrameElement | string,
		opts?: { url?: string; prefix?: string }
	): string | null {
		let url: string | undefined = opts?.url;
		let prefix: string | undefined = opts?.prefix;

		const element = this.resolveFrameElement(target);
		if (element) {
			url ??= element.src;
			prefix ??= this.getPrefixByFrame(element) ?? undefined;
		}

		// Prefer a registered per-frame prefix that actually matches this
		// URL. `controller.prefix` omits the frame-id segment, so slicing at
		// its length leaves that segment glued to the front of the payload
		// and the codec sees a corrupt string. Longest match wins so the
		// frame prefix is preferred over the controller prefix it extends.
		if (!prefix && url) {
			const candidates = (this.controller?.frames ?? [])
				.map((f: { prefix?: string }) => f?.prefix)
				.filter(
					(p: string | undefined): p is string =>
						typeof p === 'string' && p.length > 0 && url.includes(p)
				)
				.sort((a: string, b: string) => b.length - a.length);
			prefix = candidates[0];
		}

		if (!prefix) {
			prefix =
				this.controller?.prefix ||
				(self as any).__scramjet$config?.prefix;
		}

		if (!url || !prefix) return null;
		const idx = url.indexOf(prefix);
		if (idx === -1) return null;
		const tail = url.slice(idx + prefix.length);

		const hashIdx = tail.indexOf('#');
		const beforeHash = hashIdx === -1 ? tail : tail.slice(0, hashIdx);
		const hashPart = hashIdx === -1 ? '' : tail.slice(hashIdx);

		const queryIdx = beforeHash.indexOf('?');
		const rawEncoded =
			queryIdx === -1 ? beforeHash : beforeHash.slice(0, queryIdx);
		const queryPart = queryIdx === -1 ? '' : beforeHash.slice(queryIdx);

		const encoded = this.stripPrefixSegments(rawEncoded);

		const decoded = this.decodeUrl(encoded);
		if (decoded === encoded) return decoded;

		let out = decoded;
		if (queryPart && !out.includes('?')) out += queryPart;
		else if (queryPart) out += queryPart.replace(/^\?/, '&');
		if (hashPart && !out.includes('#')) out += hashPart;
		return out;
	}

	private encodedPath(): string {
		const cfg = buildConfig();
		return `${cfg.workspace}${cfg.cover.route}/${cfg.routes.assets}/${cfg.buildId}/`;
	}

	private canConnect(url: string): Promise<boolean> {
		return new Promise(resolve => {
			let done = false;
			const finish = (ok: boolean) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				try {
					ws.close();
				} catch {
					/* ignore */
				}
				resolve(ok);
			};
			const ws = new WebSocket(url);
			const timer = setTimeout(() => finish(false), 5000);
			ws.addEventListener('open', () => finish(true));
			ws.addEventListener('error', () => finish(false));
		});
	}

	/**
	 * Probe the server for a working WISP endpoint. Encoded/framed route is
	 * currently disabled (per operator request); we only try plain `/wisp/`
	 * so failures propagate quickly instead of spamming setTransports().
	 */
	async probeServer(): Promise<{ url: string; encoded: boolean } | null> {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const origin = `${proto}//${location.host}`;
		const url = `${origin}/wisp/`;
		if (await this.canConnect(url)) {
			console.log(`[Proxy] Server plain WISP endpoint found at ${url}`);
			return { url, encoded: false };
		}
		console.log('[Proxy] No server-side WISP endpoint available');
		return null;
	}

	/**
	 * @deprecated Prefer `probeServer()`, which tests both endpoints and
	 * returns metadata. Retained for callers that only want a boolean check
	 * of the plain `/wisp/` endpoint.
	 */
	checkServerWisp(): Promise<boolean> {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${location.host}/wisp/`;
		return this.canConnect(url).then(ok => {
			if (ok) console.log(`[Proxy] Server /wisp/ endpoint found at ${url}`);
			else console.log('[Proxy] Server /wisp/ endpoint not available');
			return ok;
		});
	}

	generateWispServer(): string {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${location.host}/wisp/`;
	}

	async swapWispServer(url?: string): Promise<void> {
		let newWisp: string;
		let encoded: boolean;
		if (url) {
			newWisp = url;
			try {
				const parsed = new URL(url);
				encoded =
					parsed.host === location.host &&
					parsed.pathname === this.encodedPath();
			} catch {
				encoded = false;
			}
		} else {
			newWisp = this.generateWispServer();
			encoded = true;
		}
		this.wispUrl = newWisp;
		await this.settings.setItem('wisp', newWisp);
		await this.settings.setItem('wisp:encoded', encoded);
		console.log(
			`[Proxy] WISP server swapped to: ${newWisp} (encoded=${encoded})`
		);
		await this.setTransports();
	}

	private async buildTransportConfig() {
		const cfg = await resolveTransportConfig(this.settings, () => {
			if (this.wispUrl) return this.wispUrl;
			return this.generateWispServer();
		});

		// Frame codec disabled — all WISP traffic uses plain frames on
		// `/wisp/`. The seeded encoded route and `installWebSocketCodec`
		// remain in the codebase for a future re-enable but are inert here.

		const built = await buildTransport(cfg);
		this.activeTransport = built.kind;

		const connectionOptions: Record<string, unknown> = {};
		if (cfg.wisp !== undefined) connectionOptions.wisp = cfg.wisp;
		if (cfg.proxy !== undefined) connectionOptions.proxy = cfg.proxy;
		if (cfg.host !== undefined) connectionOptions.host = cfg.host;
		if (cfg.port !== undefined) connectionOptions.port = cfg.port;

		return {
			key: built.kind as TransportKind,
			instance: built.instance,
			connectionOptions
		};
	}

	async setTransports() {
		await this.initReady;
		console.log('[Proxy] setTransports() called, wispUrl:', this.wispUrl);
		const transportConfig = await this.buildTransportConfig();

		if (
			this.controller &&
			typeof this.controller.setTransport === 'function'
		) {
			await this.controller.setTransport(transportConfig.instance);
		}

		console.log('[Proxy] Transport set with options:', {
			controller: transportConfig.key
		});
		if (this.logging) {
			this.logging.createLog(`Transport Set: ${transportConfig.key}`);
		}
	}

	async getTransports() {
		await this.initReady;
		const controllerTransport =
			typeof this.controller?.getTransport === 'function'
				? await this.controller.getTransport()
				: (this.controller?.transport ?? null);

		return {
			active: this.activeTransport,
			controller: controllerTransport,
			wisp: this.wispUrl
		};
	}

	search(input: string) {
		return searchImpl(input, this.searchEngines);
	}

	async registerSW(swConfig: Record<any, any>) {
		if ('serviceWorker' in navigator) {
			const scpe: string = basePath;
			console.log('[Proxy] Registering service worker with scope:', scpe);
			await navigator.serviceWorker.register(swConfig.file, {
				scope: scpe
			});

			navigator.serviceWorker.ready.then(async () => {
				console.log(
					'[Proxy] Service worker ready, setting up transports'
				);
				await this.setTransports().then(async () => {
					const transportState = await this.getTransports();
					if (transportState.controller == null) {
						console.log(
							'[Proxy] Controller transport null, retrying setTransports'
						);
						this.setTransports();
					}
				});
				this.updateSW();
			});
		}
	}

	updateSW() {
		const self = this;
		navigator.serviceWorker
			.getRegistrations()
			.then(function (registrations) {
				registrations.forEach(registration => {
					registration.update();
					self.logging.createLog(
						`Service Worker at ${registration.scope} Updated`
					);
				});
			});
	}

	uninstallSW() {
		const self = this;
		navigator.serviceWorker
			.getRegistrations()
			.then(function (registrations) {
				registrations.forEach(registration => {
					registration.unregister();
					self.logging.createLog(
						`Service Worker at ${registration.scope} Unregistered`
					);
				});
			});
	}

	/**
	 * Resolves the prefix to use when encoding a URL for an iframe.
	 * Prefers the per-frame prefix (v2), falls back to the base config prefix.
	 */
	private resolveEncodingPrefix(
		swConfigSettings: Record<any, any>,
		iframe?: HTMLIFrameElement | null
	): string {
		if (iframe) {
			const framePrefix = this.getPrefixByFrame(iframe);
			if (framePrefix) return framePrefix;
		}

		const frames = this.controller?.frames;
		if (frames && frames.length === 1 && frames[0]?.prefix) {
			return frames[0].prefix;
		}

		// Scramjet's unrewriteUrl always slices at the per-frame prefix
		// (controller.prefix + frameId + "/"). Encoding under the bare
		// config prefix produces a URL whose payload gets truncated by the
		// frame-id segment on the way back out, which makes a strict codec
		// like Obscura reject it. There is no correct prefix to use here.
		console.warn(
			'[Proxy] resolveEncodingPrefix: no per-frame prefix available; ' +
				'falling back to the base config prefix. URLs encoded with it ' +
				'will not round-trip through unrewriteUrl.',
			{ frameCount: frames?.length ?? 0 }
		);
		return swConfigSettings.config.prefix;
	}

	async redirect(
		swConfig: Record<any, any>,
		proxySetting: string,
		url: any,
		targetIframe?: HTMLIFrameElement
	) {
		console.log(
			'[Proxy] redirect() called with url:',
			url,
			'proxySetting:',
			proxySetting
		);
		let swConfigSettings: Record<any, any> | null = swConfig[proxySetting];

		if (!swConfigSettings) {
			console.log('[Proxy] No swConfigSettings found, returning');
			return;
		}

		await this.registerSW(swConfigSettings);
		await this.setTransports();

		const activeIframe: HTMLIFrameElement | null =
			targetIframe ?? document.querySelector('iframe.active');
		if (!activeIframe) {
			console.log('[Proxy] No active iframe found');
			return;
		}

		const navigated = await this.navigateFrame(
			activeIframe,
			this.search(url)
		);
		if (navigated) {
			console.log('[Proxy] Redirected via Frame.go');
			return;
		}

		const prefix = this.resolveEncodingPrefix(
			swConfigSettings,
			activeIframe
		);
		const encodedUrl =
			prefix + swConfigSettings.config.codec.encode(this.search(url));
		console.log(
			'[Proxy] Frame.go unavailable, fallback redirect to:',
			encodedUrl
		);
		activeIframe.src = encodedUrl;
	}

	async convertURL(
		swConfig: Record<any, any>,
		proxySetting: string,
		url: string,
		targetIframe?: HTMLIFrameElement
	) {
		console.log(
			'[Proxy] convertURL() called with url:',
			url,
			'proxySetting:',
			proxySetting
		);
		let swConfigSettings: Record<any, any> | null = swConfig[proxySetting];

		if (!swConfigSettings) {
			console.log('[Proxy] No swConfigSettings, returning search url');
			return this.search(url);
		}

		await this.registerSW(swConfigSettings);
		await this.setTransports();

		const iframe =
			targetIframe ??
			(document.querySelector(
				'iframe.active'
			) as HTMLIFrameElement | null);

		const prefix = this.resolveEncodingPrefix(swConfigSettings, iframe);
		const encodedUrl =
			prefix + swConfigSettings.config.codec.encode(this.search(url));
		console.log(
			'[Proxy] Converted URL to:',
			encodedUrl,
			'(prefix:',
			prefix,
			')'
		);
		return encodedUrl;
	}

	async fetch(
		url: string,
		method?: string,
		body?: any,
		headers: [string, string][] = []
	): Promise<Response> {
		if (
			typeof url !== 'string' ||
			url.trim() === '' ||
			url === 'undefined' ||
			url === 'null'
		) {
			throw new Error('[Proxy.fetch] A valid URL string is required');
		}

		await this.setTransports();
		const transportState = await this.getTransports();
		const transport = transportState.controller;

		if (!transport) {
			throw new Error('[Proxy.fetch] Transport is unavailable');
		}

		let remote: URL;
		try {
			remote = new URL(url);
		} catch {
			remote = new URL(this.search(url));
		}

		return transportFetch(transport, remote, {
			method,
			body: body ?? null,
			headers
		});
	}

	async eval(
		swConfig: Record<any, any>,
		frame: HTMLIFrameElement,
		code: string
	): Promise<boolean> {
		console.log('[Proxy.eval] Starting eval', {
			hasSrc: !!frame.src,
			src: frame.src,
			codeLength: code.length,
			codePreview: code.substring(0, 100)
		});

		if (!frame.src) {
			console.warn('[Proxy.eval] Cannot eval: frame has no src');
			return false;
		}

		let activeProxy: string | null = null;

		for (const [proxyName, proxyConfig] of Object.entries(swConfig)) {
			if (
				proxyConfig.config?.prefix &&
				frame.src.includes(proxyConfig.config.prefix)
			) {
				activeProxy = proxyName;
				console.log(
					'[Proxy.eval] Detected proxy:',
					proxyName,
					'with prefix:',
					proxyConfig.config.prefix
				);
				break;
			}
		}

		if (!activeProxy) {
			console.warn(
				'[Proxy.eval] Cannot eval: frame src does not match any proxy prefix',
				{
					frameSrc: frame.src,
					availablePrefixes: Object.entries(swConfig).map(
						([name, config]) => ({
							name,
							prefix: (config as any).config?.prefix
						})
					)
				}
			);
			return false;
		}

		try {
 if (activeProxy === 'sj') {
				console.log('[Proxy.eval] Using Scramjet eval');
				const contentWindow = frame.contentWindow;
				if (!contentWindow) {
					console.error('[Proxy.eval] contentWindow is null');
					return false;
				}
				const scramjetWrap = (contentWindow as any).$scramjet$wrap;
				if (!scramjetWrap) {
					console.error(
						'[Proxy.eval] Scramjet $scramjet$wrap not found on contentWindow'
					);
					return false;
				}
				contentWindow.$scramjet$wrap(
					(contentWindow as any).eval.call(contentWindow, code)
				);
				console.log('[Proxy.eval] Scramjet eval succeeded');
				return true;
			} else if (new URL(frame.src).pathname.includes('/internal/')) {
				console.log('[Proxy.eval] Using direct eval for internal page');
				const directEval = (frame.contentWindow as any)?.eval;
				if (!directEval) {
					console.error(
						'[Proxy.eval] Direct eval function not found on contentWindow'
					);
					return false;
				}
				directEval(code);
				console.log('[Proxy.eval] Direct eval succeeded');
				return true;
			} else {
				console.warn(
					'[Proxy.eval] Cannot eval: unsupported proxy type for eval',
					{
						activeProxy,
						frameSrc: frame.src
					}
				);
				return false;
			}
		} catch (error) {
			console.error('[Proxy.eval] Eval failed with error:', error, {
				activeProxy,
				frameSrc: frame.src,
				code: code.substring(0, 200)
			});
			return false;
		}
	}

	private faviconCache = new Map<string, string>();
	private bookmarkManager: any = null;

	public setBookmarkManager(bookmarkManager: any): void {
		this.bookmarkManager = bookmarkManager;
	}

	async getFavicon(url: string) {
		try {
			const domain = new URL(url).hostname;
			if (!domain) {
				return null;
			}

			if (this.bookmarkManager) {
				const cachedFavicon =
					this.bookmarkManager.getCachedFavicon(url);
				if (cachedFavicon) {
					return cachedFavicon;
				}
			}

			if (this.faviconCache.has(domain)) {
				return this.faviconCache.get(domain) || null;
			}

			const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

			let retries = 3;
			while (retries > 0) {
				try {
					await this.setTransports();
					break;
				} catch (transportError) {
					retries--;
					if (retries === 0) throw transportError;
					await new Promise(resolve => setTimeout(resolve, 100));
				}
			}

			const response = await this.fetch(googleFaviconUrl, 'GET', null, [
				[
					'User-Agent',
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
				]
			]);

			if (!response.ok) {
				return null;
			}

			const arrayBuffer = await response.arrayBuffer();
			const bytes = new Uint8Array(arrayBuffer);
			let binary = '';
			for (let i = 0; i < bytes.byteLength; i++) {
				binary += String.fromCharCode(bytes[i]);
			}
			const base64 = btoa(binary);

			const dataUrl = `data:image/png;base64,${base64}`;

			this.faviconCache.set(domain, dataUrl);

			if (this.bookmarkManager) {
				await this.bookmarkManager.cacheFavicon(url, dataUrl);
			}

			return dataUrl;
		} catch (error) {
			console.warn('Failed to fetch favicon:', error);
			return null;
		}
	}

	async ping(
		server: string
	): Promise<{ online: boolean; ping: number | string }> {
		return this.network.wsPing(server);
	}

	async setRemoteProxyServer(server: string) {
		await this.network.setRemoteProxyServer(server);
	}

	async getRemoteProxyServer(): Promise<string | null> {
		return await this.network.getRemoteProxyServer();
	}

	async disableReflux() {
		await this.settings.setItem('RefluxStatus', 'false');
	}

	async enableReflux() {
		await this.settings.setItem('RefluxStatus', 'true');
	}

	async getRefluxStatus(): Promise<boolean> {
		const status = await this.settings.getItem('RefluxStatus');
		return status !== 'false';
	}

	async getAuthUrl(): Promise<string> {
		try {
			const productionAuthUrl = await this.settings.getItem(
				'production_auth_url'
			);
			if (productionAuthUrl && typeof productionAuthUrl === 'string') {
				return productionAuthUrl;
			}
			return (
				(location.protocol === 'https:' ? 'https://' : 'http://') +
				location.host +
				resolvePath('auth')
			);
		} catch (error) {
			console.error('[Proxy] Error determining auth URL:', error);
			return 'https://demoplussrv.night-x.com/auth';
		}
	}

	async checkAuthentication(): Promise<boolean> {
		try {
			const basePlusPath = resolvePath('plus');
			const fileName = 'index.mjs';
			const module = await import(`${basePlusPath}/${fileName}`);
			const PlusClient = module.default;
			const client = new PlusClient();
			const sessionToken = await client.getSessionToken();
			return sessionToken !== null;
		} catch (error) {
			console.error('[Proxy] Error checking authentication:', error);
			return false;
		}
	}
}

export { Proxy };
