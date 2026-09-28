import { describe, expect, it, vi } from 'vitest';
import { autogenerateWispUrl } from './proxy';

describe('autogenerateWispUrl', () => {
	it('returns the first generated endpoint that pings online, using wss when secure', async () => {
		const genBaseServerURL = vi
			.fn()
			.mockReturnValueOnce('offline.nightwisp.me.cdn.cloudflare.net/')
			.mockReturnValueOnce('online.nightwisp.me.cdn.cloudflare.net/');
		const wsPing = vi
			.fn()
			.mockResolvedValueOnce({ online: false, ping: 'N/A' })
			.mockResolvedValueOnce({ online: true, ping: 42 });

		const url = await autogenerateWispUrl({
			genBaseServerURL,
			wsPing,
			secure: true,
			attempts: 3
		});

		expect(url).toBe('wss://online.nightwisp.me.cdn.cloudflare.net/');
		expect(genBaseServerURL).toHaveBeenCalledTimes(2);
		expect(wsPing).toHaveBeenNthCalledWith(
			1,
			'wss://offline.nightwisp.me.cdn.cloudflare.net/'
		);
	});

	it('uses ws:// when not secure', async () => {
		const url = await autogenerateWispUrl({
			genBaseServerURL: () => 'host.example/',
			wsPing: async () => ({ online: true, ping: 1 }),
			secure: false,
			attempts: 1
		});
		expect(url).toBe('ws://host.example/');
	});

	it('strips an existing scheme from the generated base', async () => {
		const url = await autogenerateWispUrl({
			genBaseServerURL: () => 'wss://host.example/',
			wsPing: async () => ({ online: true, ping: 1 }),
			secure: true,
			attempts: 1
		});
		expect(url).toBe('wss://host.example/');
	});

	it('returns null after all attempts are offline and honors the attempt count', async () => {
		const genBaseServerURL = vi
			.fn()
			.mockReturnValue('down.nightwisp.me.cdn.cloudflare.net/');
		const wsPing = vi.fn().mockResolvedValue({ online: false, ping: 'N/A' });

		const url = await autogenerateWispUrl({
			genBaseServerURL,
			wsPing,
			secure: true,
			attempts: 3
		});

		expect(url).toBeNull();
		expect(genBaseServerURL).toHaveBeenCalledTimes(3);
		expect(wsPing).toHaveBeenCalledTimes(3);
	});

	it('defaults to 3 attempts when none is provided', async () => {
		const wsPing = vi.fn().mockResolvedValue({ online: false, ping: 'N/A' });
		const url = await autogenerateWispUrl({
			genBaseServerURL: () => 'x.nightwisp.me.cdn.cloudflare.net/',
			wsPing,
			secure: true
		});
		expect(url).toBeNull();
		expect(wsPing).toHaveBeenCalledTimes(3);
	});
});
