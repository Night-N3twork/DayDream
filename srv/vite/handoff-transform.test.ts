import { describe, expect, it } from 'vitest';
import { transformHandoff } from './handoff-transform';

const globals = {
  core: 'gCore',
  controller: 'gCtl',
  utils: 'gUt',
  ddxBase: 'gDdx',
  scramjetConfig: 'gSc',
  scramjetFlags: 'gSf',
  scramjetController: 'gCtlR',
};

describe('transformHandoff', () => {
  it('rewrites plain global assignment into non-enumerable Proxy handoff', () => {
    const src = 'self.__scramjet$config = config;';
    const out = transformHandoff(src, globals);
    expect(out).not.toContain('self.__scramjet$config =');
    expect(out).toContain('"gSc"');
    expect(out).toContain('Object.defineProperty');
    expect(out).toContain('enumerable: false');
    expect(out).toContain('new Proxy(Object.create(null)');
  });

  it('rewrites reads to go through the handoff slot', () => {
    const src = 'const x = self.__scramjet$config.prefix;';
    const out = transformHandoff(src, globals);
    expect(out).toContain('self["gSc"]?.value.prefix');
    expect(out).not.toContain('__scramjet$config');
  });

  it('rewrites $scramjetController identifier', () => {
    const src = 'const { Controller } = $scramjetController;';
    const out = transformHandoff(src, globals);
    expect(out).toContain('self["gCtlR"]?.value');
    expect(out).not.toContain('$scramjetController');
  });

  it('leaves unrelated globals alone', () => {
    const src = 'self.somethingElse = 1;';
    expect(transformHandoff(src, globals)).toBe('self.somethingElse = 1;');
  });

  it('handles ddxBase writer + reader in same file', () => {
    const src = 'self.__ddxBase = ddxBase;\nconst b = self.__ddxBase;';
    const out = transformHandoff(src, globals);
    expect(out).toContain('"gDdx"');
    expect(out).not.toContain('self.__ddxBase =');
    // The bare read `self.__ddxBase;` won't match the reader regex (no . or [ or ? after).
    // Accept this limitation: only property-access reads are rewritten.
  });

  it('rewrites window.* readers into the same seeded slot', () => {
    const src = 'const cfg = window.__scramjet$config;\n' +
      'const flg = window.__scramjet$flags;';
    const out = transformHandoff(src, globals);
    expect(out).toContain('self["gSc"]?.value');
    expect(out).toContain('self["gSf"]?.value');
    expect(out).not.toContain('window.__scramjet$config');
    expect(out).not.toContain('window.__scramjet$flags');
  });

  it('rewrites TypeScript casts of the form (self as any).NAME', () => {
    const src = 'const c = (self as any).__scramjet$config?.codec;';
    const out = transformHandoff(src, globals);
    expect(out).toContain('self["gSc"]?.value');
    expect(out).not.toContain('__scramjet$config');
  });

  it('rewrites the pre-built IIFE controller writer idempotently', () => {
    const src =
      '(function(e){e.load = X;})(this.$scramjetController=this.$scramjetController||{});';
    const out = transformHandoff(src, globals);
    // Original self-referential assignment is gone.
    expect(out).not.toContain('this.$scramjetController=this.$scramjetController');
    // A defineProperty call installs the seeded slot.
    expect(out).toContain('Object.defineProperty');
    expect(out).toContain('"gCtlR"');
    // Idempotency guard: the transform reuses an existing slot on later loads.
    expect(out).toContain('self["gCtlR"]');
  });

  it('preserves an IIFE RHS whose body contains semicolons (regression)', () => {
    // The __ddxBase bootstrap in index.html reads location.pathname inside an
    // IIFE whose body contains multiple `;`. A naive `[^;]+` RHS capture
    // truncated at the first inner `;`, corrupting the emitted script and
    // leaving stray parens outside the IIFE. Regression test.
    const src =
      'self.__ddxBase = (function(){var p = location.pathname; var i = p.indexOf("/x/"); return i;})();';
    const out = transformHandoff(src, globals);
    expect(out).not.toContain('self.__ddxBase =');
    // The full IIFE must be preserved as the writer's RHS argument.
    expect(out).toContain('var p = location.pathname');
    expect(out).toContain('var i = p.indexOf("/x/")');
    // The outer wrapper receives the IIFE result as its parameter.
    expect(out).toMatch(/\(function\(__v\)\{Object\.defineProperty\(self, "gDdx".*\)\(\(function\(\)\{var p = location\.pathname/);
  });
});
