import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync } from "fs";
const __sjScramjetVersion: string = JSON.parse(
  readFileSync(
    "node_modules/@mercuryworkshop/scramjet/package.json",
    "utf-8"
  )
).version;
// The local controller (src/core/SJ/controller/) is not published; its
// version is hardcoded in src/core/SJ/controller/src/version.ts. If the
// upstream npm package happens to be installed, we read from there for
// `CONTROLLER_EXPECTED_VERSION` (consumed only by utils/, which is not
// currently imported by app code). Otherwise we fall back to "0.0.0",
// which is fine because the consumer is dead code.
const __sjControllerVersion: string = (() => {
  const p = "node_modules/@mercuryworkshop/scramjet-controller/package.json";
  if (!existsSync(p)) return "0.0.0";
  return JSON.parse(readFileSync(p, "utf-8")).version;
})();
import { minify } from "terser";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { ViteMinifyPlugin } from "vite-plugin-minify";
import vitePluginBundleObfuscator from "vite-plugin-bundle-obfuscator";
import { fontObfuscationPlugin } from "./srv/vite/font";
import { prettyUrlsPlugin, pageRoutes } from "./srv/vite/routes";
import { copyRoutes } from "./srv/vite/copy";
import tailwindcss from "@tailwindcss/vite";
import { obfuscationConfig } from "./srv/vite/obfusc-config";
import { minifyConfig } from "./srv/vite/minify-config";
import { allowedHosts } from "./srv/vite/hosts";
import { svgWrapperPlugin, svgRedirectPlugin } from "./srv/vite/svg";
import { relocatePagesPlugin } from "./srv/vite/relocate-pages";
import { terbiumTappPlugin } from "./srv/vite/terbium-tapp";
import { apocalypseRemotePlugin } from "./srv/vite/apoc";
import { createBuildConfig, resolveSeed } from './srv/vite/build-config';
import { buildConfigVirtualPlugin } from './srv/vite/build-config-virtual';
import { createChunkNaming } from './srv/vite/chunk-names';
import { coverIdentityPlugin } from './srv/vite/cover-identity';
import { scrubPlugin } from './srv/vite/scrub';
import { assertArtifactsPlugin } from './srv/vite/assert-artifacts';
import { handoffTransformPlugin } from './srv/vite/handoff-transform';
import { handoffPostCopyPlugin } from './srv/vite/handoff-postcopy';
import { aggregateSwPlugin } from './srv/vite/aggregate-sw';
import { pruneDevArtifactsPlugin } from './srv/vite/prune-dev-artifacts';
import { landingSplitPlugin } from './srv/vite/landing-split';
import { devWispPlugin } from './srv/vite/dev-wisp';
import { breakInternalSchemePlugin } from './srv/vite/break-internal-scheme';
import { coLocateAppPlugin } from './srv/vite/colocate-app';

const __ddxSeed = resolveSeed();
const __ddxBuildConfig = createBuildConfig(__ddxSeed);
const __ddxChunkNaming = createChunkNaming(__ddxBuildConfig, __ddxSeed);
if (process.env.NODE_ENV === 'production') {
  console.log(`[ddx] build seed: ${__ddxSeed.slice(0, 8)}… → build ${__ddxBuildConfig.buildId}`);
}

const apocalypsePlugins =
  process.env.APOCALYPSE_REMOTE === "1"
    ? [
        apocalypseRemotePlugin({
          seed: process.env.APOCALYPSE_SEED ?? "daydream-remote-test",
          repository: process.env.APOCALYPSE_REPOSITORY,
          revision: process.env.APOCALYPSE_REVISION,
          features: {
            nameRandomization: true,
            forbiddenStringReplacement: false,
            filenameRandomization: true,
            prototypeObfuscation: true,
            urlCodec: true,
          },
        }),
      ]
    : [];

