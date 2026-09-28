/**
 * Centralized proxied-URL decoder.
 *
 * The browser uses Scramjet (and historically Ultraviolet) to rewrite URLs
 * loaded inside iframes. The "real" URL the user thinks they're on lives
 * inside the iframe's `src`/`location.href` after a proxy-specific prefix
 * and codec. We have to undo that any time we want to:
 *   - show the URL in the address bar
 *   - persist it (history, bookmarks, session save)
 *   - re-open it (duplicate tab, restore session)
 *   - compare it for identity / change detection
 *
 * Prior to this helper, six different sites each had their own copy of the
 * decode logic, with subtly different fallback chains. This is the single
 * source of truth.
 *
 * Resolution order (each step bails out on success):
 *   1. Already a registered protocol URL (ddx://, etc.) or contains
 *      `/internal/` — return as-is.
 *   2. If the URL matches the active iframe's src, ask the proxy to extract
 *      using that iframe's per-frame prefix (most accurate for v2 Scramjet).
 *   3. Walk every registered proxy controller frame and try its prefix.
 *   4. Legacy SWconfig-global-prefix path (v1 Scramjet / Ultraviolet).
 *   5. Give up and return the input unchanged.
 *
 * Always returns a string; never throws.
 */
const SCRAMJET_QP_KEYS = new Set([
	'$rfp', '$rfs', '$module', '$tf', '$pf', '$iframe',
	'$mode', '$cred', '$dest', '$io', '$fs', '$csr', '$fakedataurl',
]);

function stripScramjetParams(url: string): string {
	try {
		const u = new URL(url);
		let changed = false;
		for (const key of [...u.searchParams.keys()]) {
			if (SCRAMJET_QP_KEYS.has(key)) {
				u.searchParams.delete(key);
				changed = true;
			}
		}
		return changed ? u.toString() : url;
	} catch {
		return url;
	}
}

export function decodeProxiedUrl(url: string, proxy?: any): string {
	if (!url) return url;

	try {
		if (
			(globalThis as any).protocols?.isRegisteredProtocol?.(url) ||
			url.includes('/internal/')
		) {
			return url;
		}

		const resolvedProxy = proxy ?? (globalThis as any).proxy;

		try {
			const activeIframe = document.querySelector(
				'iframe.active'
			) as HTMLIFrameElement | null;
			if (
				resolvedProxy?.extractEncodedUrl &&
				activeIframe &&
				url === activeIframe.src
			) {
				const decoded = resolvedProxy.extractEncodedUrl(activeIframe);
				if (decoded) return stripScramjetParams(decoded);
			}
		} catch {
			// fall through
		}

		try {
			const frames = resolvedProxy?.controller?.frames;
			if (frames && resolvedProxy.extractEncodedUrl) {
				for (const frame of frames) {
					if (frame?.prefix && url.includes(frame.prefix)) {
						const decoded = resolvedProxy.extractEncodedUrl(
							frame.element,
							{ url, prefix: frame.prefix }
						);
						if (decoded) return stripScramjetParams(decoded);
					}
				}
			}
		} catch {
			// fall through
		}

		try {
			const swc = (globalThis as any).SWconfig;
			const ps = (globalThis as any).ProxySettings;
			if (swc && ps) {
				const cfg = swc[ps];
				const prefix = cfg?.config?.prefix;
				if (prefix && url.includes(prefix) && resolvedProxy?.decodeUrl) {
					// The encoded URL is ALWAYS the final path segment. The bare
					// config prefix omits the controller-id and frame-id segments,
					// so slicing at it leaves `<controllerId>/<frameId>/<token>`;
					// a codec payload never contains `/`, so we must decode only
					// the last segment (mirrors Proxy.stripPrefixSegments). Feeding
					// the whole remainder to the codec yields garbage.
					//
					// This fallback matters because the per-frame strategies above
					// are skipped whenever `controller.frames` hasn't registered
					// the frame yet — notably on the static bootstrap deploy, where
					// the sandboxed SW registers frames later than the address bar
					// first updates, leaving the omnibox showing the raw token.
					const path = new URL(url).pathname;
					const token = path.split('/').filter(Boolean).pop() || '';
					const decoded = token && resolvedProxy.decodeUrl(token);
					// Only accept a real decode; a no-op (codec not ready) returns
					// the token unchanged, in which case fall through rather than
					// surface the raw token.
					if (decoded && decoded !== token) {
						return stripScramjetParams(decoded);
					}
				}
			}
		} catch {
			// fall through
		}

		return stripScramjetParams(url);
	} catch (error) {
		console.warn('[urlDecoder] Failed to decode proxied URL:', error);
		return url;
	}
}

/**
 * Convenience: decode the URL currently loaded in an iframe.
 *
 * Prefers the live `contentWindow.location.href` (post-redirect, post-hash)
 * but transparently falls back to `iframe.src` if cross-origin access is
 * blocked. Always passed through `decodeProxiedUrl` before being returned.
 *
 * Returns an empty string if the iframe is missing.
 */
export function decodeIframeUrl(
	iframe: HTMLIFrameElement | null | undefined,
	proxy?: any
): string {
	if (!iframe) return '';
	let raw = '';
	try {
		raw = iframe.contentWindow?.location?.href || iframe.src || '';
	} catch {
		raw = iframe.src || '';
	}
	if (!raw || raw === 'about:blank') return raw;
	return decodeProxiedUrl(raw, proxy);
}
