/**
 * Scramjet plugin that injects the per-frame nyxBridge agent into every
 * non-Nyx proxied frame. Mirrors src/apis/devtools/hookInstaller.ts —
 * same Plugin/tap/init.post mechanism — but unconditionally installs on
 * every frame whose decoded URL is NOT on the Nyx allowlist (the Nyx
 * iframe gets the client runtime instead, registered separately by
 * NyxBridge.init via scriptInjectionRegistry).
 *
 * After eval-injection, the agent posts `frame-ready` (and later
 * `cdp-out`/`agent-error`/`frame-gone`) envelopes via `window.parent.
 * postMessage`. We listen on the host's `window` for those, decode
 * via decodeEnvelope, and forward to the supplied `onAgentMessage`.
 */

import { decodeEnvelope, type AgentMessage } from './frameTransport';
import { isNyxOrigin } from './handshake';
import { basePath } from '@utils/basepath';

const AGENT_SCRIPT_PATH = 'assets/nyx-bridge-agent.js';
const AGENT_INJECT_MARK = '__nyxBridgeAgentInjected';
const READY_POLL_MS = 50;
const READY_POLL_MAX_MS = 10000;

export interface NyxHookInstallerOpts {
	controller: any;
	allowlist: readonly string[];
	onAgentMessage: (frameId: string, msg: AgentMessage, win: Window) => void;
	/** Optional override: maps a frame to its real (decoded) URL. Defaults to `frame.url`. */
	resolveRealUrl?: (frame: any) => string;
}

let agentSourcePromise: Promise<string> | null = null;
function loadAgentSource(hostOrigin: string, basePath: string): Promise<string> {
	if (agentSourcePromise) return agentSourcePromise;
	const url = `${hostOrigin}${basePath}${AGENT_SCRIPT_PATH}`;
	console.log('[nyxBridge] fetching agent bundle from', url);
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

function injectAgentScript(win: Window, hostOrigin: string, basePath: string): void {
	const w = win as any;
	if (w[AGENT_INJECT_MARK]) return;
	w[AGENT_INJECT_MARK] = true;
	let href = '<unknown>';
	try {
		href = win.location?.href ?? href;
	} catch {
		/* cross-origin */
	}
	Promise.all([loadAgentSource(hostOrigin, basePath), waitForEvalReady(win)])
		.then(([src]) => {
			try {
				const winEval = (win as any).eval;
				if (typeof winEval !== 'function') {
					w[AGENT_INJECT_MARK] = false;
					return;
				}
				winEval.call(win, src);
				console.log(
					'[nyxBridge] agent eval-injected (',
					src.length,
					'bytes ) into',
					href,
				);
			} catch (err) {
				console.warn('[nyxBridge] agent eval-inject threw:', err);
				w[AGENT_INJECT_MARK] = false;
			}
		})
		.catch((err) => {
			console.warn('[nyxBridge] agent inject prerequisites failed:', err);
			w[AGENT_INJECT_MARK] = false;
		});
}

let installed = false;
let messageListener: ((ev: MessageEvent) => void) | null = null;

export function installNyxBridgeHook(opts: NyxHookInstallerOpts): void {
	if (installed) return;
	if (!opts.controller) {
		console.warn('[nyxBridge] install: no controller');
		return;
	}
	const scramjet = (window as any).$scramjet;
	if (!scramjet?.Plugin) {
		console.warn('[nyxBridge] $scramjet.Plugin unavailable');
		return;
	}

	const hostOrigin = location.origin;

	messageListener = (ev: MessageEvent) => {
		const msg = decodeEnvelope(ev.data);
		if (!msg) return;
		const src = ev.source as Window | null;
		if (!src) return;
		opts.onAgentMessage(msg.frameId, msg, src);
	};
	window.addEventListener('message', messageListener);

	const installOnFrame = (frame: any) => {
		try {
			const postHook = frame?.hooks?.init?.post;
			if (!postHook) return;
			const plugin = new scramjet.Plugin('nyxBridge');
			plugin.tap(postHook, (context: any) => {
				const win = context?.window as Window | undefined;
				if (!win) return;
				const realUrl = opts.resolveRealUrl
					? opts.resolveRealUrl(frame)
					: ((frame?.url ?? frame?.element?.src ?? '') as string);
				if (realUrl && isNyxOrigin(realUrl, opts.allowlist)) return;
				injectAgentScript(win, hostOrigin, basePath);
			});
		} catch (err) {
			console.warn('[nyxBridge] tap failed:', err);
		}
	};

	if (Array.isArray(opts.controller.frames)) {
		for (const frame of opts.controller.frames) installOnFrame(frame);
	}

	const original = opts.controller.createFrame?.bind(opts.controller);
	if (typeof original === 'function') {
		opts.controller.createFrame = (...args: any[]) => {
			const frame = original(...args);
			if (frame) installOnFrame(frame);
			return frame;
		};
	}

	installed = true;
	console.log('[nyxBridge] hook installer ready');
}

/** Test/debug only — disposes the message listener and resets state. */
export function _resetNyxBridgeHook(): void {
	if (messageListener) {
		window.removeEventListener('message', messageListener);
		messageListener = null;
	}
	installed = false;
	agentSourcePromise = null;
}
