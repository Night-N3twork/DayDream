import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { ARTIFACT_WORDS, CASE_SENSITIVE_ARTIFACT_WORDS, type BuildConfig } from './build-config';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

const FORBIDDEN_DEV_MARKERS = ['__ddx$debug', 'window.__wipe', '_starlight_browser_reset', '__DEBUG_'];

// Shell markup / branded identifiers that must never appear in emitted HTML or
// JS bundles. Added when the shell was renamed off `#browser-container` — a
// filter scanner probing `document.querySelector('#browser-container')` should
// find nothing.
const FORBIDDEN_SHELL_TELLS = ['browser-container', 'id="app-shell"', 'id="stage"', 'id="toolbar"'];

export function assertArtifactsPlugin(config: BuildConfig, seed: string): Plugin {
  let vite: ResolvedConfig;
  return {
    name: 'ddx-assert-artifacts',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { vite = c; },
    async closeBundle() {
      const outDir = join(vite.root, vite.build.outDir);

      // Write build seed and buildId for server-side reconciliation (Task 14).
      await writeFile(join(outDir, '.build-seed'), seed);
      await writeFile(join(outDir, '.build-id'), config.buildId);

      const files = await walk(outDir);
      const problems: string[] = [];

      for (const path of files) {
        const rel = relative(outDir, path);
        if (rel.startsWith('.build-') || rel.startsWith('runtime/.builds')) continue;
        const source = await readFile(path);
        for (const word of ARTIFACT_WORDS) {
          const caseSensitive = CASE_SENSITIVE_ARTIFACT_WORDS.has(word);
          if (!caseSensitive && rel.toLowerCase().includes(word)) {
            problems.push(`filename: ${rel} contains ${word}`);
          }
          if (containsAscii(source, word, caseSensitive)) {
            problems.push(`content:  ${rel} contains ${word}`);
          }
        }
        if (rel.endsWith('.js') || rel.endsWith('.html')) {
          const text = source.toString('utf8');
          for (const marker of FORBIDDEN_DEV_MARKERS) {
            if (text.includes(marker)) problems.push(`dev marker: ${rel} contains ${marker}`);
          }
          for (const tell of FORBIDDEN_SHELL_TELLS) {
            if (text.includes(tell)) problems.push(`shell tell: ${rel} contains ${tell}`);
          }
        }
      }

      if (problems.length) {
        const preview = problems.slice(0, 25).join('\n  - ');
        const suffix = problems.length > 25 ? `\n  ...and ${problems.length - 25} more` : '';
        throw new Error(`Artifact assertions failed (${problems.length} issue${problems.length === 1 ? '' : 's'}):\n  - ${preview}${suffix}`);
      }
    },
  };
}

function containsAscii(buf: Buffer, word: string, caseSensitive: boolean): boolean {
  const needle = Buffer.from(word, 'ascii');
  for (let i = 0; i <= buf.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      const a = buf[i + j];
      const b = needle[j];
      const eq = caseSensitive ? a === b : (a | 0x20) === (b | 0x20);
      if (!eq) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}
