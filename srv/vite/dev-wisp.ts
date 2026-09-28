import type { Plugin, ViteDevServer } from 'vite';

import type { BuildConfig } from './build-config';

/**
 * Attach the wisp WebSocket server to `vite dev`'s HTTP server so the app
 * can actually proxy in development. Only wires the plain `/wisp/`
 * endpoint — the encoded/framed route is disabled per operator request,
 * so the client always uses plain wisp in dev.
 *
 * Without this plugin, `bun run dev` serves the shell fine but every
 * proxied fetch fails at the SW level because there is no wisp server on
 * port 5173 — the app spams `setTransports()` retries and the UI locks up.
 *
 * The `server.httpServer` reference is only populated AFTER Vite's
 * middleware chain finishes wiring up. That's why we return a function
 * from `configureServer` — Vite invokes it post-listen with the fully
 * initialised server, which is when we can add the 'upgrade' handler.
 */
export function devWispPlugin(_config: BuildConfig): Plugin {
	return {
		name: 'ddx-dev-wisp',
		apply: 'serve',
		configureServer(server: ViteDevServer) {
			return () => {
				void attachWispServer(server);
			};
		},
	};
}

async function attachWispServer(server: ViteDevServer): Promise<void> {
	if (!server.httpServer) {
		// eslint-disable-next-line no-console
		console.warn(
			'[ddx-dev-wisp] server.httpServer is null after middleware setup; ' +
				'wisp cannot be attached. Proxy traffic will fail in dev.',
		);
		return;
	}

	const wispModule = (await import('@mercuryworkshop/wisp-js/server')) as {
		server: {
			options: Record<string, unknown>;
			routeRequest: (
				req: unknown,
				socket: unknown,
				head: unknown,
			) => void;
		};
		logging: { set_level: (level: number) => void; ERROR: number };
	};
	const wisp = wispModule.server;
	const logging = wispModule.logging;

	logging.set_level(logging.ERROR);
	wisp.options.dns_method = 'resolve';
	wisp.options.dns_servers = ['1.1.1.1', '1.0.0.1'];
	wisp.options.dns_result_order = 'ipv4first';
	wisp.options.wisp_version = 2;
	wisp.options.wisp_motd = 'DDX dev WISP';

	server.httpServer.on('upgrade', (req, socket, head) => {
		const url = (req.url ?? '').split('?')[0] ?? '';
		if (url === '/wisp/' || url === '/wisp') {
			wisp.routeRequest(req, socket as unknown as never, head);
			return;
		}
		// Vite's own HMR runs at `/`; do not touch that here — Vite installs
		// its own upgrade handler and we should let it win for any path we
		// don't own.
	});

	// eslint-disable-next-line no-console
	console.log('[ddx-dev-wisp] wisp server attached at ws://<host>/wisp/');
}
