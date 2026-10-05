import { ServiceWorkerSettings } from '@core/sw/settings';

import {
	primeJsonCache,
	serveInternalPage,
	serveJsonFile,
	serveResFile
} from '@core/sw/cache';
import { installConsolePolyfill } from '@core/sw/console';
import { serveAnalyticsTag } from '@core/sw/analytics';
import { basePath, stripBase } from '@core/shared/path';
import {
	buildTransport,
	resolveTransportConfig,
	transportFetch,
	type BuiltTransport
} from '@core/shared/transport';
import {
	createCorsPreflightResponse,
	getErrorMessage,
	isCfRequest,
	isInternalRoute,
	isJsonCacheRoute,
	isResCacheRoute,
	isServerRoutedEndpoint,
	shouldRestoreRequest
} from '@core/sw/req';
import { WispManager } from '@core/sw/wisp';
import {
	applySwDnrUpdate,
	evaluateSwLevelRules,
	SW_DNR_UPDATE_MESSAGE_TYPE,
	type SwDnrUpdateMessage
} from '@core/helium/host/webRequest/sw-hook';

if (navigator.userAgent.includes('Firefox')) {
	Object.defineProperty(globalThis, 'crossOriginIsolated', {
		value: true,
		writable: false
	});
}

installConsolePolyfill();

type FetchEventLike = {
	request: Request;
	respondWith: (response: Response | Promise<Response>) => void;
};

type ExtendableEventLike = {
	waitUntil: (promise: Promise<unknown>) => void;
};

type MessageEventLike = {
	data?: { type?: string };
};

declare function importScripts(...urls: string[]): void;

const swSelf = self as unknown as {
	skipWaiting: () => void;
	clients: { claim: () => Promise<void> };
	location: { origin: string };
	addEventListener: (type: string, listener: (event: any) => void) => void;
};

importScripts(basePath + 'assets/sw.js');

class DDXWorker {
	private readonly cfBlockPatterns = ['**/cdn-cgi/**'];
	private readonly restoredEndpoints = [
		'/api/results/',
		'/api/plus',
		'/api/store/',
		'/auth/',
		'/auth'
	];
	private readonly serverRoutedEndpoints = [
		'/api/results/',
		'/auth/',
		'/auth'
	];
	private hasServerRoutes: boolean | null = null;
	private readonly productionUrl = 'https://daydreamx.pro';
	/**
	 * Cached transport instance keyed by the JSON signature of its
	 * config. Settings changes (transport kind, wisp, proxy, pulsar
	 * host/port) yield a new signature on the next request, which
	 * triggers a rebuild. Errors null this out so the next request
	 * starts fresh.
	 */
	private transportCache: BuiltTransport | null = null;
	private readonly wispManager: WispManager;
	private readonly settings: ServiceWorkerSettings;

	constructor() {
		this.settings = new ServiceWorkerSettings();
		this.wispManager = new WispManager(this.settings);
	}

	/**
	 * Resolves the configured transport, rebuilding only when settings
	 * have changed since the last fetch. Mirrors the construction logic
	 * used by `Proxy.buildTransportConfig` (src/apis/proxy.ts) via the
	 * shared module — no IPC, no SharedWorker, no BareMux.
	 */
	private async getTransport() {
		const cfg = await resolveTransportConfig(this.settings, () =>
			this.wispManager.computeWispUrl()
		);
		const signature = JSON.stringify(cfg);

		if (this.transportCache?.signature !== signature) {
			console.log(
				`[DDXWorker] Building transport (kind=${cfg.kind}, sig changed)`
			);
			this.transportCache = await buildTransport(cfg);
		}

		return this.transportCache.instance;
	}

