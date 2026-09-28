/**
 * Bootstrap static bootloader — Playwright end-to-end (Plan Task 15).
 *
 * Serves the built `dist-bootstrap/` on a local static server that sends NO
 * COOP/COEP headers, then exercises the bootstrap flow in a real Chromium
 * (persistent context; localhost is a secure context so SW + crossOriginIsolated
 * are permitted).
 *
 * Two tests:
 *
 *  1. LIVE (test.fixme) — the full flow: register `sw.js` → resolve a wisp via
 *     genBaseServerURL()/wsPing() → rip `https://daydreamx.pro/app/index.html`
 *     and its same-origin graph over libcurl+wisp into Cache Storage → host
 *     `/app/`, and assert crossOriginIsolated + navigation to `/app/`.
 *
 *     This test requires BOTH hard external dependencies to be reachable AND
 *     serving the expected content from the sandbox:
 *       - a live wisp endpoint at `<random>.nightwisp.me.cdn.cloudflare.net`
 *       - `https://daydreamx.pro/app/index.html` returning the daydream build
 *     It is marked `test.fixme` because it cannot run deterministically in an
 *     isolated CI/sandbox (no guaranteed WS egress; and the rip entry path must
 *     exist). Run it manually in an environment with the above reachable:
 *       `npx playwright test tests/bootstrap-e2e.spec.ts -g "rips daydream"`
 *
 *  2. OFFLINE (always runs) — proves the parts that need NO external network:
 *     the bootstrap SW registers + activates and injects COOP/COEP so that
 *     `crossOriginIsolated === true` after the entry's one-time reload. The rip
 *     (the only step needing egress) is not required for this assertion.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

const DIST = join(process.cwd(), 'dist-bootstrap');

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.woff2': 'font/woff2',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
};

/**
 * A deliberately plain static server: it serves `dist-bootstrap/` with correct
 * content-types but sends NO COOP/COEP/CORP headers. If the page ends up
 * crossOriginIsolated, that isolation can ONLY have come from the bootstrap SW.
 */
function startStaticServer(root: string): Promise<{ server: Server; url: string }> {
	const server = createServer((req, res) => {
		try {
			const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
			let pathname = decodeURIComponent(reqUrl.pathname);
			if (pathname.endsWith('/')) pathname += 'index.html';
			// Prevent path traversal.
			const filePath = normalize(join(root, pathname));
			if (!filePath.startsWith(root)) {
				res.statusCode = 403;
				res.end('forbidden');
				return;
			}
			const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
			res.setHeader('Content-Type', type);
			// Explicitly NO Cross-Origin-* headers here.
			const stream = createReadStream(filePath);
			stream.on('error', () => {
				res.statusCode = 404;
				res.end('not found');
			});
			stream.pipe(res);
		} catch {
			res.statusCode = 500;
			res.end('error');
		}
	});
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ server, url: `http://127.0.0.1:${port}` });
		});
	});
}

function stopServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

// Sanity: the build must exist before either test is meaningful.
test.beforeAll(async () => {
	await readFile(join(DIST, 'index.html')).catch(() => {
		throw new Error(
			`dist-bootstrap/index.html missing — build first:\n` +
				`  NODE_ENV=production npx vite build --config vite.bootstrap.config.ts`,
		);
	});
});

// ---------------------------------------------------------------------------
// 1. LIVE full E2E — requires reachable daydreamx.pro/app + a live wisp.
//    Kept verbatim to the plan's intent but marked fixme (cannot run in an
//    isolated sandbox: no guaranteed WS egress; rip entry path must exist).
// ---------------------------------------------------------------------------
test.fixme('bootstrap rips daydream and hosts /app/ (live wisp + origin required)', async () => {
	test.setTimeout(180_000);
	const { server, url } = await startStaticServer(DIST);
	let profileDir = '';
	let context: BrowserContext | undefined;
	try {
		profileDir = await mkdtemp(join(tmpdir(), 'bootstrap-e2e-'));
		context = await chromium.launchPersistentContext(profileDir, {
			executablePath: '/usr/bin/chromium',
			headless: true,
			args: ['--no-sandbox'],
			viewport: { width: 1280, height: 720 },
		});
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(url + '/');
		// SW-injected COOP/COEP take effect after the entry's one-time reload.
		await page.waitForFunction(() => (self as any).crossOriginIsolated === true, null, {
			timeout: 60_000,
		});
		// Rip completes over libcurl+wisp, then entry navigates to /app/.
		await page.waitForURL(/\/app\/?$/, { timeout: 120_000 });
		await expect(page).toHaveTitle(/Portal|Dashboard|Console|Projects|Workspace|DayDream|\$/, {
			timeout: 30_000,
		});
	} finally {
		await context?.close().catch(() => undefined);
		if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
		await stopServer(server);
	}
});

