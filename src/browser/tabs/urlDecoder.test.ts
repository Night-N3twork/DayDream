import { afterEach, describe, expect, it } from 'vitest';
import { decodeProxiedUrl } from './urlDecoder';

// The scramjet asset prefix as configured on SWconfig. Crucially it omits the
// controller-id and frame-id path segments, so a proxied URL looks like:
//   <origin><PREFIX><controllerId>/<frameId>/<token>
const PREFIX = '/app/assets/res/';
const TOKEN = 'dcdT6vg8wPdJMzT6v';
const REAL = 'https://example.com/';

// Fake codec that decodes ONLY a clean token (no `/`), mirroring Obscura's
// strict Z85 behaviour on the real deploy. A slash-bearing input no-ops.
const proxy = {
	decodeUrl(s: string): string {
		return s === TOKEN ? REAL : s;
	},
};

describe('decodeProxiedUrl — SWconfig fallback (strategy 4)', () => {
	afterEach(() => {
		delete (globalThis as any).SWconfig;
		delete (globalThis as any).ProxySettings;
	});

	const installSWconfig = () => {
		(globalThis as any).SWconfig = { sj: { config: { prefix: PREFIX } } };
		(globalThis as any).ProxySettings = 'sj';
	};

	it('decodes the final path segment when the prefix omits ctrl/frame ids', () => {
		installSWconfig();
		const url = `http://host${PREFIX}usgmcfx0/ygs9ekvg/${TOKEN}`;
		// This is the code path the static bootstrap deploy hits, because its
		// per-frame strategies are skipped until controller.frames registers.
		expect(decodeProxiedUrl(url, proxy)).toBe(REAL);
	});

	it('regression: never leaks the ctrl/frame-id segments to the omnibox', () => {
		installSWconfig();
		const url = `http://host${PREFIX}usgmcfx0/ygs9ekvg/${TOKEN}`;
		// The previous implementation decoded `usgmcfx0/ygs9ekvg/<token>` as one
		// string; a strict codec no-ops it, so the raw `<frameId>/<token>` leaked
		// into the address bar (the reported bug).
		const result = decodeProxiedUrl(url, proxy);
		expect(result).not.toContain('usgmcfx0');
		expect(result).not.toContain('ygs9ekvg');
	});

	it('falls through (does not surface the raw token) when the codec cannot decode', () => {
		installSWconfig();
		const url = `http://host${PREFIX}ctrl/frame/UNDECODABLETOKEN`;
		// decodeUrl no-ops an unknown token; we must NOT return the bare token.
		const result = decodeProxiedUrl(url, proxy);
		expect(result).not.toBe('UNDECODABLETOKEN');
	});
});
