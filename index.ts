import http, { Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import fastifyCompress from "@fastify/compress";
import fastifyHelmet from "@fastify/helmet";
// @ts-ignore
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import chalk from "chalk";
import Fastify from "fastify";
import gradient from "gradient-string";
import { WebSocketServer } from "ws";
import { version } from "./package.json";
import { getPlatform } from "./srv/platform.ts";
import routes from "./srv/router.ts";
import { routeUpgrade } from "./srv/upgrade-router.ts";
import { createBuildConfig, resolveSeed } from "./srv/vite/build-config.ts";
import {
  createFrameCodec,
  wrapWebSocket,
} from "./src/core/shared/frame-codec.ts";

// Module-scope build config: used both for the encoded upgrade route and for
// the per-connection frame codec. Re-derived once per process from
// DDX_BUILD_SEED (or a cached random seed if unset).
const __ddxBuildConfig = createBuildConfig(resolveSeed());

// The client hardcodes the plain wisp path as `/wisp/`, but the production
// vocabulary scrub rewrites the `wisp` artifact word to a seeded token, so the
// built client actually opens `wss://…/<token>/`. The scrub plugin persists the
// resolved path to `dist/.build-transport`; read it here so `routeUpgrade`
// matches the path the client really uses. Falls back to `/wisp/` for
// unscrubbed (dev-style) dists.
const __ddxPlainWispPath = ((): string => {
  try {
    const file = "./dist/.build-transport";
    if (existsSync(file)) {
      const value = readFileSync(file, "utf8").trim();
      if (value) return value;
    }
  } catch {
    /* fall back to the literal below */
  }
  return "/wisp/";
})();

const __ddxUpgradeRoutes = {
  encoded: `${__ddxBuildConfig.workspace}${__ddxBuildConfig.cover.route}/${__ddxBuildConfig.routes.assets}/${__ddxBuildConfig.buildId}/`,
  plain: __ddxPlainWispPath,
};
const __ddxWebSocketServer = new WebSocketServer({ noServer: true });

// Guard against dist/.build-seed mismatch in production. If the emitted
// bundle was built with a different seed, the encoded route will 404.
if (process.env.NODE_ENV === "production") {
  const seedFile = "./dist/.build-seed";
  if (existsSync(seedFile)) {
    const distSeed = readFileSync(seedFile, "utf8").trim();
    if (distSeed !== resolveSeed()) {
      console.warn(
        `[ddx] WARNING: DDX_BUILD_SEED env (${resolveSeed().slice(0, 8)}...) does not match dist/.build-seed (${distSeed.slice(0, 8)}...). Encoded route may 404.`,
      );
    }
  }
}

const server = Fastify({
  logger: false,
  routerOptions: {
    ignoreDuplicateSlashes: true,
    ignoreTrailingSlash: true,
  },
  serverFactory: (handler) => {
    const srv = http.createServer();
    logging.set_level(logging.ERROR);
    wisp.options.dns_method = "resolve";
    wisp.options.dns_servers = ["1.1.1.1", "1.0.0.1"];
    wisp.options.dns_result_order = "ipv4first";
    wisp.options.wisp_version = 2;
    wisp.options.wisp_motd = "WISP server";
    srv.on("request", (req, res) => {
      handler(req, res);
    });
    srv.on("upgrade", (req, socket, head) => {
      routeUpgrade(
        req.url,
        __ddxUpgradeRoutes,
        () => {
          // Encoded route: accept the raw socket, wrap in codec, hand the
          // framed socket to `wisp-js`'s ServerConnection directly (since
          // routeRequest would re-run its own handleUpgrade on the raw
          // socket, bypassing the codec).
          __ddxWebSocketServer.handleUpgrade(
            req,
            socket as any,
            head,
            (rawSocket: any) => {
              rawSocket.binaryType = "arraybuffer";
              try {
                const codec = createFrameCodec(
                  __ddxBuildConfig.network.frame,
                );
                const framedSocket = wrapWebSocket(rawSocket, codec);
                const connection = new (wisp as any).ServerConnection(
                  framedSocket,
                  req.url,
                  { wisp_version: 2 },
                );
                void connection
                  .setup()
                  .then(() => connection.run())
                  .catch((err: any) => {
                    console.error(
                      "[ddx] encoded WS connection failed:",
                      err,
                    );
                    rawSocket.close();
                  });
              } catch (error) {
                console.error(
                  "[ddx] Invalid framed transport configuration:",
                  error,
                );
                rawSocket.close(1002, "Protocol error");
              }
            },
          );
        },
        () => wisp.routeRequest(req, socket as any, head),
        () => socket.destroy(),
      );
    });
    return srv;
  },
});

await server.register(fastifyCompress, {
  encodings: ["br", "gzip", "deflate"],
});

await server.register(fastifyHelmet, {
  xPoweredBy: false,
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  contentSecurityPolicy: false,
});

server.register(routes);

const PORT: number = Number(process.env.PORT) || 8080;
const HOST: string = process.env.HOST || "127.0.0.1";

try {
  await server.listen({ port: PORT, host: HOST });
  const serverInstance = server.server as Server;
  const address = serverInstance.address() as AddressInfo;
  const theme = chalk.hex("#630aba").bold;
  const ddx = {
    1: "#8b0ab8",
    2: "#630aba",
    3: "#665e72",
    4: "#1c1724",
  };
  const host = chalk.hex("#4a4c7f").bold;

  const startupText = `
██████╗  █████╗ ██╗   ██╗██████╗ ██████╗ ███████╗ █████╗ ███╗   ███╗    ██╗  ██╗
██╔══██╗██╔══██╗╚██╗ ██╔╝██╔══██╗██╔══██╗██╔════╝██╔══██╗████╗ ████║    ╚██╗██╔╝
██║  ██║███████║ ╚████╔╝ ██║  ██║██████╔╝█████╗  ███████║██╔████╔██║     ╚███╔╝
██║  ██║██╔══██║  ╚██╔╝  ██║  ██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║     ██╔██╗
██████╔╝██║  ██║   ██║   ██████╔╝██║  ██║███████╗██║  ██║██║ ╚═╝ ██║    ██╔╝ ██╗
╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝    ╚═╝  ╚═╝
`;

  console.log(gradient(Object.values(ddx)).multiline(startupText));

  console.log(theme("Version: "), chalk.whiteBright("v" + version));
  const platformUrl = getPlatform(PORT);
  const deploymentMethod = platformUrl ? "Platform" : "Self-Hosted";
  console.log(
    theme("🌐 Deployment Method: "),
    chalk.whiteBright(deploymentMethod),
  );
  console.log(host("🔗 Deployment Entrypoints: "));
  console.log(
    `  ${chalk.bold(host("Local System IPv4:"))}            http://${address.address}:${PORT}`,
  );

  if (platformUrl)
    console.log(
      `  ${chalk.bold(host("Platform:"))}                     ${platformUrl}`,
    );
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
