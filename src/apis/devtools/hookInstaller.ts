/**
 * Scramjet plugin that injects the per-frame devtools agent into every
 * proxied window for tabs that have DevTools open.
 *
 * Injection strategy: fetch the agent source from the host realm once,
 * then evaluate it inside the proxied window via `contentWindow.eval`.
 * We do NOT route the result through the Scramjet wrap function (the
 * vendored build renames it `_ddx$wrap` and it isn't always present
 * when init.post fires anyway). Wrapping the eval RESULT only matters
 * if the bundle returns a value the proxied page consumes — chobitsu's
 * IIFE returns undefined, so we discard it.
 *
 * The proxied window's `eval` is itself wrapped by Scramjet to rewrite
 * code before executing. That's the only mechanism we need to run the
 * bundle in the proxied realm with Scramjet's globals available.
 */

import type { DevToolsManager } from './manager';
import { basePath } from '@utils/basepath';

const AGENT_SCRIPT_PATH = 'assets/devtools-agent.js';
const AGENT_INJECT_MARK = '__ddxDevtoolsAgentInjected';
const READY_POLL_MS = 50;
const READY_POLL_MAX_MS = 10000;

export type ManagerResolver =
	| DevToolsManager
	| (() => DevToolsManager | undefined);

function getTabIdFromFrame(frame: any): string | null {
	const el = frame?.element as HTMLElement | undefined;
	if (!el) return null;
	const tabId = el.getAttribute('data-tab-id');
	return tabId || null;
}

/**
 * Decide whether to inject the per-frame devtools agent based on the
 * iframe element this scramjet frame is mounted in. Returns:
 *   - 'tab' if the iframe is a normal browser tab AND its tabId is
 *     currently enabled in the tab DevToolsManager,
 *   - 'extension' if the iframe is an extension/popup/devtools_page
 *     iframe AND its target has been marked wanted by the
 *     ExtensionDevToolsManager,
 *   - null otherwise (skip injection).
 *
 * The two cases inject the SAME agent bundle and produce the same
 * frame-ready protocol — only the consumer differs (DevToolsSession
 * for tabs, ExtensionIframeDevToolsSession for extensions). Both
 * receive messages via the same Scramjet envelope decoder, gated on
 * `ev.source` being a window they registered.
 */
function getInjectableTargetClass(frame: any): 'tab' | 'extension' | null {
	const el = frame?.element as HTMLElement | undefined;
	if (!el) return null;

	const tabId = el.getAttribute('data-tab-id');
	if (tabId) {
		const w = window as { devtools?: { isEnabledForTab(id: string): boolean } };
		if (w.devtools?.isEnabledForTab(tabId)) return 'tab';
		return null;
	}

	const isExtIframe =
		el.hasAttribute('data-helium-ext-id') ||
		el.hasAttribute('data-helium-popup-ext-id') ||
		el.hasAttribute('data-helium-devtools-page');
	if (!isExtIframe) return null;
	const w = window as {
		extDevtools?: {
			targetRegistry: { isIframeWanted(el: HTMLIFrameElement): boolean };
		};
	};
	if (!w.extDevtools) return null;
	if (!w.extDevtools.targetRegistry.isIframeWanted(el as HTMLIFrameElement)) {
		return null;
	}
	return 'extension';
}

let agentSourcePromise: Promise<string> | null = null;
function loadAgentSource(
	hostOrigin: string,
	basePath: string
): Promise<string> {
	if (agentSourcePromise) return agentSourcePromise;
	const url = `${hostOrigin}${basePath}${AGENT_SCRIPT_PATH}`;
	console.log('[ddx-devtools] fetching agent bundle from', url);
	agentSourcePromise = fetch(url, { credentials: 'omit' })
		.then((r) => {
			if (!r.ok) throw new Error(`agent fetch ${r.status}`);
			return r.text();
		})
		.catch((err) => {
			agentSourcePromise = null;
			throw err;
		});
	return agentSourcePromise;
}

