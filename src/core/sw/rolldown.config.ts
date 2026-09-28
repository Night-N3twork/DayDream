import { defineConfig, type Plugin } from 'rolldown';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createBuildConfig,
	resolveSeed
} from '../../../srv/vite/build-config';

const configDir = dirname(fileURLToPath(import.meta.url));

/**
 * Rolldown plugin: turn Vite-style `import foo from 'pkg/file.ext?url'`
 * specifiers into a string export pointing at a runtime URL.
 *
 * `src/pkgs/pulsar/index.ts` (and potentially other deps) use Vite's
 * `?url` import to get a hashed asset URL at page-build time. That
 * syntax is unknown to rolldown, so without this plugin the SW build
 * fails with `UNLOADABLE_DEPENDENCY`.
 *
 * The mapping below produces a stable runtime path for each known asset
 * (the SW is served from the root, so absolute paths work). If more
 * `?url` imports appear, add them here.
 */
function urlImportPlugin(): Plugin {
	const RUNTIME_URLS: Record<string, string> = {
		'libcurl.js/libcurl.wasm': '/libcurl/libcurl.wasm'
	};

	const SUFFIX = '?url';
	const VIRTUAL_PREFIX = '\0url-import:';

	return {
		name: 'sw-url-import',
		resolveId(source) {
			if (!source.endsWith(SUFFIX)) return null;
			const bare = source.slice(0, -SUFFIX.length);
			const runtime = RUNTIME_URLS[bare];
			if (!runtime) {
				throw new Error(
					`[sw-url-import] No runtime URL mapping for '${bare}'. ` +
						`Add it to RUNTIME_URLS in src/core/sw/rolldown.config.ts.`
				);
			}
			return VIRTUAL_PREFIX + runtime;
		},
		load(id) {
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const url = id.slice(VIRTUAL_PREFIX.length);
			return `export default ${JSON.stringify(url)};`;
		}
	};
}

/**
 * Rolldown plugin: resolve `virtual:ddx-build-config` at SW build time by
 * baking the current seed's BuildConfig into the SW bundle.
 *
 * The Vite side gets this virtual module through `buildConfigVirtualPlugin`,
 * but the SW is a standalone rolldown build that never sees Vite's plugin
 * pipeline. Without this shim, imports of `@core/shared/build-runtime`
 * from SW code (e.g. `wisp.ts` for encoded WebSocket URLs) leave the
 * default-import identifier unresolved and the SW throws at eval time
 * with `virtual_ddx_build_config is not defined`.
 *
 * The seed is resolved the same way Vite resolves it: `DDX_BUILD_SEED`
 * env if set, cached random otherwise. In practice the SW build runs
 * before Vite, and both consume the same env var — so the config baked
 * into the SW matches what Vite bakes into the app chunks.
 */
function buildConfigVirtualPlugin(): Plugin {
	const VIRTUAL_ID = 'virtual:ddx-build-config';
	const RESOLVED_ID = '\0' + VIRTUAL_ID;
	return {
		name: 'sw-build-config-virtual',
		resolveId(source) {
			if (source === VIRTUAL_ID) return RESOLVED_ID;
			return null;
		},
		load(id) {
			if (id !== RESOLVED_ID) return null;
			const config = createBuildConfig(resolveSeed());
			return `export default Object.freeze(${JSON.stringify(config)});`;
		}
	};
}

export default defineConfig({
	input: resolve(configDir, 'index.ts'),
	platform: 'browser',
	output: {
		file: resolve(configDir, 'dist/sw.js'),
		format: 'iife',
		minify: true
	},
	plugins: [urlImportPlugin(), buildConfigVirtualPlugin()]
});
