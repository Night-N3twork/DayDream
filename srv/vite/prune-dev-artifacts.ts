import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

// Extensions that are dev-only artifacts and MUST NOT ship to the browser.
// `.d.ts` files are TypeScript declaration files (contain type-only source
// references to vendor packages like `@nightnetwork/enigma` that would
// otherwise reveal DDX's dependency graph). `.map` files are sourcemaps —
// production is compiled without sourcemaps, so any remaining `.map` is a
// leaked dev artifact from a vendored copy.
const FORBIDDEN_EXTENSIONS = ['.d.ts', '.map'];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * Removes dev-only artifacts (.d.ts, .map) from dist/. Copied vendor
 * packages (dist/plus/, dist/assets/ vendor files) sometimes bundle
 * declaration files or sourcemaps that reveal the dependency graph
 * or original source. This runs at closeBundle before the vocabulary
 * scrub so the deleted files never need scrubbing.
 */
export function pruneDevArtifactsPlugin(): Plugin {
  let vite: ResolvedConfig;
  return {
    name: 'ddx-prune-dev-artifacts',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { vite = c; },
    async closeBundle() {
      const outDir = join(vite.root, vite.build.outDir);
      let files: string[];
      try {
        files = await walk(outDir);
      } catch {
        return;
      }
      let removed = 0;
      for (const file of files) {
        const rel = relative(outDir, file);
        if (FORBIDDEN_EXTENSIONS.some(ext => rel.endsWith(ext))) {
          await rm(file, { force: true });
          removed++;
        }
      }
      if (removed) {
        // eslint-disable-next-line no-console
        console.log(`[ddx-prune-dev-artifacts] removed ${removed} dev artifact(s) from ${outDir}`);
      }
    },
  };
}