function waitForEvalReady(win: Window): Promise<Window> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			const w = win as any;
			if (typeof w.eval === 'function' && w.document) {
				resolve(win);
				return;
			}
			if (Date.now() - start > READY_POLL_MAX_MS) {
				reject(new Error('timed out waiting for proxied eval'));
				return;
			}
			setTimeout(tick, READY_POLL_MS);
		};
		tick();
	});
}

function injectAgentScript(
	win: Window,
	hostOrigin: string,
	basePath: string
): void {
	const w = win as any;
	if (w[AGENT_INJECT_MARK]) return;
	w[AGENT_INJECT_MARK] = true;
	let href = '<unknown>';
	try {
		href = win.location?.href ?? href;
	} catch {
		// cross-origin
	}
	console.log('[ddx-devtools] queuing agent inject for', href);
	Promise.all([
		loadAgentSource(hostOrigin, basePath),
		waitForEvalReady(win),
	])
		.then(([src]) => {
			try {
				const winEval = (win as any).eval;
				if (typeof winEval !== 'function') {
					console.warn(
						'[ddx-devtools] proxied eval missing after wait'
					);
					w[AGENT_INJECT_MARK] = false;
					return;
				}
				winEval.call(win, src);
				console.log(
					'[ddx-devtools] agent eval-injected (',
					src.length,
					'bytes ) into',
					href
				);
			} catch (err) {
				console.warn('[ddx-devtools] agent eval-inject threw:', err);
				w[AGENT_INJECT_MARK] = false;
			}
		})
		.catch((err) => {
			console.warn('[ddx-devtools] agent inject prerequisites failed:', err);
			w[AGENT_INJECT_MARK] = false;
		});
}

let installed = false;

export function installDevToolsHook(
	controller: any,
	resolver: ManagerResolver
): void {
	if (installed) return;
	if (!controller) {
		console.warn('[ddx-devtools] install: no controller');
		return;
	}
	const scramjet = (window as any).$scramjet;
	if (!scramjet?.Plugin) {
		console.warn('[ddx-devtools] $scramjet.Plugin unavailable');
		return;
	}

	const resolveManager = (): DevToolsManager | undefined => {
		const r =
			typeof resolver === 'function'
				? (resolver as () => DevToolsManager | undefined)()
				: resolver;
		return r ?? undefined;
	};

	const hostOrigin = location.origin;

	const installOnFrame = (frame: any) => {
		try {
			const postHook = frame?.hooks?.init?.post;
			if (!postHook) return;
			const plugin = new scramjet.Plugin('ddx-devtools');
			plugin.tap(postHook, (context: any) => {
				const klass = getInjectableTargetClass(frame);
				if (klass === null) return;
				const win = context?.window as Window | undefined;
				if (!win) return;
				if (klass === 'tab') {
					const tabId = getTabIdFromFrame(frame);
					if (!tabId) return;
					const manager = resolveManager();
					if (!manager) return;
					console.log(
						'[ddx-devtools] init.post fired for tab',
						tabId,
						'isTopLevel=',
						context?.isTopLevel,
					);
					manager.registerProxiedWindow(tabId, win);
					injectAgentScript(win, hostOrigin, basePath);
					return;
				}
				console.log(
					'[ddx-devtools] init.post fired for extension iframe',
					'isTopLevel=',
					context?.isTopLevel,
				);
				injectAgentScript(win, hostOrigin, basePath);
			});
		} catch (err) {
			console.warn('[ddx-devtools] tap failed:', err);
		}
	};

	if (Array.isArray(controller.frames)) {
		for (const frame of controller.frames) installOnFrame(frame);
	}

	const original = controller.createFrame?.bind(controller);
	if (typeof original === 'function') {
		controller.createFrame = (...args: any[]) => {
			const frame = original(...args);
			if (frame) installOnFrame(frame);
			return frame;
		};
	}

	installed = true;
	console.log('[ddx-devtools] hook installer ready');
}
