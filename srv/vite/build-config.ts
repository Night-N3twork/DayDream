import { createHmac, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Public artifact vocabulary
// ---------------------------------------------------------------------------

// Every emitted string in a BuildConfig must be free of these words
// (case-insensitive). The build-time vocabulary-scrub pass will additionally
// rewrite occurrences that leak in through vendored code.
//
// Two groups:
// 1. Upstream vendor names (scramjet, wisp, ...) — classic proxy stack tells.
// 2. DDX product brand names (ddx, helium, ...) — first-party surface tells.
//    Every `__ddxXxx` / `__helium_yyy` global becomes an unbranded token.
export const ARTIFACT_WORDS = [
  // Upstream vendor names
  "scramjet",
  "scram",
  "wisp",
  "epoxy",
  "libcurl",
  "mercuryworkshop",
  "ultraviolet",
  "rawproxy",
  "proxy-transports",
  "bare",
  "proxy",
  // DDX product brand names. The `__ddx` / `__nyx` variants include the
  // leading double-underscore so the 5-char sequence is uncommon enough to
  // generate collision-free tokens; the raw 3-char `ddx`/`nyx` alone would
  // saturate against Rolldown's `$XX` mangled identifiers.
  "__ddx",
  "__nyx",
  // NOTE: the visible brand word "daydream" is intentionally NOT scrubbed. It
  // is a user-facing brand shown in the DOM (newtab logo, page copy, titles);
  // scrubbing it turned those surfaces into random tokens. Visible DOM text is
  // instead hidden at runtime by the font-obfuscation layer (ob-fonts), which
  // encodes text nodes so a runtime DOM scanner cannot read them. (Trade-off:
  // the literal remains in the JS bundle bytes, visible to a *static* scanner.)
  "helium",
  "neutron",
  "nightmare",
  "obscura",
  "pulsar",
  "terbium",
  // Renamed-Scramjet residual content-fingerprints. These are literal tokens
  // that MidnightAPI's static detector (fc.ampscat.dev → src/detect/) counts in
  // the served bundles even after vendor-name scrubbing. See
  // docs/superpowers/audits/2026-09-24-midnight-detector-evasion.md for the
  // signal→token mapping. Each is rewritten consistently across all of dist/,
  // so identifiers/keys/prefixes stay internally coherent at runtime.
  //
  // s.js — `script:rewrite-fn-pair` (rewriteUrlCount>=5 && unrewriteCount>=5).
  // `unrewrite` also neutralizes `unrewriteUrl`.
  "rewriteUrl",
  "unrewrite",
  // s.js — `script:dom-module-tree` (>=3 of ./dom/<name>). Scramjet resolves
  // these via a runtime `r.startsWith("./dom/")` guard, so renaming the shared
  // PREFIX (not the individual paths) keeps the map keys, the guard literal and
  // any `"./dom/"+name` builder mutually consistent.
  "./dom/",
  // api.js — `script:rpc-dollar-keys` (>=4 of these envelope keys). Local
  // client<->SW RPC only; consistent in-dist rename is transparent.
  "$type",
  "$token",
  "$args",
  "$method",
  "$data",
  // api.js — `script:symbol-for-frame-handle` (Symbol.for('…frame handle…')).
  // Symbol.for registry key; renamed identically in every realm within dist.
  "controller frame handle",
  // api.js — `script:version-mismatch-guard` (versionInfo.version + guard text).
  "versionInfo",
  // client chunk — helium `inline-storage-token`
  // (/helium|extensionUrlOverrides|extensionThemes/i). `helium` already covered
  // above; add the two extension bookkeeping keys.
  "extensionUrlOverrides",
  "extensionThemes",
] as const;

// Words that must ONLY be matched case-sensitively when scrubbing source
// (avoids destroying benign identifiers like `Proxy` the JS built-in). The
// forbidden-word test still checks case-insensitively — we own every string
// value here, so the pipeline can afford to be strict at generation time.
//
// Consumed by the vocabulary-scrub Vite plugin (Task 6) to decide which
// artifact words to match case-sensitively when rewriting vendored source,
// preventing collateral damage to JS built-ins such as `Proxy`.
export const CASE_SENSITIVE_ARTIFACT_WORDS: ReadonlySet<string> = new Set([
  "proxy",
]);

// ---------------------------------------------------------------------------
// KDF + token helpers
// ---------------------------------------------------------------------------

const identifierAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
// Base64url without padding — 8-char hash suffix aligns with Vite's default.
const base64UrlAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// Alphabets for artifact-replacement tokens. These tokens replace vendor
// words (scramjet, wisp, …) EVERYWHERE in the emitted build — inside JS
// identifiers, inside CSS selectors, AND inside HTML attribute names
// (scramjet's rewriter keys `scramjet-attr-<name>` / `scramjet-injected`
// attributes off the vendor word). A token must therefore be a valid
// identifier in ALL THREE grammars simultaneously:
//   - JS identifier:  [A-Za-z_$][A-Za-z0-9_$]*
//   - CSS identifier: -?[A-Za-z_][A-Za-z0-9_-]*        (no `$` at ANY position)
//   - XML/HTML Name:  [A-Za-z_:][A-Za-z0-9_.:-]*       (no `$` at ANY position)
// The common safe subset: first char a letter or `_`, remaining chars letters,
// digits, or `_`. An earlier scheme prefixed tokens with `$` (valid only in
// JS), which made `querySelectorAll("script[<token>-injected]")` and
// `setAttribute("<token>-attr-href", …)` throw once the scrub had rewritten
// scramjet's own markers to `$`-tokens.
const identTokenStartAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
const identTokenPartAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_";

const derive = (seed: string, label: string, length: number): number[] => {
  const output: number[] = [];
  for (let block = 0; output.length < length; block++) {
    output.push(
      ...createHmac("sha256", seed)
        .update(`scramjet:${label}:${block}`)
        .digest(),
    );
  }
  return output.slice(0, length);
};

const pick = (
  seed: string,
  label: string,
  minimum: number,
  maximum: number,
): number => minimum + (derive(seed, label, 1)[0]! % (maximum - minimum + 1));

const rawToken = (
  seed: string,
  label: string,
  length: number,
  alphabet = identifierAlphabet,
): string =>
  derive(seed, label, length)
    .map(byte => alphabet[byte % alphabet.length])
    .join("");

const containsForbiddenWord = (value: string): boolean => {
  const lower = value.toLowerCase();
  return ARTIFACT_WORDS.some(word => lower.includes(word));
};

const safeToken = (
  seed: string,
  label: string,
  length: number,
  alphabet = identifierAlphabet,
): string => {
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = rawToken(
      seed,
      attempt === 0 ? label : `${label}#${attempt}`,
      length,
      alphabet,
    );
    if (!containsForbiddenWord(candidate)) return candidate;
  }
  throw new Error(`Unable to generate clean token for ${label}`);
};

