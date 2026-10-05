import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

describe('configured Space games entry', () => {
	it('uses a validated configured URL and normal proxy navigation', async () => {
		vi.stubEnv('VITE_SPACE_ORIGIN', 'https://space.example/mount/?other=1');
		vi.resetModules();
		const { BUILTIN_PROTOCOL_ROUTES } =
			await import('../../src/browser/protocols/manifest');
		const entry = BUILTIN_PROTOCOL_ROUTES.find(
			route => route.path === 'games'
		)!;
		expect(entry.proxy).toBe(true);
		expect(entry.url).toBe(
			'https://space.example/mount/?other=1&view=games'
		);
		vi.unstubAllEnvs();
	});
	it('blank configuration opens the default Space games origin through the proxy', async () => {
		vi.stubEnv('VITE_SPACE_ORIGIN', '');
		vi.resetModules();
		const { BUILTIN_PROTOCOL_ROUTES } =
			await import('../../src/browser/protocols/manifest');
		const entry = BUILTIN_PROTOCOL_ROUTES.find(
			route => route.path === 'games'
		)!;
		expect(entry.url).toBe('https://gointospace.app/?view=games');
		expect(entry.proxy).toBe(true);
		vi.unstubAllEnvs();
	});
	it('invalid explicit origins remain visible configuration errors', async () => {
		const { spaceGamesEntry } =
			await import('../../src/apis/proxyContext/space-origin');
		expect(spaceGamesEntry('javascript:alert(1)').proxy).toBe(false);
		expect(spaceGamesEntry('https://user:password@example.com').proxy).toBe(
			false
		);
		expect(spaceGamesEntry('  ').url).toBe(
			'https://gointospace.app/?view=games'
		);
	});
	it('explicit host build hook copies standalone artifacts', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(pkg.scripts['proxy-context:build']).toBeTruthy();
		expect(pkg.scripts['prebuild:all']).toContain('proxy-context:build');
	});
});
