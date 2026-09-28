import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuildConfig, createArtifactVocabulary, ARTIFACT_WORDS } from './build-config';

describe('createBuildConfig', () => {
  it('is deterministic for the same seed', () => {
    const a = createBuildConfig('seed-a');
    const b = createBuildConfig('seed-a');
    expect(a).toEqual(b);
  });
  it('produces different values for different seeds', () => {
    const a = createBuildConfig('seed-a');
    const b = createBuildConfig('seed-b');
    expect(a.buildId).not.toBe(b.buildId);
    expect(a.globals.core).not.toBe(b.globals.core);
    expect(a.routes.assets).not.toBe(b.routes.assets);
  });
  it('never emits a forbidden word in any string value', () => {
    for (let i = 0; i < 32; i++) {
      const cfg = createBuildConfig(`seed-${i}`);
      const values = collectStrings(cfg);
      for (const value of values) {
        for (const word of ARTIFACT_WORDS) {
          expect(value.toLowerCase()).not.toContain(word);
        }
      }
    }
  });
  it('re-salts filenames whose full concatenation (label + hash + ext) would contain a forbidden word', () => {
    // Enumerate a large seed range; every generated filename must be clean.
    // With 100 seeds × ~14 filename fields, we should definitely exercise the retry path.
    for (let i = 0; i < 100; i++) {
      const cfg = createBuildConfig(`boundary-${i}`);
      for (const [key, value] of Object.entries(cfg.routes)) {
        if (typeof value !== 'string') continue;
        for (const word of ARTIFACT_WORDS) {
          expect(value.toLowerCase(), `routes.${key} = ${value} contains ${word}`).not.toContain(word);
        }
      }
    }
  });
  it('returns a deeply frozen config', () => {
    const cfg = createBuildConfig('seed');
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.routes)).toBe(true);
    expect(Object.isFrozen(cfg.globals)).toBe(true);
    expect(Object.isFrozen(cfg.cover)).toBe(true);
    expect(Object.isFrozen(cfg.cover.identity)).toBe(true);
    expect(Object.isFrozen(cfg.network)).toBe(true);
    expect(Object.isFrozen(cfg.network.frame)).toBe(true);
    expect(Object.isFrozen(cfg.messages)).toBe(true);
    expect(Object.isFrozen(cfg.rpc)).toBe(true);
  });
});

describe('createArtifactVocabulary', () => {
  it('maps every artifact word to an equal-length token', () => {
    const vocab = createArtifactVocabulary('seed-a', 0);
    for (const word of ARTIFACT_WORDS) {
      expect(vocab[word]).toBeDefined();
      expect(vocab[word]!.length).toBe(word.length);
    }
  });
  it('tokens do not contain any forbidden word (case-insensitive)', () => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const vocab = createArtifactVocabulary('seed-a', attempt);
      for (const token of Object.values(vocab)) {
        for (const word of ARTIFACT_WORDS) {
          expect(token.toLowerCase()).not.toContain(word);
        }
      }
    }
  });
  it('tokens are valid identifiers in JS, CSS, and HTML-attribute grammars', () => {
    // The scrub rewrites these tokens EVERYWHERE in the build, including into
    // CSS selectors (querySelectorAll("script[<token>-injected]")) and HTML
    // attribute names (scramjet's rewriter does setAttribute(`<token>-attr-…`)).
    // A `$` — valid only in JS identifiers — makes both of those throw, so a
    // token must be a valid identifier in ALL THREE grammars: first char a
    // letter or `_`, remaining chars letters, digits, or `_` (no `$`, no `-`).
    for (let attempt = 0; attempt < 32; attempt++) {
      const vocab = createArtifactVocabulary(`seed-${attempt}`, attempt);
      for (const [word, token] of Object.entries(vocab)) {
        expect(token, `token for "${word}" = ${token}`).toMatch(
          /^[A-Za-z_][A-Za-z0-9_]*$/,
        );
        // And it must actually be usable as a CSS attribute selector.
        expect(() =>
          document.head.querySelectorAll(`meta[${token}-injected]`),
        ).not.toThrow();
      }
    }
  });
});

describe('resolveSeed', () => {
  const originalEnv = process.env.DDX_BUILD_SEED;

  // The persistence protocol writes `.ddx-seed` next to the nearest
  // `package.json` when the env var is unset. Point that lookup at a
  // temp dir per test so we don't clobber the repo's real seed file
  // during the run.
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddx-seed-test-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    const fs = await import('node:fs');
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DDX_BUILD_SEED;
    else process.env.DDX_BUILD_SEED = originalEnv;
  });

  it('honours DDX_BUILD_SEED when set', async () => {
    process.env.DDX_BUILD_SEED = 'env-seed-value';
    vi.resetModules();
    const { resolveSeed } = await import('./build-config');
    expect(resolveSeed()).toBe('env-seed-value');
  });

  it('caches the fallback seed across calls in the same process', async () => {
    delete process.env.DDX_BUILD_SEED;
    vi.resetModules();
    const { resolveSeed } = await import('./build-config');
    const a = resolveSeed();
    const b = resolveSeed();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persists a generated seed to .ddx-seed so sibling processes can read it', async () => {
    delete process.env.DDX_BUILD_SEED;
    const fs = await import('node:fs');
    const path = await import('node:path');
    vi.resetModules();
    const first = await import('./build-config');
    const generated = first.resolveSeed();

    const seedFile = path.join(tempDir, '.ddx-seed');
    expect(fs.existsSync(seedFile)).toBe(true);
    expect(fs.readFileSync(seedFile, 'utf8')).toBe(generated);

    // Simulate a second (sibling) process by resetting the module cache
    // and re-importing. It should read the persisted seed rather than
    // generating a new one.
    vi.resetModules();
    const second = await import('./build-config');
    expect(second.resolveSeed()).toBe(generated);
  });
});

function collectStrings(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') Object.values(n).forEach(walk);
  };
  walk(node);
  return out;
}
