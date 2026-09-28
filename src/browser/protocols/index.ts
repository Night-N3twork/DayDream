import { Logger } from '@apis/logging';
import { SettingsAPI } from '@apis/settings';
import { Items } from '@browser/items';
import { Proxy } from '@apis/proxy';
import { resolvePath } from '@utils/basepath';
import { isCustomHomePage } from '@utils/homePage';
import { BUILTIN_PROTOCOL_ROUTES } from './manifest';

interface RouteEntry {
	url: string;
	proxy: boolean;
}

export interface ProtocolRouteSnapshot {
	proto: string;
	path: string;
	url: string;
	proxy: boolean;
}

interface ProtoInterface {
	logging: Logger;
	settings: SettingsAPI;
	items: Items;
	proxy: Proxy;
	register(proto: string, path: string, url: string, proxy: boolean): void;
	processUrl(
		url: string,
		targetIframe?: HTMLIFrameElement
	): Promise<string | void>;
	getInternalURL(url: string): Promise<string | void>;
	navigate(url: string): void;
	isRegisteredProtocol(url: string): boolean;
}

class Protocols implements ProtoInterface {
	logging: Logger;
	settings: SettingsAPI;
	items: Items;
	proxy: Proxy;
	private routes: Map<string, Map<string, RouteEntry>>;
	private swConfig: Record<any, any>;
	private proxySetting: string;

	constructor(
		swConfig: Record<any, any>,
		proxySetting: string,
		proxy: Proxy
	) {
		this.logging = new Logger();
		this.settings = new SettingsAPI();
		this.items = new Items();
		this.proxy = proxy;
		this.routes = new Map();
		this.swConfig = swConfig;
		this.proxySetting = proxySetting;

		for (const route of BUILTIN_PROTOCOL_ROUTES) {
			const url = route.urlResolver === 'basepath' ? resolvePath(route.url) : route.url;
			this.register(route.proto, route.path, url, route.proxy);
		}

		this.initCustomProtocols();
	}

	private async initCustomProtocols(): Promise<void> {
		const newtabPage = await this.settings.getItem('newtabPage');
		const newtabCustomUrl = await this.settings.getItem('newtabCustomUrl');
		const homePage = await this.settings.getItem<string>('homePage');

		if (newtabPage === 'custom' && newtabCustomUrl) {
			this.register('ddx', 'newtab', newtabCustomUrl, true);
		} else if (newtabPage === 'blank') {
			this.register('ddx', 'newtab', 'about:blank', false);
		} else {
			this.register(
				'ddx',
				'newtab',
				resolvePath('internal/newtab'),
				false
			);
		}

		if (isCustomHomePage(homePage)) {
			this.register('ddx', 'home', homePage, true);
		} else {
			this.register('ddx', 'home', resolvePath('internal/newtab'), false);
		}
	}

	async updateNewtabProtocol(
		page: string,
		customUrl?: string
	): Promise<void> {
		this.extensionOverrides.newtab = null;
		if (page === 'custom' && customUrl) {
			this.register('ddx', 'newtab', customUrl, true);
		} else if (page === 'blank') {
			this.register('ddx', 'newtab', 'about:blank', false);
		} else {
			this.register(
				'ddx',
				'newtab',
				resolvePath('internal/newtab'),
				false
			);
		}
	}

	async updateHomeProtocol(homePage: string | null): Promise<void> {
		if (isCustomHomePage(homePage)) {
			this.register('ddx', 'home', homePage, true);
		} else {
			this.register('ddx', 'home', resolvePath('internal/newtab'), false);
		}
	}

	private extensionOverrides: { newtab: string | null; bookmarks: string | null; history: string | null } = {
		newtab: null,
		bookmarks: null,
		history: null,
	};

