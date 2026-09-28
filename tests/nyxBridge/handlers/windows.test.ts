import { describe, it, expect, vi } from 'vitest';
import { HANDLERS } from '../../../src/apis/nyxBridge/handlers';
import '../../../src/apis/nyxBridge/handlers/windows';

const ctxNoTabs: any = { tabResolver: { all: () => [] } };

describe('windows', () => {
	it('getCurrent returns window 1', async () => {
		const w = await HANDLERS['windows.getCurrent']!(ctxNoTabs, undefined);
		expect((w as any).id).toBe(1);
	});
	it('getAll returns array of length 1', async () => {
		const arr = await HANDLERS['windows.getAll']!(ctxNoTabs, undefined) as any[];
		expect(arr.length).toBe(1);
	});
	it('create opens a tab in the current window', async () => {
		const createTab = vi.fn(async () => 'tab-1');
		const tab = { id: 1, url: 'https://nyx.ampscat.dev', windowId: 1 };
		const ctx: any = {
			tabs: { createTab },
			tabResolver: {
				all: () => [],
				toNum: (id: string) => id === 'tab-1' ? 1 : -1,
				info: () => tab,
			},
		};

		const window = await HANDLERS['windows.create']!(ctx, { url: 'https://nyx.ampscat.dev' }) as any;

		expect(createTab).toHaveBeenCalledWith('https://nyx.ampscat.dev');
		expect(window.tabs).toEqual([tab]);
	});
});
