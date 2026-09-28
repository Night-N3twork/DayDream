
export const NYX_ORIGINS_DEFAULT: readonly string[] = [
	'https://nyx.night-x.com',
	'https://nyx.ampscat.dev',
	'https://nyxai.me'
];

/**
 * Pre-check gate. Used by:
 *   1. scriptInjectionRegistry.match — only inject the client into Nyx frames.
 *   2. handshake source verification — extra defense against session hijack.
 *
 * `extraOrigins` is an optional dev override (e.g. http://localhost:5174).
 */
export function isNyxOrigin(
	realUrl: string,
	extraOrigins: readonly string[] = []
): boolean {
	if (!realUrl) return false;
	let parsed: URL;
	try {
		parsed = new URL(realUrl);
	} catch {
		return false;
	}
	const origin = `${parsed.protocol}//${parsed.host}`;
	const allowlist = [...NYX_ORIGINS_DEFAULT, ...extraOrigins];
	return allowlist.includes(origin);
}

import type { HandshakeState, TrustVerification } from './types';

export interface HandshakeOpts {
	hostMarker: string;
	allowlist: readonly string[];
}

export type InitResult =
	| { ok: true; nonce: string; sessionId: string }
	| { ok: false; code: 'permission_denied'; reason: string };

export type CompleteResult =
	| { ok: true }
	| { ok: false; code: 'permission_denied' | 'handshake_required' | 'session_expired'; reason: string };

const TOKEN_PREFIX = 'nyx-bridge-v1';

async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

export class Handshake {
	private hostMarker: string;
	private allowlist: readonly string[];
	private sessions = new Map<string, HandshakeState>();

	constructor(opts: HandshakeOpts) {
		this.hostMarker = opts.hostMarker;
		this.allowlist = opts.allowlist;
	}

	async handleInit(args: { iframe: HTMLIFrameElement; realUrl: string }): Promise<InitResult> {
		if (!isNyxOrigin(args.realUrl, this.allowlist.filter((o) => !NYX_ORIGINS_DEFAULT.includes(o)))) {
			return { ok: false, code: 'permission_denied', reason: 'origin_not_allowed' };
		}
		const nonceBytes = new Uint8Array(32);
		crypto.getRandomValues(nonceBytes);
		const nonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');
		const sessionId = crypto.randomUUID();
		const expectedToken = await sha256Hex(`${nonce}:${this.hostMarker}:${TOKEN_PREFIX}`);
		this.sessions.set(sessionId, {
			kind: 'challenged',
			iframe: args.iframe,
			expectedToken,
			createdAt: Date.now(),
		});
		return { ok: true, nonce, sessionId };
	}

	async handleComplete(args: { sessionId: string; token: string; iframe: HTMLIFrameElement }): Promise<CompleteResult> {
		const state = this.sessions.get(args.sessionId);
		if (!state) return { ok: false, code: 'session_expired', reason: 'unknown_session' };
		if (state.iframe !== args.iframe) {
			this.sessions.delete(args.sessionId);
			return { ok: false, code: 'permission_denied', reason: 'iframe_mismatch' };
		}
		if (state.kind !== 'challenged') return { ok: false, code: 'handshake_required', reason: 'wrong_state' };
		if (!constantTimeEqual(state.expectedToken, args.token)) {
			this.sessions.delete(args.sessionId);
			return { ok: false, code: 'handshake_required', reason: 'bad_token' };
		}
		this.sessions.set(args.sessionId, { kind: 'trusted', iframe: state.iframe, createdAt: Date.now() });
		return { ok: true };
	}

	/** Verify a sessionId is trusted AND the source matches the bound iframe. */
	verify(sessionId: string | undefined, source: Window | null): TrustVerification {
		if (!sessionId) return { ok: false, code: 'handshake_required', reason: 'no_session_id' };
		const state = this.sessions.get(sessionId);
		if (!state) return { ok: false, code: 'session_expired', reason: 'unknown_session' };
		if (state.kind !== 'trusted') return { ok: false, code: 'handshake_required', reason: 'not_trusted' };
		if (!source) return { ok: false, code: 'permission_denied', reason: 'no_source' };
		if (state.iframe.contentWindow !== source) {
			return { ok: false, code: 'permission_denied', reason: 'iframe_mismatch' };
		}
		return { ok: true };
	}

	drop(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	/** Drop every session bound to a given iframe (used on frame navigate / destroy). */
	dropByIframe(iframe: HTMLIFrameElement): void {
		for (const [id, s] of this.sessions) if (s.iframe === iframe) this.sessions.delete(id);
	}

	size(): number {
		return this.sessions.size;
	}
}
