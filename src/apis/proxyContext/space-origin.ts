import { spaceGamesUrl as configuredSpaceGamesUrl } from './generated/proxy-context-host.js';

export function spaceGamesUrl(origin = ''): string {
	return configuredSpaceGamesUrl(
		origin.trim() ? origin : 'https://gointospace.app'
	);
}

export function spaceGamesEntry(origin: string): {
	url: string;
	proxy: boolean;
} {
	try {
		return { url: spaceGamesUrl(origin), proxy: true };
	} catch {
		return {
			url:
				'data:text/html;charset=utf-8,' +
				encodeURIComponent(
					'<!doctype html><html><body><p role="alert">Configure VITE_SPACE_ORIGIN with an HTTP(S) Space origin to open games.</p></body></html>'
				),
			proxy: false
		};
	}
}
