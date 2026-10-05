// First-party analytics library served from the service worker so static
// deploys (no API server) still get a working tag. Fixed upstream only:
// this must never become an arbitrary URL proxy.
export const ANALYTICS_TAG_ID = 'G-BMERY7ZH6Z';
export const ANALYTICS_UPSTREAM = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_TAG_ID}`;
export const ANALYTICS_CACHE = 'ddx-analytics-v1';
export const ANALYTICS_MAX_AGE_MS = 300_000;

export function isAnalyticsTagRequest(
	requestUrl: string,
	selfOrigin: string
): boolean {
	try {
		const url = new URL(requestUrl);
		// Suffix match: static subpath mounts serve this under the package
		// base, not the origin root. Same-origin only.
		return (
			url.origin === selfOrigin && url.pathname.endsWith('/api/tag.js')
		);
	} catch {
		return false;
	}
}

interface AnalyticsDeps {
	origin: string;
	caches: {
		open: (name: string) => Promise<{
			match: (url: string) => Promise<Response | null | undefined>;
			put: (url: string, response: Response) => Promise<void>;
		}>;
	};
	fetchFn: (
		url: string,
		init?: RequestInit
	) => Promise<{ ok: boolean; text: () => Promise<string> }>;
	now?: () => number;
}

export async function serveAnalyticsTag(
	request: { url: string; method: string },
	deps: AnalyticsDeps
): Promise<Response | null> {
	if (request.method !== 'GET') return null;
	if (!isAnalyticsTagRequest(request.url, deps.origin)) return null;
	const now = deps.now ?? Date.now;
	const cache = await deps.caches.open(ANALYTICS_CACHE);
	const cached = (await cache.match(request.url)) ?? null;
	const fresh =
		cached !== null &&
		Number(cached.headers.get('x-analytics-cached-at') ?? 0) +
			ANALYTICS_MAX_AGE_MS >
			now();
	if (fresh) return cached;
	try {
		const upstream = await deps.fetchFn(ANALYTICS_UPSTREAM, {
			redirect: 'error',
			signal: AbortSignal.timeout(5000)
		});
		if (!upstream.ok) return cached;
		const headers = new Headers({ 'x-analytics-cached-at': String(now()) });
		headers.set('content-type', 'application/javascript; charset=utf-8');
		const body = await upstream.text();
		await cache.put(
			request.url,
			new Response(body, { headers }) as unknown as Response
		);
		return new Response(body, { headers });
	} catch {
		return cached;
	}
}
