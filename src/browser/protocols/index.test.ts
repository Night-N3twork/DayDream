import { afterEach, describe, expect, it, vi } from 'vitest';

const { settings } = vi.hoisted(() => ({
	settings: { getItem: vi.fn() },
}));

vi.mock('@apis/logging', () => ({
	Logger: class {},
}));
vi.mock('@apis/settings', () => ({
	SettingsAPI: class {
		getItem = settings.getItem;
	},
}));
vi.mock('@browser/items', () => ({
	Items: class {},
}));

import { Protocols } from './index';

afterEach(() => {
	settings.getItem.mockReset();
});

async function createProtocols(homePage: string | null): Promise<Protocols> {
	settings.getItem.mockImplementation(async (key: string) => {
		if (key === 'homePage') return homePage;
		return null;
	});
	const protocols = new Protocols({}, '', {
		convertURL: vi.fn(async (_config, _setting, url: string) => url),
	} as any);
	await Promise.resolve();
	await Promise.resolve();
	return protocols;
}

describe('home protocol', () => {
	it('resolves ddx://home to a saved valid homePage', async () => {
		const protocols = await createProtocols('https://example.com/home');

		expect(await protocols.processUrl('ddx://home')).toBe('https://example.com/home');
	});

	it.each([null, '', 'not a url'])('falls back to the internal new tab for %j homePage', async (homePage) => {
		const protocols = await createProtocols(homePage);

		expect(await protocols.processUrl('ddx://home')).toBe('/internal/newtab');
	});

	it.each([
		'javascript:alert(1)',
		'data:text/html,<h1>unsafe</h1>',
		'file:///etc/passwd',
		'about:blank',
		'ddx://settings',
	])('falls back to the internal new tab for non-web %s homePage', async (homePage) => {
		const protocols = await createProtocols(homePage);

		expect(await protocols.processUrl('ddx://home')).toBe('/internal/newtab');
	});
});