	private async checkHasServerRoutes(): Promise<boolean> {
		if (this.hasServerRoutes !== null) {
			return this.hasServerRoutes;
		}

		try {
			const checkUrl = new URL('/api/results/', self.location.origin);
			checkUrl.searchParams.set('__ddx_route_check', '1');
			const response = await fetch(checkUrl.toString(), {
				method: 'GET',
				cache: 'no-store'
			});

			this.hasServerRoutes = response.status !== 404;

			console.log(
				`[DDXWorker] Server routes check: ${this.hasServerRoutes ? 'available (status: ' + response.status + ')' : 'not available'}`
			);

			return this.hasServerRoutes;
		} catch (err) {
			console.log(
				'[DDXWorker] Server routes check failed:',
				getErrorMessage(err)
			);
			this.hasServerRoutes = false;
			return false;
		}
	}

	private async restoreRequest(request: Request): Promise<Response> {
		const originalUrl = new URL(request.url);
		const relativePath = stripBase(originalUrl.pathname);
		const productionUrl = new URL(
			relativePath + originalUrl.search,
			this.productionUrl
		);

		console.log(
			`[DDXWorker] restoreRequest: ${request.method} ${relativePath} -> ${productionUrl.toString()}`
		);

		const headerPairs: [string, string][] = [];
		for (const [key, value] of request.headers.entries()) {
			if (key.toLowerCase() === 'host') continue;
			headerPairs.push([key, value]);
		}

		let body: ArrayBuffer | null = null;
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			body = await request.clone().arrayBuffer();
		}

		try {
			const transport = await this.getTransport();
			const response = await transportFetch(transport, productionUrl, {
				method: request.method,
				headers: headerPairs,
				body
			});

			console.log(
				`[DDXWorker] restoreRequest OK: ${response.status} ${relativePath}`
			);

			const responseHeaders = new Headers(response.headers);
			responseHeaders.set('Access-Control-Allow-Origin', '*');
			responseHeaders.set(
				'Access-Control-Allow-Methods',
				'GET, POST, PUT, DELETE, OPTIONS'
			);
			responseHeaders.set('Access-Control-Allow-Headers', '*');

			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders
			});
		} catch (error) {
			console.error(
				'[DDXWorker] restoreRequest failed:',
				getErrorMessage(error)
			);
			this.transportCache = null;

			return new Response(
				JSON.stringify({
					error: 'Proxy error',
					message: 'Failed to proxy request to backend',
					details: String(error)
				}),
				{
					status: 502,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				}
			);
		}
	}

	async handleRequest(event: FetchEventLike): Promise<Response> {
		const url = new URL(event.request.url);
		const relativePath = stripBase(url.pathname);

		if (url.searchParams.has('__ddx_route_check')) {
			return fetch(event.request);
		}

		// First-party analytics library. Served from cache/the fixed
		// upstream so static deploys work; never waits on transport.
		const analyticsResponse = await serveAnalyticsTag(event.request, {
			origin: swSelf.location.origin,
			caches,
			fetchFn: fetch
		});
		if (analyticsResponse) return analyticsResponse;

		await this.wispManager.ensureWisp();

		try {
			const swResult = await evaluateSwLevelRules(event);
			if (swResult) return swResult;
		} catch (err) {
			console.warn('[DDXWorker] evaluateSwLevelRules failed:', err);
		}

		if (isCfRequest(event.request.url, this.cfBlockPatterns)) {
			return new Response(null, { status: 204 });
		}

		/*if (
			(await this.isAdBlockEnabled()) &&
			isAdRequest(event.request.url, event.request)
		) {
			return new Response(null, { status: 204 });
		}*/

		if (isInternalRoute(relativePath)) {
			if (!/\.\w+$/.test(relativePath) && !relativePath.endsWith('/')) {
				const redirectUrl = new URL(event.request.url);
				redirectUrl.pathname += '/';
				return Response.redirect(redirectUrl.toString(), 301);
			}
			return serveInternalPage(relativePath);
		}

		if (isJsonCacheRoute(relativePath) && event.request.method === 'GET') {
			return serveJsonFile(relativePath);
		}

		if (isResCacheRoute(relativePath) && event.request.method === 'GET') {
			return serveResFile(relativePath);
		}

		if (shouldRestoreRequest(relativePath, this.restoredEndpoints)) {
			if (
				isServerRoutedEndpoint(relativePath, this.serverRoutedEndpoints)
			) {
				const hasServerRoutes = await this.checkHasServerRoutes();
				if (hasServerRoutes) {
					console.log(
						`[DDXWorker] Using server route for ${event.request.method} ${relativePath}`
					);
					const serverUrl = new URL(
						relativePath + url.search,
						url.origin
					);
					const serverRequest = new Request(
						serverUrl.toString(),
						event.request
					);
					return fetch(serverRequest);
				}
			}

			if (event.request.method === 'OPTIONS') {
				return createCorsPreflightResponse();
			}

			return this.restoreRequest(event.request);
		}

		try {
			const sjController = $scramjetController as unknown as {
				shouldRoute: (event: FetchEventLike) => boolean;
				route: (event: FetchEventLike) => Promise<Response>;
			};
			if (sjController.shouldRoute(event)) {
				return sjController.route(event);
			}
		} catch (e) {
			console.warn('[DDXWorker] Scramjet route/fetch error:', e);
		}

		return fetch(event.request);
	}

	async ensureWisp(): Promise<boolean> {
		return this.wispManager.ensureWisp();
	}

	async primeCache(): Promise<void> {
		await primeJsonCache();
	}
}

