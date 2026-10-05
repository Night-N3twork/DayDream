import { describe, expect, it, vi } from "vitest";
import {
	ANALYTICS_CACHE,
	isAnalyticsTagRequest,
	serveAnalyticsTag,
} from "./analytics";

const UPSTREAM_BODY = 'window.gtagLoaded=true;';

function deps(overrides: Record<string, unknown> = {}) {
	const store = new Map<string, { body: string; storedAt: number }>();
	const cache = {
		async match(url: string) {
			const entry = store.get(url);
			if (!entry) return null;
			return new Response(entry.body, {
				headers: { 'x-analytics-cached-at': String(entry.storedAt) },
			});
		},
		async put(url: string, response: Response) {
			store.set(url, {
				body: await response.text(),
				storedAt: Number(
					response.headers.get('x-analytics-cached-at') ?? Date.now()
				),
			});
		},
	};
	return {
		store,
		origin: 'https://daydream.example',
		caches: { open: vi.fn(async () => cache) },
		fetchFn: vi.fn(async () => new Response(UPSTREAM_BODY)),
		now: () => 1_000_000,
		...overrides,
	};
}

const request = (url: string, method = 'GET') => ({ url, method }) as Request;

describe("isAnalyticsTagRequest", () => {
	it("matches only same-origin GET /api/tag.js", () => {
		expect(
			isAnalyticsTagRequest(
				'https://daydream.example/api/tag.js',
				'https://daydream.example'
			)
		).toBe(true);
		expect(
			isAnalyticsTagRequest(
				'https://daydream.example/api/tag.js?id=G-OTHER',
				'https://daydream.example'
			)
		).toBe(true);
		expect(
			isAnalyticsTagRequest(
				'https://cdn.jsdelivr.net/gh/TwiLabs/r6b2w9tz@main/app/api/tag.js',
				'https://cdn.jsdelivr.net'
			)
		).toBe(true);
		expect(
			isAnalyticsTagRequest(
				'https://evil.example/api/tag.js',
				'https://daydream.example'
			)
		).toBe(false);
		expect(
			isAnalyticsTagRequest(
				'https://daydream.example/api/other.js',
				'https://daydream.example'
			)
		).toBe(false);
	});
});

describe("serveAnalyticsTag", () => {
	it("ignores non-tag and non-GET requests", async () => {
		const d = deps();
		expect(
			await serveAnalyticsTag(
				request('https://daydream.example/app.js'),
				d as never
			)
		).toBeNull();
		expect(
			await serveAnalyticsTag(
				request('https://daydream.example/api/tag.js', 'POST'),
				d as never
			)
		).toBeNull();
		expect(d.fetchFn).not.toHaveBeenCalled();
	});

	it("fetches the fixed upstream, caches, and serves it", async () => {
		const d = deps();
		const response = await serveAnalyticsTag(
			request('https://daydream.example/api/tag.js'),
			d as never
		);
		expect(response).not.toBeNull();
		expect(await response!.text()).toBe(UPSTREAM_BODY);
		expect(d.fetchFn).toHaveBeenCalledOnce();
		const calls = d.fetchFn.mock.calls as unknown[][];
		expect(String(calls[0]?.[0])).toContain(
			'googletagmanager.com/gtag/js?id=G-BMERY7ZH6Z'
		);
		expect(d.caches.open).toHaveBeenCalledWith(ANALYTICS_CACHE);
	});

	it("serves fresh cache without hitting upstream", async () => {
		const d = deps();
		await serveAnalyticsTag(
			request('https://daydream.example/api/tag.js'),
			d as never
		);
		d.fetchFn.mockClear();
		const response = await serveAnalyticsTag(
			request('https://daydream.example/api/tag.js'),
			d as never
		);
		expect(await response!.text()).toBe(UPSTREAM_BODY);
		expect(d.fetchFn).not.toHaveBeenCalled();
	});

	it("revalidates stale cache and serves the new body", async () => {
		const d = deps({ now: () => 1_000_000 + 600_000 });
		d.store.set('https://daydream.example/api/tag.js', {
			body: 'stale',
			storedAt: 1_000_000,
		});
		d.fetchFn = vi.fn(async () => new Response('fresh'));
		const response = await serveAnalyticsTag(
			request('https://daydream.example/api/tag.js'),
			d as never
		);
		expect(await response!.text()).toBe('fresh');
	});

	it("serves stale cache when upstream errors, null when nothing cached", async () => {
		const failing = () => {
			throw new Error('offline');
		};
		const stale = deps();
		stale.store.set('https://daydream.example/api/tag.js', {
			body: 'stale',
			storedAt: 0,
		});
		stale.fetchFn = vi.fn(failing);
		expect(
			await (
				await serveAnalyticsTag(
					request('https://daydream.example/api/tag.js'),
					stale as never
				)
			)!.text()
		).toBe('stale');

		const empty = deps();
		empty.fetchFn = vi.fn(failing);
		expect(
			await serveAnalyticsTag(
				request('https://daydream.example/api/tag.js'),
				empty as never
			)
		).toBeNull();
	});
});