const variableToken = (
  seed: string,
  label: string,
  minimum: number,
  maximum: number,
  alphabet?: string,
): string =>
  safeToken(
    seed,
    label,
    pick(seed, `${label}:length`, minimum, maximum),
    alphabet,
  );

const hexToken = (seed: string, label: string, bytes: number): string =>
  derive(seed, label, bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

// Generate a token of exactly `length` characters that is a valid identifier
// in JS, CSS, and HTML-attribute-name grammars (see identTokenStartAlphabet).
// The first character is drawn from the start alphabet (letter/`_`), the rest
// from the part alphabet (letters/digits/`_`).
const rawIdentToken = (seed: string, label: string, length: number): string =>
  derive(seed, label, length)
    .map((byte, index) =>
      index === 0
        ? identTokenStartAlphabet[byte % identTokenStartAlphabet.length]
        : identTokenPartAlphabet[byte % identTokenPartAlphabet.length],
    )
    .join("");

// As rawIdentToken, but retries with a salted label until the token spells no
// forbidden word (mirrors safeToken's retry loop).
const safeIdentToken = (
  seed: string,
  label: string,
  length: number,
): string => {
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = rawIdentToken(
      seed,
      attempt === 0 ? label : `${label}#${attempt}`,
      length,
    );
    if (!containsForbiddenWord(candidate)) return candidate;
  }
  throw new Error(`Unable to generate clean ident token for ${label}`);
};

// ---------------------------------------------------------------------------
// Cover profiles (verbatim from Starlight — DDX picks one per build)
// ---------------------------------------------------------------------------

export type CoverProvider =
  | "firebase"
  | "aws"
  | "azure"
  | "cloudflare"
  | "gcp";