	/**
	 * Apply an extension-served URL to one of the override slots.
	 * Re-registers the `ddx://<kind>` route. Idempotent.
	 *
	 * `url` should be `https://<extId>.ddx/<path>` — i.e. directly
	 * pointing at HeliumExtensionPlugin-served content. We mark it
	 * `proxy: false` because the extension serves through its own
	 * SW plugin path, not Scramjet's web-content proxy.
	 */
	setExtensionOverride(kind: 'newtab' | 'bookmarks' | 'history', url: string): void {
		this.extensionOverrides[kind] = url;
		this.register('ddx', kind, url, false);
	}

	/**
	 * Reset a slot back to its default `internal/<kind>` page.
	 */
	async clearExtensionOverride(kind: 'newtab' | 'bookmarks' | 'history'): Promise<void> {
		this.extensionOverrides[kind] = null;
		if (kind === 'newtab') {
			const page = await this.settings.getItem('newtabPage');
			const customUrl = await this.settings.getItem('newtabCustomUrl');
			if (page === 'custom' && customUrl) {
				this.register('ddx', 'newtab', customUrl, true);
			} else if (page === 'blank') {
				this.register('ddx', 'newtab', 'about:blank', false);
			} else {
				this.register('ddx', 'newtab', resolvePath('internal/newtab'), false);
			}
			return;
		}
		this.register('ddx', kind, resolvePath(`internal/${kind}`), false);
	}

	/** Read the currently active extension override URL (or null). */
	getExtensionOverride(kind: 'newtab' | 'bookmarks' | 'history'): string | null {
		return this.extensionOverrides[kind];
	}

	register(proto: string, path: string, url: string, proxy: boolean): void {
		const cleanProto = proto.toLowerCase();
		if (!this.routes.has(cleanProto)) {
			this.routes.set(cleanProto, new Map());
		}
		const protoMap = this.routes.get(cleanProto)!;
		const isOverride = protoMap.has(path);
		protoMap.set(path, { url, proxy });
		console.log(
			`[Protocols] ${isOverride ? 'Overriding' : 'Registering'} ${cleanProto}://${path} -> ${url} (proxy: ${proxy})`
		);
	}

	async processUrl(
		url: string,
		targetIframe?: HTMLIFrameElement
	): Promise<string | void> {
		console.log('[Protocols] processUrl() called with:', url);
		if (url.startsWith('javascript:')) {
			const js = url.slice('javascript:'.length);
			const iframe =
				targetIframe ??
				(document.querySelector(
					'iframe.active'
				) as HTMLIFrameElement | null);
			if (iframe?.contentWindow) {
				(iframe.contentWindow as any).eval(js);
			}
		}

		const match = url.match(/^([a-zA-Z0-9+.-]+):\/\/(.+)/);

		if (match) {
			const proto = match[1].toLowerCase();
			const pathRaw = match[2];
			const path = pathRaw.replace(/\/+$/, '');
			const protoRoutes = this.routes.get(proto);

			console.log(
				'[Protocols] Matched protocol:',
				proto,
				'raw path:',
				pathRaw,
				'normalized:',
				path
			);

			if (protoRoutes) {
				let resolved: RouteEntry | undefined;

				if (protoRoutes.has(path)) {
					resolved = protoRoutes.get(path);
				} else if (protoRoutes.has('*')) {
					const wildcard = protoRoutes.get('*');
					if (wildcard) {
						const fullUrl = this.joinURL(wildcard.url, path);
						console.log(
							'[Protocols] Using wildcard route, fullUrl:',
							fullUrl,
							'proxy:',
							wildcard.proxy
						);
						return wildcard.proxy
							? await this.proxy.convertURL(
									this.swConfig,
									this.proxySetting,
									fullUrl,
									targetIframe
								)
							: fullUrl;
					}
				}

				if (resolved) {
					console.log(
						'[Protocols] Resolved route, url:',
						resolved.url,
						'proxy:',
						resolved.proxy
					);
					return resolved.proxy
						? await this.proxy.convertURL(
								this.swConfig,
								this.proxySetting,
								resolved.url,
								targetIframe
							)
						: resolved.url;
				}
			}
		}

		if (
			url.startsWith('http://') ||
			url.startsWith('https://') ||
			url.startsWith('/') ||
			url.startsWith('data:')
		) {
			if (url.startsWith('http://') || url.startsWith('https://')) {
				try {
					const urlObj = new URL(url);
					if (urlObj.host !== location.host) {
						return await this.proxy.convertURL(
							this.swConfig,
							this.proxySetting,
							url,
							targetIframe
						);
					}
				} catch (error) {
					console.error('Error parsing URL for proxy check:', error);
				}
			}
			return url;
		}

		return resolvePath('internal/' + url);
	}

