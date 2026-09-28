import { readFile, writeFile, mkdir, rename, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { BuildConfig } from './build-config';

async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}

/**
 * Emits dist/landing.html from src/pages/landing/index.html with cover identity
 * substituted. The app shell (currently at dist/index.html) is moved to
 * dist/app/index.html so it can be served under /app/ by srv/router.ts.
 *
 * Static assets (assets/, chunks/, res/, etc.) stay at root so both / (landing)
 * and /app/ (shell) can reference them.
 */
export function landingSplitPlugin(config: BuildConfig): Plugin {
  let vite: ResolvedConfig;
  return {
    name: 'ddx-landing-split',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { vite = c; },
    async closeBundle() {
      const outDir = join(vite.root, vite.build.outDir);

      // Emit dist/landing.html from src/pages/landing/index.html
      const landingSrc = await readFile(
        join(vite.root, 'src/pages/landing/index.html'),
        'utf8',
      );
      const landing = landingSrc
        .replaceAll('{{PRODUCT}}', config.cover.identity.product)
        .replaceAll('{{DESCRIPTION}}', config.cover.identity.description);
      await writeFile(join(outDir, 'landing.html'), landing);

      // Move dist/index.html -> dist/app/index.html (shell moves under /app/)
      const shellSrc = join(outDir, 'index.html');
      const appDir = join(outDir, 'app');
      const shellDst = join(appDir, 'index.html');
      if (await exists(shellSrc)) {
        await mkdir(appDir, { recursive: true });
        await rename(shellSrc, shellDst);
      }

      // Also move dist/internal/ -> dist/app/internal/
      const internalSrc = join(outDir, 'internal');
      const internalDst = join(appDir, 'internal');
      if (await exists(internalSrc)) {
        await rename(internalSrc, internalDst);
      }

      // pageRoutes()'s glob picks up src/pages/landing/index.html and emits it
      // as an internal page (dist/internal/landing/…), which after the move
      // above lands at dist/app/internal/landing/. That's a vite-processed
      // copy of the landing template — it still contains {{PRODUCT}} body
      // placeholders and is not something the shell should ever route to.
      // Drop it; the canonical landing lives at dist/landing.html + dist/index.html.
      const strayLanding = join(appDir, 'internal', 'landing');
      if (await exists(strayLanding)) {
        await rm(strayLanding, { recursive: true, force: true });
      }

      // Root dist/index.html becomes the landing (some hosts default-index there)
      await writeFile(join(outDir, 'index.html'), landing);
    },
  };
}
