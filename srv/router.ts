import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import path from "path";
import fastifyStatic from "@fastify/static";
import { APIRouter } from "./api/index";
import { createBuildConfig, resolveSeed } from "./vite/build-config";

// The runtime cover identity MUST use the same DDX_BUILD_SEED that Vite used
// at build time. If DDX_BUILD_SEED differs (or is unset while the built assets
// were produced with a specific seed), the Server header advertised here will
// name a different provider than the identity baked into index.html and the
// chunk names — an obvious tell. Ops runbook: export DDX_BUILD_SEED for both
// `bun run build` and the Fastify process.
const __config = createBuildConfig(resolveSeed());

const COVER_SERVER_HEADERS: Record<string, string> = {
  firebase: "Google Frontend",
  aws: "AmazonS3",
  azure: "Microsoft-IIS/10.0",
  cloudflare: "cloudflare",
  gcp: "Google Frontend",
};
const __coverServer = COVER_SERVER_HEADERS[__config.cover.provider] ?? "nginx";

const __dirname = process.cwd();

const frontendPath = path.join(__dirname, "dist");

async function router(fastify: FastifyInstance) {
  // The app is now fully self-contained under dist/app/ (assets co-located by
  // the ddx-colocate-app build plugin), so it serves with NO path delegation:
  // dist/app/ at /app/, and the landing at /. This works identically on a plain
  // static host and when ripped+hosted by the bootstrap SW.
  await fastify.register(fastifyStatic, {
    root: path.join(frontendPath, "app"),
    prefix: "/app/",
    index: ["index.html"],
    decorateReply: true,
    setHeaders: (res, filePath) => {
      res.setHeader("Server", __coverServer);
      if (filePath.endsWith(".ttf") || filePath.endsWith(".woff2")) {
        res.setHeader("Cache-Control", "no-store");
      }
      if (filePath.endsWith(".json")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  });

  // Root registration: serves landing.html at / plus the shared res/ favicon.
  await fastify.register(fastifyStatic, {
    root: frontendPath,
    prefix: "/",
    index: ["landing.html"],
    decorateReply: false,
    setHeaders: (res) => {
      res.setHeader("Server", __coverServer);
    },
  });

  // NOTE: `/app` and `/app/` are handled STATICALLY by the shell HTML itself
  // (an inline `<base>` computed from location.pathname), so we do NOT add a
  // server-side redirect here — that would only help Fastify and would not
  // benefit plain static hosts or the SW-bootstrap. See `srv/vite/base-shim.ts`
  // for the injected script.

  await APIRouter(fastify);

  fastify.setNotFoundHandler(
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply
        .status(404)
        .sendFile(
          "error/index.html",
          path.join(__dirname, "dist/app/internal"),
        );
    },
  );
}

export { router };
export default router;
