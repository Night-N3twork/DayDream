// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { engineFixture, svg } from '../../Space-v2/tests/fixtures/scramjet.mjs';

describe('Daydream owned adapter bundle', () => {
	it('ships a host-local adapter and uses the real engine response pipeline', async () => {
		const path = 'src/apis/proxyContext/generated/proxy-context-host.js';
		expect(existsSync(path), 'explicitly copied host bundle').toBe(true);
		const modulePath = '../../src/apis/proxyContext/generated/proxy-context-host.js';
		const { installScramjetProxyContext } = await import(/* @vite-ignore */ modulePath);
		const fixture = engineFixture(new URL('file://' + process.cwd() + '/'));
		Object.assign(globalThis, { $scramjet: fixture.engine, DOMParser: fixture.win.DOMParser });
		const dispose = installScramjetProxyContext(fixture.controller, readFileSync('src/apis/proxyContext/generated/proxy-context-adapter.js', 'utf8'));
		try {
			const frame = fixture.controller.createFrame();
			const response = await fixture.response(frame, svg);
			expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
			expect(response.body).toContain(encodeURIComponent('https://space.example/index.html?view=games'));
		} finally { dispose(); fixture.close(); }
	});
});