	getInternalURL(url: string): Promise<string | void> {
		for (const [proto, pathMap] of this.routes.entries()) {
			for (const [pathKey, { url: baseUrl }] of pathMap.entries()) {
				if (pathKey === '*') {
					if (url.startsWith(baseUrl)) {
						const remainingPath = url
							.slice(baseUrl.length)
							.replace(/^\/+/, '');
						return Promise.resolve(`${proto}://${remainingPath}`);
					}
				} else {
					if (url === baseUrl) {
						return Promise.resolve(`${proto}://${pathKey}`);
					}
				}
			}
		}

		const internalPrefix = resolvePath('internal/');
		if (url.startsWith(internalPrefix)) {
			return Promise.resolve('ddx://' + url.slice(internalPrefix.length));
		}

		return Promise.resolve(url);
	}

	async navigate(url: string): Promise<void> {
		console.log('[Protocols] navigate() called with url:', url);
		try {
			if (!this.items.frameContainer) {
				this.logging.createLog('iframeContainer is not available.');
				return;
			}

			const iframe = this.items.frameContainer!.querySelector(
				'iframe.active'
			) as HTMLIFrameElement | null;

			const processedUrl =
				(await this.processUrl(url, iframe ?? undefined)) ||
				resolvePath('internal/error/');
			console.log('[Protocols] Processed URL:', processedUrl);

			if (iframe) {
				console.log('[Protocols] Setting iframe src to:', processedUrl);
				const navTabId =
					iframe.getAttribute('data-tab-id') || 'unknown';
				const beforeDetail = {
					tabId: navTabId,
					url: processedUrl,
					phase: 'before' as const,
					fromProtocol: true
				};
				window.dispatchEvent(
					new CustomEvent('tabNavigated', { detail: beforeDetail })
				);
				document.dispatchEvent(
					new CustomEvent('tabNavigated', { detail: beforeDetail })
				);

				iframe.setAttribute('src', processedUrl);
				this.logging.createLog(`Navigated to: ${processedUrl}`);

				const committedDetail = {
					tabId: navTabId,
					url: processedUrl,
					phase: 'committed' as const,
					fromProtocol: true
				};
				window.dispatchEvent(
					new CustomEvent('tabNavigated', { detail: committedDetail })
				);
				document.dispatchEvent(
					new CustomEvent('tabNavigated', { detail: committedDetail })
				);
			} else {
				console.log('[Protocols] No active iframe found');
			}
		} catch (error) {
			console.error('[Protocols] Error in navigate():', error);
		}
	}

	private joinURL(base: string, path: string): string {
		const endsWithSlash = base.endsWith('/');
		const startsWithSlash = path.startsWith('/');
		if (endsWithSlash && startsWithSlash) {
			return base + path.slice(1);
		} else if (!endsWithSlash && !startsWithSlash) {
			return base + '/' + path;
		}
		return base + path;
	}

	isRegisteredProtocol(url: string): boolean {
		const match = url.match(/^([a-zA-Z0-9+.-]+):\/\//);
		if (!match) {
			return false;
		}
		const proto = match[1].toLowerCase();
		return this.routes.has(proto);
	}

	listRoutes(): ProtocolRouteSnapshot[] {
		const out: ProtocolRouteSnapshot[] = [];
		for (const [proto, pathMap] of this.routes.entries()) {
			for (const [path, entry] of pathMap.entries()) {
				out.push({ proto, path, url: entry.url, proxy: entry.proxy });
			}
		}
		return out;
	}
}

export { Protocols };
