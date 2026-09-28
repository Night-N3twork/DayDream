import { resolve, join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { BuildConfig } from './build-config';

// ---------------------------------------------------------------------------
// co-locate-app
//
// The app shell (dist/app/index.html) and its internal pages reference assets
// with paths that resolve UNDER /app/ (shell: `./assets/x`; internal:
// `../../chunks/x`; ob-fonts via a computed `/app/` base). But the build emits
// those asset dirs at the dist ROOT, so historically only Fastify's
// `/app/<dir>/*` delegation routes bridged the gap — which breaks on any plain
// static host (and made the bootstrap rip mis-map paths).
//
// This plugin co-locates the app's asset graph under dist/app/ so every
// reference resolves natively, with NO server delegation. The result is a
// self-contained dist/app/ that works on Fastify, on any static host, and when
// ripped+hosted by the bootstrap SW (1:1 path mapping).
//
// The landing (dist/index.html, index.svg, landing.html) stays at the root and
// only needs the shared `res/` (favicon), which is COPIED (not moved) so both
// `/res/*` (landing) and `/app/res/*` (app) resolve.
// ---------------------------------------------------------------------------

// Root entries that belong to the landing / build manifests — never moved.
const KEEP_AT_ROOT = new Set([
  'app',
  'index.html',
  'index.svg',
  'landing.html',
  '.build-seed',
  '.build-id',
  '.build-transport',
  '.build-id.txt',
]);

// Shared with the landing — copied into app/ as well as kept at root.
const SHARE_INTO_APP = new Set(['res']);

export function coLocateAppPlugin(_config: BuildConfig): Plugin {
  let vite: ResolvedConfig;
  return {
    name: 'ddx-colocate-app',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      vite = c;
    },
    async closeBundle() {
      const { readdir, rename, mkdir, cp } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const outDir = resolve(vite.root, vite.build.outDir);
      const appDir = join(outDir, 'app');
      if (!existsSync(appDir)) return; // nothing to co-locate

      let entries;
      try {
        entries = await readdir(outDir, { withFileTypes: true });
      } catch {
        return;
      }

      let moved = 0;
      let copied = 0;
      for (const entry of entries) {
        const name = entry.name;
        if (KEEP_AT_ROOT.has(name)) {
          // Shared assets: copy into app/ (keep the root copy for the landing).
          if (SHARE_INTO_APP.has(name)) {
            await cp(join(outDir, name), join(appDir, name), {
              recursive: true,
              force: true,
            });
            copied += 1;
          }
          continue;
        }
        if (SHARE_INTO_APP.has(name)) {
          await cp(join(outDir, name), join(appDir, name), {
            recursive: true,
            force: true,
          });
          copied += 1;
          continue;
        }
        // Everything else at the root is app asset graph — move it under app/.
        const from = join(outDir, name);
        const to = join(appDir, name);
        try {
          await mkdir(appDir, { recursive: true });
          await rename(from, to);
          moved += 1;
        } catch (error) {
          this.warn(
            `[ddx-colocate-app] failed to move ${name} into app/: ${(error as Error).message}`,
          );
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `[ddx-colocate-app] co-located ${moved} entr(ies) into dist/app/` +
          (copied ? `, shared ${copied} into app/` : ''),
      );
    },
  };
}
