import { describe, expect, it } from 'vitest';
import { planBridgeBuild } from '../scripts/build-proxy-context.mjs';

describe('planBridgeBuild', () => {
	it('uses an explicit artifact directory untouched', () => {
		expect(
			planBridgeBuild({
				hasSpaceDir: false,
				hasGenerated: false,
				envSource: '/artifacts/bridge'
			})
		).toEqual({ action: 'copy', source: '/artifacts/bridge' });
	});

	it('builds from the sibling checkout when present', () => {
		expect(
			planBridgeBuild({ hasSpaceDir: true, hasGenerated: false })
		).toEqual({ action: 'build-then-copy' });
	});

	it('reuses checked-in generated files when standalone', () => {
		expect(
			planBridgeBuild({ hasSpaceDir: false, hasGenerated: true })
		).toEqual({ action: 'reuse-checked-in' });
	});

	it('fails with guidance when nothing is available', () => {
		expect(() =>
			planBridgeBuild({ hasSpaceDir: false, hasGenerated: false })
		).toThrow(/SPACE_BRIDGE_SOURCE/);
	});
});
