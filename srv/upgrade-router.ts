/**
 * Upgrade router — routes incoming `upgrade` events to either the encoded
 * WISP endpoint (build-config derived path) or the plain `/wisp/` endpoint,
 * or destroys the socket for anything else.
 *
 * Reference: `Starlight/src/upgrade-router.ts` (adapted for DDX's
 * two-endpoint model — encoded default + plain fallback).
 */

export type UpgradeRoutes = {
	readonly encoded: string; // e.g. "/app/assets/<buildId>/"
	readonly plain: string; // e.g. "/wisp/"
};

const normalize = (path: string): string =>
	path.replace(/\/+$/, '') + '/';

export const routeUpgrade = (
	requestUrl: string | undefined,
	routes: UpgradeRoutes,
	onEncoded: () => void,
	onPlain: () => void,
	onReject: () => void,
): void => {
	try {
		const rawPathname = new URL(requestUrl || '', 'http://localhost')
			.pathname;
		const pathname = normalize(rawPathname);
		const encoded = normalize(routes.encoded);
		const plain = normalize(routes.plain);
		if (pathname === encoded) return onEncoded();
		if (pathname === plain) return onPlain();
		onReject();
	} catch {
		onReject();
	}
};