const ddx = new DDXWorker();

swSelf.addEventListener('install', () => {
	console.log('[DDXWorker] Installing...');
	swSelf.skipWaiting();
});

swSelf.addEventListener('activate', (event: ExtendableEventLike) => {
	console.log('[DDXWorker] Activating...');
	// Each step is independently wrapped so a failure in primeCache
	// (e.g. corrupt OPFS state from a previous build's interrupted
	// write) doesn't prevent claim() or ensureWisp() from running.
	// SettingsAPI self-heals corrupt files on the NEXT read, so even if
	// this activate falls through, subsequent fetches will recover.
	event.waitUntil(
		swSelf.clients
			.claim()
			.catch(err => {
				console.warn('[DDXWorker] clients.claim() failed:', err);
			})
			.then(() =>
				ddx.primeCache().catch(err => {
					console.warn(
						'[DDXWorker] primeCache failed (continuing):',
						err
					);
				})
			)
			.then(() =>
				ddx.ensureWisp().catch(err => {
					console.warn(
						'[DDXWorker] ensureWisp failed (continuing):',
						err
					);
				})
			)
	);
});

swSelf.addEventListener('message', (event: MessageEventLike) => {
	const data = event.data;
	if (!data?.type) return;

	switch (data.type) {
		case SW_DNR_UPDATE_MESSAGE_TYPE:
			try {
				applySwDnrUpdate(data as SwDnrUpdateMessage);
			} catch (err) {
				console.warn('[DDXWorker] applySwDnrUpdate failed:', err);
			}
			break;
		case 'ddx:wisp-override': {
			// Terbium TAPP: boot.ts posts the Wisp URL once it has resolved
			// it from parent.window.tb. Cache on `self` so WispManager can
			// read it synchronously inside ensureWisp().
			const url = (data as { url?: unknown }).url;
			if (typeof url === 'string' && url.length > 0) {
				(self as any).__ddxOverrideWisp = url;
				console.log('[DDXWorker] received Terbium Wisp override:', url);
			}
			break;
		}
		default:
			console.log('[DDXWorker] Unknown message type:', data.type);
			break;
	}
});

swSelf.addEventListener('fetch', (event: FetchEventLike) => {
	event.respondWith(
		ddx.handleRequest(event).catch(err => {
			console.error(
				'[DDXWorker] handleRequest failed, passing through:',
				err
			);
			return fetch(event.request);
		})
	);
});
