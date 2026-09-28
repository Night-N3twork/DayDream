import type { Plugin, ResolvedConfig } from 'vite';
import type { BuildConfig } from './build-config';

import {
  ARTIFACT_WORDS,
  CASE_SENSITIVE_ARTIFACT_WORDS,
  PROTECTED_LITERALS,
  createArtifactVocabulary,
} from './build-config';

// ---------------------------------------------------------------------------
// Byte-level ASCII helpers (ported from Starlight/scripts/build.ts:119-169)
// ---------------------------------------------------------------------------

const asciiLower = (byte: number): number =>
  byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;

// Some words (`proxy`) must be matched case-sensitively so the JS built-in
// `Proxy` survives untouched.
const byteMatches = (a: number, b: number, caseSensitive: boolean): boolean =>
  caseSensitive ? a === b : asciiLower(a) === asciiLower(b);

const includesAscii = (
  source: Buffer,
  needle: Buffer,
  caseSensitive = false,
): boolean => {
  for (let offset = 0; offset <= source.length - needle.length; offset++) {
    let matches = true;
    for (let index = 0; index < needle.length; index++) {
      if (!byteMatches(source[offset + index]!, needle[index]!, caseSensitive)) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
};

const replaceAscii = (
  source: Buffer,
  needle: Buffer,
  replacement: Buffer,
  caseSensitive = false,
): number => {
  let replacements = 0;
  for (let offset = 0; offset <= source.length - needle.length; ) {
    let matches = true;
    for (let index = 0; index < needle.length; index++) {
      if (!byteMatches(source[offset + index]!, needle[index]!, caseSensitive)) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      offset++;
      continue;
    }
    replacement.copy(source, offset);
    offset += replacement.length;
    replacements++;
  }
  return replacements;
};

// ---------------------------------------------------------------------------
// Public: scrubBuffer — in-place byte replacement, length-preserving
// ---------------------------------------------------------------------------

export const scrubBuffer = (
  source: Buffer,
  vocabulary: Record<string, string>,
): number => {
  let replacements = 0;
  for (const [word, token] of Object.entries(vocabulary)) {
    const needle = Buffer.from(word, 'ascii');
    const replacement = Buffer.from(token, 'ascii');
    if (needle.length !== replacement.length) {
      throw new Error(`Artifact token length changed for ${word}`);
    }
    replacements += replaceAscii(
      source,
      needle,
      replacement,
      CASE_SENSITIVE_ARTIFACT_WORDS.has(word),
    );
  }
  return replacements;
};

// ---------------------------------------------------------------------------
// Public: scrubJavaScript — extract long base64 payloads, scrub decoded bytes,
// re-encode with quote splices around any forbidden matches in the re-encoded
// base64 output (so the re-encoded string can't spell a forbidden word), then
// scrub the surrounding source too.
// ---------------------------------------------------------------------------

type EmbeddedBinary = {
  readonly marker: string;
  readonly payload: string;
  readonly quote: string;
};

export const scrubJavaScript = (
  source: string,
  vocabulary: Record<string, string>,
): string => {
  const forbiddenWords = Object.keys(vocabulary);
  const embedded: EmbeddedBinary[] = [];
  const protectedSource = source.replace(
    // Match base64 payloads delimited by any JS string quote INCLUDING
    // backticks. Obscura embeds its ~232 KB WASM as a backtick template
    // literal; without the backtick here the payload is left unprotected and
    // the byte scrub corrupts it (e.g. an incidental `bare` in the base64 →
    // `$7A0`, which is not a valid base64 char → runtime `atob` failure).
    /([`"'])((?:data:[^`"']*;base64,)?)([A-Za-z0-9+/]{256,}={0,2})\1/g,
    (full, quote: string, prefix: string, payload: string) => {
      const decoded = Buffer.from(payload, 'base64');
      // Reject non-canonical base64 (whitespace, illegal chars) — leave untouched.
      if (decoded.toString('base64') !== payload) return full;
      scrubBuffer(decoded, vocabulary);
      if (
        decoded.length >= 4 &&
        decoded.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])) &&
        !WebAssembly.validate(decoded)
      ) {
        throw new Error('Sanitized embedded WASM artifact is invalid');
      }
      // Marker MUST NOT contain any ARTIFACT_WORD (case-insensitive): the byte
      // scrub below runs over the protected source and would rewrite a
      // colliding marker (e.g. the old `__DDX_…` collided with the `__ddx`
      // artifact word → `$PkoH_…`), leaving the base64 payload unrecoverable
      // and emitting `data:…;base64,$PkoH_EMBEDDED_BINARY_0__`.
      const marker = `__EMBEDDED_BINARY_${embedded.length}__`;
      embedded.push({
        marker,
        payload: decoded.toString('base64'),
        quote,
      });
      return `${quote}${prefix}${marker}${quote}`;
    },
  );
  // Protect load-bearing external literals (e.g. `nightwisp.me`) so the byte
  // scrub leaves them intact. Swap each for a word-free marker before the
  // scrub and restore verbatim afterwards.
  const protectedLiterals: { marker: string; value: string }[] = [];
  let literalGuardedSource = protectedSource;
  for (const literal of PROTECTED_LITERALS) {
    if (!literalGuardedSource.includes(literal)) continue;
    const marker = `__PROTECTED_LITERAL_${protectedLiterals.length}__`;
    protectedLiterals.push({ marker, value: literal });
    literalGuardedSource = literalGuardedSource.split(literal).join(marker);
  }
  const bytes = Buffer.from(literalGuardedSource);
  scrubBuffer(bytes, vocabulary);
  let output = bytes.toString('utf8');
  for (const { marker, value } of protectedLiterals) {
    output = output.split(marker).join(value);
  }
  for (const item of embedded) {
    let payload = item.payload;
    for (const word of forbiddenWords) {
      const pattern = new RegExp(escapeRegex(word), 'gi');
      payload = payload.replace(
        pattern,
        match =>
          `${match.slice(0, 2)}${item.quote}+${item.quote}${match.slice(2)}`,
      );
    }
    output = output.replace(item.marker, payload);
  }
  return output;
};

// ---------------------------------------------------------------------------
// Public: scrubArtifact — read, dispatch JS vs binary, re-validate WASM
// ---------------------------------------------------------------------------

export const scrubArtifact = async (
  path: string,
  vocabulary: Record<string, string>,
): Promise<{ replacements: number }> => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const source = Buffer.from(await readFile(path));

  if (/\.(?:m?js)$/i.test(path)) {
    const inputText = source.toString('utf8');
    const output = scrubJavaScript(inputText, vocabulary);
    // Rough replacement count: difference in length of scrubbed segments is
    // zero because the pass is length-preserving; use the byte-scrubber
    // return value as ground truth by re-running against a copy.
    const counter = Buffer.from(inputText, 'utf8');
    const replacements = scrubBuffer(counter, vocabulary);
    await writeFile(path, output);
    return { replacements };
  }

  const replacements = scrubBuffer(source, vocabulary);
  if (/\.wasm$/i.test(path) && !WebAssembly.validate(new Uint8Array(source))) {
    throw new Error(`Sanitized WASM artifact is invalid: ${path}`);
  }
  await writeFile(path, source);
  return { replacements };
};

