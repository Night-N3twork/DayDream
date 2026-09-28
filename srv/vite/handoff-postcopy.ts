import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Connect, Plugin, ResolvedConfig, ViteDevServer } from 'vite';

import type { BuildConfig } from './build-config';
import { transformHandoff } from './handoff-transform';

// ---------------------------------------------------------------------------
// Post-copy handoff rewrite (Task 9 of Starlight-Parity Hardening).
//
// The pre-built IIFEs (scramjet-config, scramjet-controller {api,sw,inject},
// obscura, and the DDX service worker) are copied verbatim into `dist/` by
// `vite-plugin-static-copy`. Because they never traverse Vite's transform
// pipeline, the source-side handoff rewrite (see `handoff-transform.ts`)
// cannot reach them. This plugin ensures those files get transformed in
// both build AND dev modes:
//
//   - Build: `closeBundle` hook walks every `.js` under `dist/` and rewrites
//     handoff globals in place. Runs after `viteStaticCopy` and before the
//     vocabulary scrub so the writer/reader agreement holds.
//
//   - Dev: `configureServer` installs middleware that intercepts requests
//     for the pre-built IIFEs (assets/{config,api,sw,inject,*.iife}.js and
//     the top-level sw.js) and rewrites the response body on the fly. The
//     source files under `src/**/dist/*.js` are served through
//     `viteStaticCopy` middleware which reads them from disk without
//     running Vite's transform pipeline, so this middleware sits ahead of
//     that and returns the transformed bytes instead. Without it, dev-mode
//     browsers see writer/reader token mismatch and the shell fails with
//     "Runtime controller slot missing".
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['runtime']);

async function walkJsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walkJsFiles(join(dir, entry.name))));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

// Dev-server request path → filesystem source resolver. These are the pre-built
// IIFEs that Vite serves through `viteStaticCopy` in dev. We intercept the
// request, read the source from disk, apply the handoff transform, and return
// the transformed bytes.
//
// The SW routes are duplicated at both `/sw.js` (rolldown output filename) and
// `/${cover.worker}` (the cover-derived filename the shell actually registers
// against, e.g. `service-worker.js` for the azure profile). In production the
// aggregate-sw plugin renames the file on disk; in dev nothing renames it, so
// the middleware routes both paths to the same source file.
const STATIC_DEV_ROUTES: ReadonlyArray<{ readonly urlSuffix: string; readonly source: string }> = [
  { urlSuffix: '/assets/config.js', source: 'src/core/SJ/config/dist/config.js' },
  { urlSuffix: '/assets/api.js', source: 'src/core/SJ/controller/dist/api.js' },
  { urlSuffix: '/assets/sw.js', source: 'src/core/SJ/controller/dist/sw.js' },
  { urlSuffix: '/assets/inject.js', source: 'src/core/SJ/controller/dist/inject.js' },
  { urlSuffix: '/assets/obscura.iife.js', source: 'src/pkgs/Obscura/dist/obscura.iife.js' },
  { urlSuffix: '/sw.js', source: 'src/core/sw/dist/sw.js' },
];

function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export function handoffPostCopyPlugin(config: BuildConfig): Plugin {
  let vite: ResolvedConfig;
  return {
    name: 'ddx-handoff-postcopy',
    // Runs in both build and dev; the `configureServer` and `closeBundle`
    // hooks discriminate. Omit `apply` so both fire.
    enforce: 'post',
    configResolved(resolved) {
      vite = resolved;
    },
    configureServer(server: ViteDevServer) {
      const projectRoot = server.config.root;
      // Compose the runtime routing table: the static targets plus a
      // cover-worker alias that maps `/${cover.worker}` (e.g.
      // `/service-worker.js`, `/firebase-messaging-sw.js`) back to the
      // rolldown SW output. In production the aggregate-sw plugin renames
      // the emitted file on disk; in dev nothing renames it, so if we
      // don't alias here the shell's `navigator.serviceWorker.register`
      // call gets a 404 and the SW never installs.
      const coverWorkerRoute =
        config.cover.worker !== 'sw.js'
          ? [{ urlSuffix: `/${config.cover.worker}`, source: 'src/core/sw/dist/sw.js' }]
          : [];
      const routes = [...STATIC_DEV_ROUTES, ...coverWorkerRoute];

      const middleware: Connect.NextHandleFunction = (req, res, next) => {
        const url = stripQuery(req.url ?? '');
        for (const route of routes) {
          // Match both `/assets/config.js` and `/app/assets/config.js` because
          // the shell serves under `/app/` and internal pages nest deeper.
          if (!url.endsWith(route.urlSuffix)) continue;
          const abs = resolve(projectRoot, route.source);
          if (!existsSync(abs)) continue;
          let src: string;
          try {
            src = readFileSync(abs, 'utf8');
          } catch {
            return next();
          }
          const out = transformHandoff(src, config.globals);
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          // Mirror vite's `server.headers` COOP/COEP so files served by this
          // middleware (especially the service worker) stay in a
          // cross-origin-isolated context. Without these, `self.crossOriginIsolated`
          // is false inside the SW, scramjet's fetch handler skips adding
          // `Cross-Origin-Resource-Policy` to proxied responses, and the
          // page's `require-corp` blocks them (ERR_BLOCKED_BY_RESPONSE).
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          if (route.source === 'src/core/sw/dist/sw.js') {
            // Grant a scope broader than the SW's own path so the shell can
            // register with `scope: '/'` in dev (production sets this in
            // fastify's static setHeaders callback).
            res.setHeader('Service-Worker-Allowed', '/');
          }
          res.end(out);
          return;
        }
        next();
      };
      // Insert at the front of the pipeline so we run before viteStaticCopy's
      // dev middleware, which would otherwise stream the source file
      // untransformed.
      server.middlewares.use(middleware);
    },
    async closeBundle() {
      if (!vite) return;
      if (vite.command !== 'build') return;
      const outDir = join(vite.root, vite.build.outDir);
      const files = await walkJsFiles(outDir);
      let touched = 0;
      for (const path of files) {
        let src: string;
        try {
          src = await readFile(path, 'utf8');
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
        const out = transformHandoff(src, config.globals);
        if (out !== src) {
          await writeFile(path, out, 'utf8');
          touched++;
        }
      }
      if (touched > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[ddx-handoff-postcopy] rewrote handoff globals in ${touched} file(s) under ${relative(vite.root, outDir)}`,
        );
      } else if (files.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ddx-handoff-postcopy] scanned ${files.length} .js file(s) under ` +
            `${relative(vite.root, outDir)} but found no handoff patterns to ` +
            `rewrite. The pre-built controller/config IIFEs will keep their ` +
            `original global names (__scramjet$config, $scramjetController, ` +
            `etc.) and the module-side consumers will error at runtime with ` +
            `"Runtime controller slot missing". Check that scramjet-controller ` +
            `and scramjet-config dist artifacts have been built and copied.`,
        );
      }
    },
  };
}