type CoverProfile = {
  readonly provider: CoverProvider;
  readonly handoffStem: string;
  readonly assetPrefix: string;
  readonly worker: string;
  readonly route: string;
  readonly param: string;
  readonly stream: (segment: string) => string;
  readonly api: (segment: string) => string;
  readonly identity: {
    readonly product: string;
    readonly title: string;
    readonly description: string;
  };
};

const coverProfiles: readonly CoverProfile[] = [
  {
    provider: "firebase",
    handoffStem: "firebaseApp",
    assetPrefix: "/static",
    worker: "firebase-messaging-sw.js",
    route: "o",
    param: "continueUri",
    stream: segment => `/google.firestore.v1.Firestore/Listen/${segment}/`,
    api: segment => `/v1/projects/${segment}/installations`,
    identity: {
      product: "Workspace",
      title: "Workspace",
      description: "Your personal workspace.",
    },
  },
  {
    provider: "aws",
    handoffStem: "amplifyApp",
    assetPrefix: "/static",
    worker: "service-worker.js",
    route: "assets",
    param: "state",
    stream: segment => `/graphql/realtime/${segment}/`,
    api: segment => `/prod/${segment}/session`,
    identity: {
      product: "Console",
      title: "Console",
      description: "Application console.",
    },
  },
  {
    provider: "azure",
    handoffStem: "azureApp",
    assetPrefix: "/dist",
    worker: "service-worker.js",
    route: "blob",
    param: "code",
    stream: segment => `/client/hubs/${segment}/`,
    api: segment => `/${segment}/oauth2/v2.0/token`,
    identity: {
      product: "Portal",
      title: "Portal",
      description: "Your account portal.",
    },
  },
  {
    provider: "cloudflare",
    handoffStem: "cloudflarePages",
    assetPrefix: "/_app/immutable",
    worker: "sw.js",
    route: "cdn",
    param: "cf_session",
    stream: segment => `/api/room/${segment}/websocket/`,
    api: segment => `/api/${segment}/session`,
    identity: {
      product: "Dashboard",
      title: "Dashboard",
      description: "Project dashboard.",
    },
  },
  {
    provider: "gcp",
    handoffStem: "googleCloud",
    assetPrefix: "/static",
    worker: "sw.js",
    route: "download",
    param: "authuser",
    stream: segment => `/v1/${segment}/streamingPull/`,
    api: segment => `/v1/projects/${segment}/locations`,
    identity: {
      product: "Projects",
      title: "Projects",
      description: "Manage your projects.",
    },
  },
];

// ---------------------------------------------------------------------------
// BuildConfig type
// ---------------------------------------------------------------------------

export type BuildConfig = {
  readonly buildId: string;
  readonly workspace: "/app/";
  readonly cover: {
    readonly provider: CoverProvider;
    readonly handoffStem: string;
    readonly assetPrefix: string;
    readonly worker: string;
    readonly route: string;
    readonly identity: {
      readonly product: string;
      readonly title: string;
      readonly description: string;
    };
  };
  readonly routes: {
    readonly assets: string;
    readonly libcurl: string;
    readonly plus: string;
    readonly eruda: string;
    readonly chii: string;
    readonly tfs: string;
    readonly sw: string;
    readonly controllerApi: string;
    readonly controllerSw: string;
    readonly controllerInject: string;
    readonly obscura: string;
    readonly coreS: string;
    readonly coreSWasm: string;
    readonly bundled: string;
  };
  readonly globals: {
    readonly core: string;
    readonly controller: string;
    readonly utils: string;
    readonly ddxBase: string;
    readonly scramjetConfig: string;
    readonly scramjetFlags: string;
    readonly scramjetController: string;
  };
  readonly messages: {
    readonly workerActivate: string;
    readonly storageResetChannel: string;
    readonly storageResetPrepare: string;
    readonly storageResetComplete: string;
    readonly controllerInit: string;
    readonly controllerRevive: string;
  };
  readonly network: {
    readonly path: string;
    readonly handoffPath: string;
    readonly handoffParam: string;
    readonly frame: {
      readonly version: 2;
      readonly key: string;
      readonly tag: string;
      readonly headerLength: number;
      readonly nonceLength: number;
      readonly metadataOffset: number;
      readonly paddingMinimum: number;
      readonly paddingMaximum: number;
      readonly paddingPlacement: "prefix" | "suffix" | "split";
      readonly keyStride: number;
      readonly nonceStride: number;
    };
  };
  readonly rpc: {
    readonly type: string;
    readonly token: string;
    readonly data: string;
    readonly error: string;
    readonly method: string;
    readonly args: string;
  };
};