// ---------------------------------------------------------------------------
// Public: scrubPlugin — Vite plugin factory
// ---------------------------------------------------------------------------

const walkFiles = async (directory: string): Promise<string[]> => {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rewrite a single basename by applying every forbidden-word → token
// substitution defined by `vocabulary`. Case sensitivity matches the byte
// scrub (only `proxy` is case-sensitive, all others case-insensitive).
const applyVocabToName = (
  name: string,
  vocabulary: Record<string, string>,
): string => {
  let out = name;
  for (const word of ARTIFACT_WORDS) {
    const token = vocabulary[word];
    if (!token) continue;
    const caseSensitive = CASE_SENSITIVE_ARTIFACT_WORDS.has(word);
    const re = new RegExp(escapeRegex(word), caseSensitive ? 'g' : 'gi');
    out = out.replace(re, token);
  }
  return out;
};

// Bottom-up rename of every entry under `dir` whose basename contains a
// forbidden word. Recurses first so that renaming a parent directory doesn't
// invalidate paths of its still-unprocessed children.
const renameEntriesRecursively = async (
  dir: string,
  vocabulary: Record<string, string>,
  warn: (message: string) => void,
): Promise<void> => {
  const { readdir, rename, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const entries = await readdir(dir, { withFileTypes: true });
  // Recurse into subdirectories first (bottom-up).
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await renameEntriesRecursively(join(dir, entry.name), vocabulary, warn);
    }
  }
  // Then rename at this level (both files and directories).
  for (const entry of entries) {
    const renamed = applyVocabToName(entry.name, vocabulary);
    if (renamed === entry.name) continue;
    const from = join(dir, entry.name);
    const to = join(dir, renamed);
    try {
      await stat(to);
      warn(
        `[ddx-vocabulary-scrub] rename collision: refusing to overwrite ${to} ` +
          `(source ${from}); leaving source in place`,
      );
      continue;
    } catch {
      // Target does not exist — safe to rename.
    }
    await rename(from, to);
  }
};

