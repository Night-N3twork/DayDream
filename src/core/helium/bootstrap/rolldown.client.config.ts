/**
 * Build `helium-bootstrap.js` — the IIFE bundle that runs inside
 * every extension iframe. Bundles bootstrap/client.ts plus its
 * transitive imports (mv2/Chrome.ts, mv3/Chrome.ts, all 41 namespace
 * classes, ChromeEvent, ExtensionBridgeChannel, ctx-encode helpers).
 *
 * The bundle assigns `globalThis.chrome` as a side effect when it
 * runs. No callers need its exports — the IIFE name is cosmetic.
 *
 * Mirrors the SJ controller's rolldown.api.config.ts pattern.
 */

import { defineConfig } from 'rolldown';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldownBuildConfigPlugin } from '../../../../srv/vite/rolldown-build-config';

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  input: resolve(configDir, 'client.ts'),
  platform: 'browser',
  plugins: [rolldownBuildConfigPlugin()],
  output: {
    file: resolve(configDir, 'dist', 'helium-bootstrap.js'),
    format: 'iife',
    name: 'HeliumBootstrap',
    extend: true,
    minify: true,
    sourcemap: false,
  },
});