// ---------------------------------------------------------------------------
// 2. OFFLINE — SW registration + COOP/COEP injection (no external network).
//
// This proves the parts that need NO egress: the bootstrap SW registers +
// activates and injects COOP/COEP so the page becomes crossOriginIsolated after
// the entry's one-time reload. The rip (the only step needing network) is not
// awaited here.
//
// Marked `test.fixme` because it is currently BLOCKED by two real bugs in the
// bootstrap source/build (verified empirically against `dist-bootstrap/`), NOT
// by any sandbox/network limitation. The assertions below are intentionally
// left intact — remove `.fixme` once the bugs are fixed and this becomes a
// genuine, sandbox-independent regression test.
//
//   BUG 1 — bootstrap/src/entry.ts:6 calls installRegisterPolyfill(navigator),
//     which replaces navigator.serviceWorker.register with a no-op synthetic
//     (bootstrap/src/sw/register-polyfill.ts:14), BEFORE entry.ts:13 registers
//     the bootstrap's own './sw.js'. The real SW therefore never registers and
//     `await navigator.serviceWorker.ready` (entry.ts:16) never resolves — the
//     page hangs at "Starting…". (No /sw.js request is ever made.)
//
//   BUG 2 — dist-bootstrap/sw.js is emitted as an ES module (top-level
//     `import ... from "./assets/config-*.js"` plus code-split dynamic imports
//     via __vite__mapDeps), but entry.ts:13 registers it as a CLASSIC worker
//     (no `{ type: 'module' }`). Classic workers cannot use ESM `import`, so the
//     script fails with "ServiceWorker script evaluation failed" (confirmed by
//     forcing a native registration). vite.bootstrap.config.ts must emit an IIFE
//     SW bundle (inlined, no code-split) or the registration must use
//     `{ type: 'module' }` with same-origin module chunks available.
// ---------------------------------------------------------------------------
test('bootstrap SW registers and makes the page crossOriginIsolated (offline)', async () => {
	test.setTimeout(120_000);
	const { server, url } = await startStaticServer(DIST);
	let profileDir = '';
	let context: BrowserContext | undefined;
	const pageErrors: string[] = [];
	try {
		profileDir = await mkdtemp(join(tmpdir(), 'bootstrap-e2e-offline-'));
		context = await chromium.launchPersistentContext(profileDir, {
			executablePath: '/usr/bin/chromium',
			headless: true,
			args: ['--no-sandbox'],
			viewport: { width: 1280, height: 720 },
		});
		const page: Page = context.pages()[0] ?? (await context.newPage());
		page.on('pageerror', (e) => pageErrors.push(e.message));

		await page.goto(url + '/', { waitUntil: 'domcontentloaded' });

		// The entry performs a one-time reload so the SW-injected COOP/COEP apply.
		// This requires NO external network — the rip (which does) is not awaited here.
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
			timeout: 60_000,
		});
		await page.waitForFunction(() => (self as any).crossOriginIsolated === true, null, {
			timeout: 60_000,
		});

		const controller = await page.evaluate(
			() => navigator.serviceWorker.controller !== null,
		);
		const coi = await page.evaluate(() => (self as any).crossOriginIsolated === true);
		const swScriptUrl = await page.evaluate(async () => {
			const reg = await navigator.serviceWorker.getRegistration('/');
			return reg?.active?.scriptURL ?? null;
		});

		expect(controller).toBe(true);
		expect(coi).toBe(true);
		expect(swScriptUrl).toMatch(/sw\.js$/);
	} finally {
		await context?.close().catch(() => undefined);
		if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
		await stopServer(server);
	}
});