// ---------------------------------------------------------------------------
// Public: artifact vocabulary (word -> replacement token of the same length)
// ---------------------------------------------------------------------------

export const createArtifactVocabulary = (
  seed: string,
  attempt = 0,
): Record<string, string> =>
  Object.fromEntries(
    ARTIFACT_WORDS.map(word => [
      word,
      safeIdentToken(seed, `artifact-${word}-${attempt}`, word.length),
    ]),
  );

// ---------------------------------------------------------------------------
// Public: seed resolver (cached per-process, coordinated across sub-builds
// via `.ddx-seed` at the project root)
// ---------------------------------------------------------------------------
//
// The DDX build runs several independent sub-processes that each need to
// resolve the SAME seed: the SW rolldown build, the config rolldown build,
// the controller rolldown builds (api/sw/inject), the Obscura builds, and
// the top-level `vite build` / `vite dev`. If each process invokes
// `resolveSeed()` and none of them share state, they would each generate a
// different random seed, and the SW's baked BuildConfig would not match
// what Vite bakes into the app chunks — the controller writer would install
// a slot at token A while the shell reader would look for token B.
//
// Coordination protocol:
//   1. `DDX_BUILD_SEED` env var, if set, wins for the whole process tree.
//   2. Otherwise, the first process to call `resolveSeed()` reads
//      `.ddx-seed` at the project root. If present, that seed is used.
//   3. If neither is present, a fresh random seed is generated, written to
//      `.ddx-seed`, and used. Subsequent processes read the same file.
//
// The `.ddx-seed` file is gitignored (see repo `.gitignore`). Delete it to
// force a fresh seed on the next build. Use `bun run seed:rotate` (defined
// in `package.json`) to remove both `.ddx-seed` and `.ddx-builds.json`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname as pathDirname } from "node:path";

const seedFilePath = (): string => {
  // Walk up from CWD until we find a `package.json`, then anchor the seed
  // file next to it. Falls back to CWD if no package.json is found (dev
  // sub-package builds still land at the DDX repo root because they inherit
  // CWD from the parent `bun run …` invocation).
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(`${dir}/package.json`)) break;
    const up = pathDirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return `${dir}/.ddx-seed`;
};

