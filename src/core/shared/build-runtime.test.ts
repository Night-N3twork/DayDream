import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:ddx-build-config', () => ({
	default: {
		buildId: 'test-build',
		workspace: '/app/',
		cover: {
			provider: 'aws',
			route: 'assets',
			identity: {
				product: 'Console',
				title: 'Console',
				description: 'x',
			},
		},
		routes: { assets: 'a-1', libcurl: 'l-1', plus: 'p-1' },
		globals: {
			core: 'gCore',
			controller: 'gCtl',
			utils: 'gUt',
			scramjetConfig: '$sc',
			scramjetFlags: '$sf',
		},
	},
}));

import { buildConfig } from './build-runtime';

describe('buildConfig()', () => {
	it('returns the injected config as a frozen object', () => {
		const cfg = buildConfig();
		expect(cfg.buildId).toBe('test-build');
		expect(Object.isFrozen(cfg)).toBe(true);
	});
});