const deriveCollisionFreeVocabulary = async (
  seed: string,
  files: readonly string[],
): Promise<Record<string, string>> => {
  const { readFile } = await import('node:fs/promises');
  const sources = await Promise.all(files.map(file => readFile(file)));

  for (let attempt = 0; attempt < 1024; attempt++) {
    const candidate = createArtifactVocabulary(seed, attempt);
    const tokens = Object.values(candidate);
    // Tokens themselves must be unique (case-insensitive) so distinct words
    // don't collapse into the same replacement.
    if (
      new Set(tokens.map(token => token.toLowerCase())).size !== tokens.length
    ) {
      continue;
    }
    // No token substring may already exist verbatim in any staged artifact —
    // otherwise the scrub would rewrite bystanders as if they were a
    // previously-scrubbed forbidden word.
    if (
      tokens.some(token => {
        const needle = Buffer.from(token, 'ascii');
        return sources.some(source => includesAscii(source, needle));
      })
    ) {
      continue;
    }
    return candidate;
  }
  throw new Error('Could not derive collision-free artifact vocabulary');
};

export const scrubPlugin = (config: BuildConfig, seed: string): Plugin => {
  // `config` is accepted for symmetry with sibling plugins and future
  // extensibility (e.g. per-build salting) — the scrub itself is driven
  // purely by ARTIFACT_WORDS + the derived vocabulary.
  void config;
  let vite: ResolvedConfig;
  return {
    name: 'ddx-vocabulary-scrub',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      vite = c;
    },
    async closeBundle() {
      const { resolve } = await import('node:path');
      // Resolve the output directory from the resolved Vite config rather
      // than hardcoding `<root>/dist`. This mirrors assert-artifacts.ts /
      // break-internal-scheme.ts and is equivalent for the main build
      // (outDir defaults to `dist`), while correctly targeting
      // `dist-bootstrap/` for the bootstrap build.
      const outDir = resolve(vite.root, vite.build.outDir);

      let files: string[];
      try {
        files = await walkFiles(outDir);
      } catch {
        // dist/ doesn't exist — nothing to scrub (e.g. dry-run).
        return;
      }
      if (files.length === 0) return;

      const vocabulary = await deriveCollisionFreeVocabulary(seed, files);

      // Persist the scrubbed plain-wisp upgrade path so the (unscrubbed)
      // Fastify server can match the path the (scrubbed) client actually
      // connects to. The client hardcodes `/wisp/`; the byte scrub rewrites
      // the `wisp` artifact word to a seeded token, so in production the
      // client opens `wss://…/<token>/`. Without this manifest the server's
      // `routeUpgrade` keeps matching the literal `/wisp/` and 502s every
      // proxy socket. `.build-*` files are skipped by the artifact assertion.
      // NOTE: the manifest filename must not contain an artifact word, or the
      // `renameEntriesRecursively` pass below would rewrite it (e.g. a naive
      // `.build-wisp` becomes `.build-<token>`). `.build-transport` is safe.
      {
        const { writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const wispBuf = Buffer.from('/wisp/', 'ascii');
        scrubBuffer(wispBuf, vocabulary);
        await writeFile(
          join(outDir, '.build-transport'),
          wispBuf.toString('ascii'),
        );
      }

      let totalReplacements = 0;
      for (const file of files) {
        const { replacements } = await scrubArtifact(file, vocabulary);
        totalReplacements += replacements;
      }

      // After content-byte scrub: rename filesystem paths (files + dirs)
      // whose basenames contain forbidden words, using the same vocabulary
      // as the byte scrub. This keeps in-code references (which the byte
      // scrub just rewrote to tokens) resolvable against the on-disk tree.
      await renameEntriesRecursively(outDir, vocabulary, message =>
        this.warn(message),
      );

      // Refresh the file list to reflect the post-rename tree so the
      // defensive re-scan below inspects the actual on-disk paths.
      files = await walkFiles(outDir);

      if (!totalReplacements) {
        this.warn(
          '[ddx-vocabulary-scrub] no forbidden words were found in dist/ — ' +
            'verify the artifact word list still describes upstream vendor code',
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[ddx-vocabulary-scrub] rewrote ${totalReplacements} occurrence(s) ` +
            `across ${files.length} file(s) in ${outDir}`,
        );
      }

      // Sanity: ensure no forbidden word remains anywhere in dist/. This is
      // a defensive local check; Task 7's assertion pass runs the same check
      // as a hard build gate.
      const { readFile } = await import('node:fs/promises');
      for (const file of files) {
        const bytes = await readFile(file);
        // Strip protected literals (e.g. `nightwisp.me`) before scanning so
        // their intentional artifact-word substrings don't trip the gate.
        let haystack = bytes;
        for (const literal of PROTECTED_LITERALS) {
          const text = haystack.toString('binary').split(literal).join('');
          haystack = Buffer.from(text, 'binary');
        }
        for (const word of ARTIFACT_WORDS) {
          const caseSensitive = CASE_SENSITIVE_ARTIFACT_WORDS.has(word);
          const needle = Buffer.from(word, 'ascii');
          if (includesAscii(haystack, needle, caseSensitive)) {
            throw new Error(
              `[ddx-vocabulary-scrub] forbidden word "${word}" remains in ${file}`,
            );
          }
        }
      }
    },
  };
};
