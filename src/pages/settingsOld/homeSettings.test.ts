import { describe, expect, it, vi } from 'vitest';
import { persistHomePage } from './homeSettings';

describe('legacy home settings', () => {
	it('stores an empty homePage and updates the protocol for the default option', async () => {
		const persist = vi.fn().mockResolvedValue(undefined);
		const update = vi.fn().mockResolvedValue(undefined);

		await persistHomePage('default', '', persist, update);

		expect(persist).toHaveBeenCalledWith('');
		expect(update).toHaveBeenCalledWith('');
	});

	it('normalizes and stores a custom homePage before updating the protocol', async () => {
		const calls: string[] = [];
		const persist = vi.fn(async (value: string) => { calls.push(`persist:${value}`); });
		const update = vi.fn(async (value: string) => { calls.push(`update:${value}`); });

		await persistHomePage('custom', 'example.com/home', persist, update);

		expect(calls).toEqual([
			'persist:https://example.com/home',
			'update:https://example.com/home',
		]);
	});

	it('normalizes a scheme-relative custom home page before persisting it', async () => {
		const persist = vi.fn().mockResolvedValue(undefined);
		const update = vi.fn().mockResolvedValue(undefined);

		await persistHomePage('custom', '//example.com/home', persist, update);

		expect(persist).toHaveBeenCalledWith('https://example.com/home');
		expect(update).toHaveBeenCalledWith('https://example.com/home');
	});

	it.each([
		'javascript:alert(1)',
		'data:text/html,<h1>unsafe</h1>',
		'file:///etc/passwd',
		'about:blank',
		'ddx://settings',
	])('does not persist or activate non-web custom home page %s', async (value) => {
		const persist = vi.fn();
		const update = vi.fn();

		await persistHomePage('custom', value, persist, update);

		expect(persist).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it('does not persist an empty custom home page', async () => {
		const persist = vi.fn();
		const update = vi.fn();

		await persistHomePage('custom', '  ', persist, update);

		expect(persist).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});
});
