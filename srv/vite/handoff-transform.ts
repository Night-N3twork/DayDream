import type { Plugin } from 'vite';
import type { BuildConfig } from './build-config';

// ---------------------------------------------------------------------------
// Runtime handoff transform (Tasks 8/9/10 of Starlight-Parity Hardening)
//
// Rewrites four handoff globals so they leave the source (or the pre-built
// IIFEs copied verbatim into dist/) via seed-derived, non-enumerable
// Object.defineProperty slots whose value is a Proxy of `Object.create(null)`.
// Consumers read the underlying value through the Proxy's `"value"` key; any
// other property access throws. Callers that own the handoff (see
// `src/index.ts`) capture the value once and then `delete` the slot.
//
// Handled globals (source identifier → build-config key):
//   self.__scramjet$config       → globals.scramjetConfig      (writer/reader)
//   self.__scramjet$flags        → globals.scramjetFlags       (writer/reader)
//   self.__ddxBase               → globals.ddxBase             (writer/reader)
//   $scramjetController          → globals.scramjetController  (reader; writer
//                                                                 lives in a
//                                                                 pre-built
//                                                                 IIFE)
//
// The rewrite is regex-based. DDX source under `src/` is small and the
// patterns are unambiguous — the alternative (AST) would carry an outsized
// dependency for a purely lexical concern.
// ---------------------------------------------------------------------------

type Globals = BuildConfig['globals'];

const NAMED_GLOBALS = [
  '__scramjet$config',
  '__scramjet$flags',
  '__ddxBase',
] as const;

type NamedGlobal = (typeof NAMED_GLOBALS)[number];

const tokenFor = (name: NamedGlobal, globals: Globals): string => {
  switch (name) {
    case '__scramjet$config':
      return globals.scramjetConfig;
    case '__scramjet$flags':
      return globals.scramjetFlags;
    case '__ddxBase':
      return globals.ddxBase;
  }
};

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const propertyAlternation = NAMED_GLOBALS.map(escapeRegex).join('|');
const readerAlternation = [...NAMED_GLOBALS, '$scramjetController']
  .map(escapeRegex)
  .join('|');

// Writer prefix: matches `<host>.NAME =` where <host> is a plain global.
// The RHS is captured by hand (below) because it may contain semicolons
// inside balanced parens/braces — e.g. `self.__ddxBase = (function(){var p
// = location.pathname; ...})();` — which `[^;]+` truncates at the first
// inner `;`, corrupting the emitted code.
const WRITER_PREFIX_RE = new RegExp(
  String.raw`(?:self|window|globalThis|this)\.(` +
    propertyAlternation +
    String.raw`)\s*=\s*`,
  'g',
);

// Extract the RHS expression starting at `offset` in `source`, ending at
// the first top-level `;` (i.e. `;` at paren/brace/bracket depth zero and
// outside strings/regex/template literals/comments). Returns the RHS text
// (excluding the trailing `;`) and the position of the `;` so the caller
// can splice.
type RhsExtract = { rhs: string; endIndex: number };
const extractRhs = (source: string, offset: number): RhsExtract | null => {
  let depth = 0;
  let i = offset;
  let inString: string | null = null;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inString) { inString = null; }
      i++;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { inTemplate = false; }
      // Template expressions ${ ... } — recurse depth so a `;` inside them
      // isn't treated as top-level. We approximate: track `{` inside template.
      if (ch === '$' && next === '{') { depth++; i += 2; continue; }
      i++;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 2; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
    if (ch === '`') { inTemplate = true; i++; continue; }
    if (ch === '(' || ch === '{' || ch === '[') { depth++; i++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') { depth--; i++; continue; }
    if (ch === ';' && depth === 0) {
      return { rhs: source.slice(offset, i).trim(), endIndex: i };
    }
    i++;
  }
  return null;
};

// Rewrite writer sites by iterating matches of WRITER_PREFIX_RE and
// hand-extracting each RHS via extractRhs.
const rewriteWriters = (source: string, globals: Globals): string => {
  const out: string[] = [];
  let cursor = 0;
  WRITER_PREFIX_RE.lastIndex = 0;
  for (;;) {
    const match = WRITER_PREFIX_RE.exec(source);
    if (!match) break;
    const name = match[1] as NamedGlobal;
    const rhsStart = WRITER_PREFIX_RE.lastIndex;
    const extracted = extractRhs(source, rhsStart);
    if (!extracted) {
      // Malformed — leave the source alone from `match.index` onward.
      break;
    }
    // Preserve everything up to the match, then emit the writer, then advance
    // past the trailing `;`.
    out.push(source.slice(cursor, match.index));
    out.push(buildWriter(tokenFor(name, globals), extracted.rhs));
    cursor = extracted.endIndex + 1;
    WRITER_PREFIX_RE.lastIndex = cursor;
  }
  if (cursor === 0) return source;
  out.push(source.slice(cursor));
  return out.join('');
};

// Reader: `<host>.NAME` where <host> is a global reference or a TypeScript
// cast expression (`(self as any).NAME`). Runs after writers have been
// consumed, so remaining occurrences are always reads. Includes
// `$scramjetController` so casts like
//   `(globalThis as { $scramjetController?: ... }).$scramjetController`
// resolve to the seeded slot.
const READER_RE = new RegExp(
  String.raw`(?:self|window|globalThis|\(\s*(?:self|window|globalThis)\s+as\s+[^)]+\))\.(` +
    readerAlternation +
    String.raw`)\b`,
  'g',
);

