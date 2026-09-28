import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { BuildConfig } from './build-config';

const WORKER_ABI = 5;
const HANDOFF_VERSION = 2;
const MAX_RETAINED = 3;

type RegisteredBuild = {
  buildId: string;
  worker: string;
  controllerGlobal: string;
  provider: string;
  workerAbiVersion: number;
  handoffVersion: number;
  registeredAt: number;
};

async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}

/**
 * Renames dist/sw.js to the cover profile's worker filename, writes the build
 * registry at dist/runtime/.builds.json, and emits SW-filename stubs at every
 * prior build's worker path that `importScripts()` the current build's SW.
 *
 * The stubs are the "aggregate" part: when a returning client's registered SW
 * URL differs from the current build's filename (because the seed rolled to a
 * different cover profile), the browser fetches the old URL; the stub loads
 * the new SW and calls skipWaiting, so the client rolls forward without
 * being stranded on the old build. `.builds.json` retains up to
 * MAX_RETAINED compatible prior builds' metadata so this works across N rolls.
 */
export function aggregateSwPlugin(config: BuildConfig): Plugin {
  let vite: ResolvedConfig;
  return {
    name: 'ddx-aggregate-sw',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { vite = c; },
    async closeBundle() {
      const outDir = join(vite.root, vite.build.outDir);
      const runtimeDir = join(outDir, 'runtime');
      await mkdir(runtimeDir, { recursive: true });

      // 1. Rename dist/sw.js -> dist/<cover.worker> if needed
      const src = join(outDir, 'sw.js');
      const dst = join(outDir, config.cover.worker);
      if (config.cover.worker !== 'sw.js' && await exists(src)) {
        await rename(src, dst);
        console.log(`[ddx-aggregate-sw] renamed sw.js -> ${config.cover.worker}`);
      }

      // 2. Build registry — retained OUTSIDE dist so it survives Vite's
      // `emptyOutDir: true` wipe between builds. Copied into dist at the
      // end for the server / verify script to consume.
      const persistentRegistry = join(vite.root, '.ddx-builds.json');
      const distRegistry = join(runtimeDir, '.builds.json');
      let registry: RegisteredBuild[] = [];
      if (await exists(persistentRegistry)) {
        try { registry = JSON.parse(await readFile(persistentRegistry, 'utf8')); } catch { /* corrupt — start fresh */ }
      } else if (await exists(distRegistry)) {
        // Legacy: earlier builds wrote only inside dist. Migrate on first read.
        try { registry = JSON.parse(await readFile(distRegistry, 'utf8')); } catch { /* corrupt — start fresh */ }
      }

      const current: RegisteredBuild = {
        buildId: config.buildId,
        worker: config.cover.worker,
        controllerGlobal: config.globals.scramjetController,
        provider: config.cover.provider,
        workerAbiVersion: WORKER_ABI,
        handoffVersion: HANDOFF_VERSION,
        registeredAt: Date.now(),
      };

      // Filter: keep only compatible + non-collide with current
      const compatible = registry
        .filter(b => b.workerAbiVersion === WORKER_ABI && b.handoffVersion === HANDOFF_VERSION)
        .filter(b => b.buildId !== current.buildId)
        .filter(b => b.controllerGlobal !== current.controllerGlobal);
      const kept = [...compatible.slice(-(MAX_RETAINED - 1)), current];

      await writeFile(persistentRegistry, JSON.stringify(kept, null, 2));
      await writeFile(distRegistry, JSON.stringify(kept, null, 2));

      // 3. Emit SW-filename stubs at every distinct prior worker filename so
      // returning clients whose SW was registered at that URL can be rolled
      // forward. Skip if the prior worker matches the current one (already
      // served) or if the stub target file itself doesn't exist yet.
      const emittedStubs = new Set<string>([current.worker]);
      let stubs = 0;
      for (const build of kept) {
        if (emittedStubs.has(build.worker)) continue;
        emittedStubs.add(build.worker);
        const stubPath = join(outDir, build.worker);
        // The stub is a tiny SW that swaps itself out for the current worker.
        // `importScripts` runs the current SW's install/activate logic; the
        // stub's own install triggers skipWaiting so the browser installs
        // the new bytes on the old URL immediately.
        const stubSource =
          `// Roll-forward stub emitted by ddx-aggregate-sw for build ${build.buildId}.\n` +
          `// The current build's SW lives at /${current.worker}; this stub\n` +
          `// makes the old URL keep working for returning clients.\n` +
          `self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));\n` +
          `self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));\n` +
          `importScripts('/' + ${JSON.stringify(current.worker)});\n`;
        await writeFile(stubPath, stubSource);
        stubs++;
      }
      if (stubs) {
        console.log(`[ddx-aggregate-sw] emitted ${stubs} SW roll-forward stub(s)`);
      }
    },
  };
}
