import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { buildConfigVirtualPlugin } from './srv/vite/build-config-virtual';
import { createBuildConfig } from './srv/vite/build-config';

export default defineConfig({
	// Scope tsconfck to the root tsconfig only — prevents the plugin from
	// recursing into `concepting/` (vendored Playwright fixture tsconfigs)
	// and printing TSConfckParseError noise on every test run.
	plugins: [
		tsconfigPaths({ projects: ['./tsconfig.json'] }),
		// Register the build-config virtual module so tests that consume
		// `virtual:ddx-build-config` can resolve the ID. The real runtime
		// value is typically replaced by `vi.mock(...)` per test; this plugin
		// only exists so Vite's import-analysis doesn't fail at transform time.
		buildConfigVirtualPlugin(createBuildConfig('vitest-stub-seed')),
	],
	resolve: {
		alias: {
			// bootstrap/ is outside tsconfig.json's `include`, so vite-tsconfig-paths
			// does not apply the `@core/*` mapping to files under bootstrap/. Provide
			// a minimal explicit alias so bootstrap/src/sw/transport.ts resolves.
			'@core': fileURLToPath(new URL('./src/core', import.meta.url)),
		},
	},
	test: {
		environment: 'jsdom',
		globals: false,
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'srv/**/*.test.ts'],
		exclude: ['**/node_modules/**', 'src/pkgs/neutron/**', 'dist'],
		passWithNoTests: true,
	},
});