// Controller reader (bare identifier form): `const { X } = $scramjetController;`
// The lookbehind rejects property-access positions (`foo.$scramjetController`)
// and identifiers that merely share the substring. The lookahead restricts
// the match to positions that unambiguously identify a value expression —
// followed by `.`, `[`, `;`, `,`, or `)` (allowing intervening whitespace).
// TypeScript optional/required property keys (`$scramjetController?:` or
// `$scramjetController:`) are consequently not rewritten.
const CONTROLLER_READER_RE =
  /(?<![.\w$])\$scramjetController\b(?=\s*[.;,)\[])/g;

// Controller writer: the IIFE argument pattern used by every pre-built
// scramjet-controller module — `<host>.$scramjetController = <host>.$scramjetController || {}`.
// The value must remain mutable across the three IIFEs (api / sw / inject),
// so the rewrite is idempotent: on first run it seeds a slot; on later runs
// it reuses the existing slot's underlying object.
const CONTROLLER_WRITER_RE =
  /(?:self|window|globalThis|this)\.\$scramjetController\s*=\s*(?:self|window|globalThis|this)\.\$scramjetController\s*\|\|\s*\{\s*\}/g;

const buildProxyLiteral = (): string =>
  `new Proxy(Object.create(null), {` +
  `get(_t, k) { if (k === "value") return __v; throw new Error("Global slot unavailable"); }` +
  `})`;

const buildDefineProperty = (token: string): string =>
  `Object.defineProperty(self, ${JSON.stringify(token)}, {` +
  `value: ${buildProxyLiteral()},` +
  `configurable: true, enumerable: false, writable: false` +
  `})`;

// Argument-pass form: the RHS becomes the IIFE argument bound to `__v`
// rather than a `var __v = <rhs>` initializer inside the wrapper. This
// prevents aggressive minifiers (terser `inline: 2`, html-minifier-terser)
// from inlining an IIFE-shaped RHS into the wrapper and losing the inner
// scope's variable declarations. Verified against the `__ddxBase` bootstrap
// where `var p = location.pathname` was hoisted out and left `p` dangling.
const buildWriter = (token: string, rhs: string): string =>
  `(function(__v){${buildDefineProperty(token)};})(${rhs.trim()});`;

const buildControllerWriter = (token: string): string =>
  // Idempotent: reuse the existing slot's underlying object if already
  // installed by a prior IIFE, otherwise seed a fresh mutable object.
  `(function(){` +
  `var __s = self[${JSON.stringify(token)}];` +
  `if (__s) return __s.value;` +
  `var __v = {};` +
  `${buildDefineProperty(token)};` +
  `return __v;` +
  `}).call(self)`;

const buildReader = (token: string): string =>
  // Optional chaining on the slot — the writer may live in a module that
  // hasn't loaded yet (e.g. `basePath` is read at module-eval time in
  // `src/utils/basepath.ts`, whereas the writer in `src/core/shared/path.ts`
  // only runs when the service worker imports it). Without `?.`, a missing
  // slot would throw `Cannot read properties of undefined (reading 'value')`
  // at eval time and break the shell.
  `self[${JSON.stringify(token)}]?.value`;

const hasCandidate = (source: string): boolean =>
  /__scramjet\$config|__scramjet\$flags|__ddxBase|\$scramjetController/.test(
    source,
  );

export function transformHandoff(source: string, globals: Globals): string {
  if (!hasCandidate(source)) return source;

  let out = source;

  // 1) Writers first — assignments to the three property-style globals.
  // Uses a hand-rolled paren-aware RHS extractor because the RHS can contain
  // semicolons inside balanced parens/braces (e.g. inline IIFE bodies).
  out = rewriteWriters(out, globals);

  // 2) Controller writer — the IIFE-argument pattern in pre-built modules.
  out = out.replace(CONTROLLER_WRITER_RE, () =>
    buildControllerWriter(globals.scramjetController),
  );

  // 3) Readers for the property-style globals (and `$scramjetController`
  // via `<host>.$scramjetController`). Writers have been consumed above,
  // so remaining occurrences are always reads.
  out = out.replace(READER_RE, (_match, name: string) => {
    if (name === '$scramjetController') {
      return buildReader(globals.scramjetController);
    }
    return buildReader(tokenFor(name as NamedGlobal, globals));
  });

  // 4) Bare `$scramjetController` reader identifier.
  out = out.replace(CONTROLLER_READER_RE, () =>
    buildReader(globals.scramjetController),
  );

  return out;
}

// ---------------------------------------------------------------------------
// Vite plugin factory — pre-transform pass over source modules.
// ---------------------------------------------------------------------------

const SKIP_PATH_RE = /(?:^|[\\/])(?:node_modules|dist)[\\/]/;
const TEST_PATH_RE = /\.test\.[cm]?[jt]sx?$/;
const DECLARATION_PATH_RE = /\.d\.[cm]?ts$/;
const SELF_PATH_RE = /srv[\\/]vite[\\/]handoff-transform\.[cm]?ts$/;

const shouldSkip = (id: string): boolean => {
  // Vite passes ids with query strings for asset modules; strip them.
  const clean = id.split('?', 1)[0]!;
  if (SKIP_PATH_RE.test(clean)) return true;
  if (TEST_PATH_RE.test(clean)) return true;
  if (DECLARATION_PATH_RE.test(clean)) return true;
  if (SELF_PATH_RE.test(clean)) return true;
  return false;
};

export function handoffTransformPlugin(config: BuildConfig): Plugin {
  return {
    name: 'ddx-handoff-transform',
    enforce: 'pre',
    transform(code, id) {
      if (shouldSkip(id)) return null;
      const out = transformHandoff(code, config.globals);
      if (out === code) return null;
      return { code: out, map: null };
    },
  };
}