let cachedSeed: string | undefined;
export const resolveSeed = (): string => {
  if (cachedSeed) return cachedSeed;
  const fromEnv = process.env.DDX_BUILD_SEED;
  if (fromEnv) {
    cachedSeed = fromEnv;
    return cachedSeed;
  }
  const path = seedFilePath();
  try {
    const persisted = readFileSync(path, "utf8").trim();
    if (persisted) {
      cachedSeed = persisted;
      return cachedSeed;
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  cachedSeed = randomBytes(32).toString("hex");
  try {
    mkdirSync(pathDirname(path), { recursive: true });
    writeFileSync(path, cachedSeed, { encoding: "utf8" });
  } catch {
    /* best-effort persistence — a non-writable FS is not fatal */
  }
  return cachedSeed;
};

// ---------------------------------------------------------------------------
// Public: createBuildConfig
// ---------------------------------------------------------------------------

// Asset-name label pool (all safe words — none contain a forbidden token).
const assetLabelPool: readonly string[] = [
  "main",
  "vendor",
  "runtime",
  "client",
  "polyfills",
  "app",
  "common",
  "shared",
  "core",
  "utils",
  "store",
];

export const createBuildConfig = (seed: string): BuildConfig => {
  if (!seed) throw new Error("DDX_BUILD_SEED is required");

  const generated = (label: string, minimum = 10, maximum = 18): string =>
    variableToken(seed, label, minimum, maximum);
  const identifier = (label: string): string => `_${generated(label)}`;

  const cover =
    coverProfiles[pick(seed, "cover-profile", 0, coverProfiles.length - 1)]!;

  const handoffSuffix = generated("runtime-handoff", 10, 14);
  const handoff = (role: string): string =>
    `${cover.handoffStem}${role}_${handoffSuffix}`;

  // Seeded shuffle of the asset-label pool so cursor order changes per build.
  const shuffledLabels = ((): string[] => {
    const names = [...assetLabelPool];
    const random = derive(seed, "asset-label-shuffle", names.length);
    for (let index = names.length - 1; index > 0; index--) {
      const target = random[index]! % (index + 1);
      [names[index], names[target]] = [names[target]!, names[index]!];
    }
    return names;
  })();

  let assetCursor = 0;
  const filename = (label: string, extension: string): string => {
    for (let attempt = 0; attempt < 64; attempt++) {
      const labelPart =
        shuffledLabels[(assetCursor + attempt) % shuffledLabels.length]!;
      const hashPart = safeToken(
        seed,
        attempt === 0 ? `asset-hash-${label}` : `asset-hash-${label}#${attempt}`,
        8,
        base64UrlAlphabet,
      );
      const candidate = `${labelPart}-${hashPart}${extension}`;
      if (!containsForbiddenWord(candidate)) {
        assetCursor++;
        return candidate;
      }
    }
    throw new Error(`Unable to generate clean filename for ${label}`);
  };

  const nonceLength = pick(seed, "network-nonce-length", 8, 16);
  const headerLength = pick(
    seed,
    "network-header-length",
    nonceLength + 12,
    nonceLength + 32,
  );
  const metadataLength = nonceLength + 6;
  const paddingMinimum = pick(seed, "network-padding-minimum", 0, 7);

  const config: BuildConfig = {
    buildId: generated("build-id", 14, 22),
    workspace: "/app/",
    cover: Object.freeze({
      provider: cover.provider,
      handoffStem: cover.handoffStem,
      assetPrefix: cover.assetPrefix,
      worker: cover.worker,
      route: cover.route,
      identity: Object.freeze({ ...cover.identity }),
    }),
    routes: Object.freeze({
      assets: filename("assets", ".js"),
      libcurl: filename("libcurl", ".wasm"),
      plus: filename("plus", ".js"),
      eruda: filename("eruda", ".js"),
      chii: filename("chii", ".js"),
      tfs: filename("tfs", ".js"),
      sw: "",
      controllerApi: filename("controller-api", ".js"),
      controllerSw: filename("controller-sw", ".js"),
      controllerInject: filename("controller-inject", ".js"),
      obscura: filename("obscura", ".js"),
      coreS: filename("core-s", ".js"),
      coreSWasm: filename("core-s-wasm", ".wasm"),
      bundled: filename("bundled", ".js"),
    }),
    globals: Object.freeze({
      core: handoff("Runtime"),
      controller: handoff("Controller"),
      utils: handoff("Modules"),
      ddxBase: identifier("ddx-base"),
      scramjetConfig: identifier("core-config"),
      scramjetFlags: identifier("core-flags"),
      scramjetController: identifier("core-controller"),
    }),
    messages: Object.freeze({
      workerActivate: identifier("worker-activate-message"),
      storageResetChannel: identifier("storage-reset-channel"),
      storageResetPrepare: identifier("storage-reset-prepare-message"),
      storageResetComplete: identifier("storage-reset-complete-message"),
      controllerInit: identifier("controller-init-message"),
      controllerRevive: identifier("controller-revive-message"),
    }),
    network: Object.freeze({
      path: cover.stream(generated("network-path", 12, 22)),
      handoffPath: cover.api(generated("handoff-path", 10, 18)),
      handoffParam: cover.param,
      frame: Object.freeze({
        version: 2 as const,
        key: hexToken(
          seed,
          "network-codec",
          pick(seed, "network-key-bytes", 24, 48),
        ),
        tag: hexToken(seed, "network-tag", 4),
        headerLength,
        nonceLength,
        metadataOffset: pick(
          seed,
          "network-metadata-offset",
          1,
          headerLength - metadataLength,
        ),
        paddingMinimum,
        paddingMaximum:
          paddingMinimum + pick(seed, "network-padding-range", 8, 31),
        paddingPlacement: (["prefix", "suffix", "split"] as const)[
          pick(seed, "network-padding-placement", 0, 2)
        ]!,
        keyStride: pick(seed, "network-key-stride", 1, 15),
        nonceStride: pick(seed, "network-nonce-stride", 1, 7),
      }),
    }),
    rpc: Object.freeze({
      type: identifier("rpc-type"),
      token: identifier("rpc-token"),
      data: identifier("rpc-data"),
      error: identifier("rpc-error"),
      method: identifier("rpc-method"),
      args: identifier("rpc-args"),
    }),
  };

  return Object.freeze(config);
};
