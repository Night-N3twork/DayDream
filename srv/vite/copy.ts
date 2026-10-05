import { scramjetPath } from "@mercuryworkshop/scramjet/path";
//@ts-ignore
import {tfsPath} from "@terbiumos/tfs";
import path from "path";

export const routePaths = {
  scramjet: "assets",
  libcurl: "libcurl",
  auth: "",
  plusClient: "plus",
  eruda: "core/i/eruda",
  chii: "core/i/chii",
  tfs: "core/fs",
  sw: "",
};

const authPath = path.resolve(
  "node_modules/@nightnetwork/night-auth/dist/login",
);
const plusClientPath = path.resolve(
  "node_modules/@nightnetwork/plus-client/dist",
);
const erudaPath = path.resolve("node_modules/eruda");
const chiiPath = path.resolve("node_modules/chii/public");
const swPath = path.resolve("src/core/sw/dist");
const sjConfigPath = path.resolve("src/core/SJ/config/dist");
const libcurlPath = path.dirname(
  path.resolve("node_modules/libcurl.js/libcurl.wasm"),
);
// Local controller is built from src/core/SJ/controller/src by the
// `npm run controller:build` step (also wired into `npm run build`).
// Outputs land in src/core/SJ/controller/dist as api.js / sw.js /
// inject.js — the same three artifacts the prebuilt package shipped,
// just with our local modifications baked in.
const sjControllerPath = path.resolve("src/core/SJ/controller/dist");
const obscuraIifePath = path.resolve("src/pkgs/Obscura/dist");
const copyMap = {
  proxyContext: {
    path: path.resolve('src/apis/proxyContext/generated'),
    files: ['proxy-context-adapter.js'],
    dest: routePaths.scramjet,
  },
  scramjet: {
    path: scramjetPath,
    files: [
      { name: "scramjet.js", rename: "s.js" },
      { name: "scramjet.wasm", rename: "s.wasm" },
      { name: "scramjet_bundled.js", rename: "bundled.js" },
    ],
    dest: routePaths.scramjet,
  },
  libcurl: {
    path: libcurlPath,
    files: ["libcurl.wasm"],
    dest: routePaths.libcurl,
  },
  auth: {
    path: authPath,
    files: ["nightlogo.png", "bg_alt.jpeg"],
    dest: routePaths.auth,
  },
  plusClient: {
    path: plusClientPath,
    files: ["*"],
    dest: routePaths.plusClient,
  },
  eruda: {
    path: erudaPath,
    files: ["eruda.js"],
    dest: routePaths.eruda,
  },
  chii: {
    path: chiiPath,
    files: ["*"],
    dest: routePaths.chii,
  },
  devtoolsFrontend: {
    path: path.resolve("src/apis/devtools/frontend"),
    files: ["ddx_chii_host.html", "ddx_websocket_shim.js"],
    dest: routePaths.chii + "/front_end",
  },
  tfs: {
    path: tfsPath,
    files: ["*"],
    dest: routePaths.tfs,
  },
  sw: {
    path: swPath,
    files: ["*"],
    dest: routePaths.sw,
  },
  sjConfig: {
    path: sjConfigPath,
    files: ["*"],
    dest: routePaths.scramjet,
  },
  sjController: {
    path: sjControllerPath,
    files: ["api.js", "sw.js", "inject.js"],
    dest: routePaths.scramjet,
  },
  obscuraIife: {
    path: obscuraIifePath,
    files: ["obscura.iife.js"],
    dest: routePaths.scramjet,
  },
  devtoolsAgent: {
    path: path.resolve("src/apis/devtools/agent/dist"),
    files: ["devtools-agent.js"],
    dest: routePaths.scramjet,
  },
  devtoolsWorkerAgent: {
    path: path.resolve("src/apis/devtools/worker-agent/dist"),
    files: ["devtools-worker-agent.js"],
    dest: routePaths.scramjet,
  },
  nyxBridgeClient: {
    path: path.resolve("src/apis/nyxBridge/client/dist"),
    files: ["nyx-bridge-client.js"],
    dest: routePaths.scramjet,
  },
  nyxBridgeAgent: {
    path: path.resolve("src/apis/nyxBridge/agent/dist"),
    files: ["nyx-bridge-agent.js"],
    dest: routePaths.scramjet,
  },
};

function generateStaticCopyTargets(map: typeof copyMap) {
  const targets: any[] = [];

  for (const key in map) {
    const entry = map[key as keyof typeof copyMap];
    const basePath = entry.path;
    const files = entry.files;

    for (const file of files) {
      if (typeof file === "string") {
        targets.push({
          src: `${basePath}/${file}`,
          dest: entry.dest,
        });
      } else {
        targets.push({
          src: `${basePath}/${file.name}`,
          dest: entry.dest,
          rename: file.rename,
        });
      }
    }
  }

  targets.push({
    src: `node_modules/eruda/eruda.js`,
    dest: "core",
    rename: "inspect.js",
  });

  return targets;
}

export function copyRoutes() {
  return {
    targets: generateStaticCopyTargets(copyMap),
  };
}