export default defineConfig({
  base: "./",
  define: {
    SCRAMJET_EXPECTED_VERSION: JSON.stringify(__sjScramjetVersion),
    CONTROLLER_EXPECTED_VERSION: JSON.stringify(__sjControllerVersion),
  },
  plugins: [
    buildConfigVirtualPlugin(__ddxBuildConfig),
    handoffTransformPlugin(__ddxBuildConfig),
    coverIdentityPlugin(__ddxBuildConfig),
    tailwindcss(),
    prettyUrlsPlugin(),
    fontObfuscationPlugin(),
    viteStaticCopy(copyRoutes()),
    ViteMinifyPlugin(minifyConfig),
    //vitePluginBundleObfuscator(obfuscationConfig as any),
    relocatePagesPlugin(),
    ...apocalypsePlugins,
    terbiumTappPlugin(),
    handoffPostCopyPlugin(__ddxBuildConfig),
    devWispPlugin(__ddxBuildConfig),
    aggregateSwPlugin(__ddxBuildConfig),
    landingSplitPlugin(__ddxBuildConfig),
    pruneDevArtifactsPlugin(),
    {
      name: "strip-console-and-debugger",
      enforce: "post",
      generateBundle(_, bundle) {
        for (const file in bundle) {
          const chunk = bundle[file];
          if (chunk.type === "chunk" && chunk.code) {
            chunk.code = chunk.code.replace(/\bdebugger\s*;?/g, "");
          }
        }
      },
      async closeBundle() {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const outDir = resolve(__dirname, "dist");

        // Files in public/ and font runtime bypass terser — process them here
        // sw.js has a console polyfill that preserves warn/error, so we only
        // strip the other console methods (drop_console would kill the polyfill).
        // NOTE: aggregate-sw plugin (which runs earlier in the "post" chain)
        // may have already renamed dist/sw.js to the seeded cover worker
        // filename — read from that path so console stripping still applies.
        const swPath = resolve(outDir, __ddxBuildConfig.cover.worker);
        if (existsSync(swPath)) {
          const code = readFileSync(swPath, "utf-8");
          const result = await minify(code, {
            compress: {
              drop_debugger: true,
              pure_funcs: [
                "console.log",
                "console.info",
                "console.debug",
                "console.trace",
                "console.dir",
                "console.table",
                "console.count",
                "console.time",
                "console.timeEnd",
                "console.timeLog",
                "console.group",
                "console.groupEnd",
                "console.groupCollapsed",
                "console.clear",
                "console.profile",
                "console.profileEnd",
              ],
            },
            mangle: false,
            format: {
              comments: false,
              beautify: false,
            },
          });
          if (result.code) {
            writeFileSync(swPath, result.code, "utf-8");
          }
        }

        // ob-fonts.js has no polyfill — strip all console calls aggressively
        const obFontsPath = resolve(outDir, "ob-fonts.js");
        if (existsSync(obFontsPath)) {
          const code = readFileSync(obFontsPath, "utf-8");
          const result = await minify(code, {
            compress: {
              drop_console: true,
              drop_debugger: true,
              pure_funcs: [
                "console.log",
                "console.info",
                "console.debug",
                "console.warn",
                "console.error",
              ],
            },
            mangle: false,
            format: {
              comments: false,
              beautify: false,
            },
          });
          if (result.code) {
            writeFileSync(obFontsPath, result.code, "utf-8");
          }
        }
      },
    },
    // Scrub runs AFTER the strip-console terser pass above: terser
    // constant-folds the base64 anti-reconstruction splices (e.g. `ba`+`re`)
    // back into forbidden words, so the scrub (and its gate) must be the last
    // thing to touch the SW / ob-fonts bytes.
    scrubPlugin(__ddxBuildConfig, __ddxSeed),
    assertArtifactsPlugin(__ddxBuildConfig, __ddxSeed),
    // MUST be last: rewrites internal `ddx://` literals to `ddx:\u002f\u002f`
    // (identical runtime value, no literal `://` for the static detector).
    // Runs after the strip-console terser pass so the escapes are not
    // normalized back to `/`.
    breakInternalSchemePlugin(),
    // MUST be last: co-locate the app asset graph under dist/app/ so the shell's
    // relative refs resolve with no server delegation (static-servable + cleanly
    // rippable). Runs after scrub/assert/strip-console have processed the files
    // at their original root locations.
    coLocateAppPlugin(__ddxBuildConfig),
    // Generate the SVG bootloader NEXT TO the co-located app shell (after
    // colocate), so /app/index.svg's relative ./assets refs resolve under
    // /app/assets and it boots the app directly — no redirect needed.
    svgWrapperPlugin("app"),
    // Emit a root /index.svg that redirects to the real bootloader at
    // /app/index.svg. Relative target so it resolves under any mount point.
    svgRedirectPlugin("index.svg", "app/index.svg"),
  ],
  appType: "mpa",
  optimizeDeps: {
    // Don't try to pre-bundle anything from the Helium sub-package.
    exclude: ["@pkgs/Helium", "src/pkgs/Helium"],
  },
  server: {
    allowedHosts: allowedHosts,
    // Cross-origin isolation: required for SharedArrayBuffer + Atomics
    // (Scramjet, Neutron content-script isolation, helium ISOLATED world).
    // Production (Fastify + @fastify/helmet) already sets these; dev must
    // do it explicitly or content scripts fall back to pseudo-iso with a
    // console warning at boot.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    watch: {
      ignored: [
        "**/concepting/**",
        "**/plus-backend/**",
        "**/.github/**",
        "**/hostlist.uo*",
        "**/src/pkgs/Helium/**",
      ],
      // Belt-and-suspenders: also tell chokidar to ignore Helium entirely.
      // (some Vite versions key off this even when `ignored` is set above)
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      // `/wisp/` is handled by `devWispPlugin` (attaches a wisp-js
      // WebSocket server directly to Vite's HTTP server). Do NOT proxy it
      // to :8080 — the proxy fires before the plugin's upgrade handler,
      // and if nothing is listening on :8080 the socket closes with
      // "Connection closed before receiving a handshake response".
      "/auth": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    emptyOutDir: true,
    target: ["es2020", "chrome80", "firefox78", "safari14"],
    minify: "terser",
    terserOptions: {
      compress: {
        arguments: true,
        booleans_as_integers: false,
        drop_console: false,
        drop_debugger: true,
        ecma: 2020,
        hoist_funs: true,
        hoist_props: true,
        hoist_vars: false,
        inline: 2,
        join_vars: true,
        keep_fargs: false,
        loops: true,
        passes: 3,
        // console.warn/error are deliberately NOT listed here. Production
        // was discarding its own error reporting, which is why the 13 boot
        // exceptions in the Lighthouse runs were only visible under
        // instrumentation. Keep warn/error; strip the noisy rest.
        pure_funcs: [
          "console.log",
          "console.info",
          "console.debug",
          "console.trace",
          "console.dir",
          "console.table",
          "console.group",
          "console.groupEnd",
          "console.groupCollapsed",
          "console.time",
          "console.timeEnd",
        ],
        pure_getters: true,
        reduce_funcs: true,
        reduce_vars: true,
        sequences: true,
        side_effects: true,
        switches: true,
        toplevel: true,
        top_retain: [],
        typeofs: true,
        unsafe: false,
        // unsafe_arrows: true rewrites `function(){}` → `()=>{}` globally.
        // That breaks any code that uses `new` on the rewritten function.
        // libcurl.js (Emscripten output) does exactly this:
        //   FS.FSStream = function(){};
        //   FS.FSStream.prototype = {...};
        //   new FS.FSStream(...)  // ← TypeError if rewritten to arrow
        // Keep this off so Emscripten-style constructor patterns survive.
        unsafe_arrows: false,
        unsafe_methods: true,
        unsafe_proto: false,
        unused: true,
      },
      mangle: {
        properties: false,
        toplevel: true,
        safari10: false,
      },
      format: {
        comments: false,
        beautify: false,
        ecma: 2020,
        preserve_annotations: false,
      },
      maxWorkers: 4,
    },
    rollupOptions: {
      input: pageRoutes(),
      output: {
        entryFileNames: __ddxChunkNaming.entryFileNames,
        chunkFileNames: __ddxChunkNaming.chunkFileNames,
        assetFileNames: __ddxChunkNaming.assetFileNames,
        manualChunks: __ddxChunkNaming.manualChunks,
      },
    },
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
  },
  esbuild: {
    legalComments: "none",
    treeShaking: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    target: "es2020",
  },
  css: {
    modules: {
      generateScopedName: () => {
        const chars = "abcdefghijklmnopqrstuvwxyz";
        const numbers = "0123456789";
        let result = chars[Math.floor(Math.random() * chars.length)];

        for (let i = 0; i < 7; i++) {
          const useNumber = Math.random() > 0.7;
          const charset = useNumber ? numbers : chars;
          result += charset[Math.floor(Math.random() * charset.length)];
        }

        return result;
      },
    },
    transformer: "lightningcss",
  },
  resolve: {
    tsconfigPaths: true,
  },
});
