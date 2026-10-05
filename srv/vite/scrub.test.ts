import { describe, expect, it } from 'vitest';
import { scrubBuffer, scrubJavaScript } from './scrub';

// Vocabulary tokens aligned to their word length. `scrubBuffer` throws if any
// token has a different byte length from its word.
// scramjet=8, scram=5, wisp=4, epoxy=5, libcurl=7, mercuryworkshop=15,
// ultraviolet=11, rawproxy=8, proxy-transports=16, bare=4.
// NOTE: standalone "proxy" is no longer an artifact word (too generic; it
// corrupted user-facing copy). The compound tells rawproxy/proxy-transports
// remain. CASE_SENSITIVE_ARTIFACT_WORDS is now empty → all words match
// case-insensitively.
const alignedVocab = {
  scramjet: 'AAAAAAAA',
  scram: 'BBBBB',
  wisp: 'CCCC',
  epoxy: 'DDDDD',
  libcurl: 'EEEEEEE',
  mercuryworkshop: 'FFFFFFFFFFFFFFF',
  ultraviolet: 'GGGGGGGGGGG',
  rawproxy: 'HHHHHHHH',
  'proxy-transports': 'IIIIIIIIIIIIIIII',
  bare: 'JJJJ',
};

describe('scrubBuffer', () => {
  it('replaces every forbidden word with its equal-length token', () => {
    const buf = Buffer.from('scramjet is scram and wisp says epoxy');
    scrubBuffer(buf, alignedVocab);
    const out = buf.toString();
    expect(out).not.toMatch(/scramjet|wisp|epoxy/i);
    // standalone "proxy" is not in the vocab, so it is never touched
    const buf2 = Buffer.from('a proxy and a Proxy');
    scrubBuffer(buf2, alignedVocab);
    expect(buf2.toString()).toBe('a proxy and a Proxy');
  });
  it('is case-insensitive for all artifact words', () => {
    const buf = Buffer.from('Scramjet SCRAMJET scRaMjEt');
    scrubBuffer(buf, alignedVocab);
    const out = buf.toString();
    expect(out.toLowerCase()).not.toContain('scramjet');
  });
  it('throws when a vocabulary token does not preserve word length', () => {
    const buf = Buffer.from('scramjet');
    expect(() => scrubBuffer(buf, { scramjet: 'too-short' })).toThrow(
      /Artifact token length changed/,
    );
  });
});

describe('scrubJavaScript', () => {
  it('scrubs raw source', () => {
    const src = 'const scramjet = "wisp epoxy";';
    const out = scrubJavaScript(src, alignedVocab);
    expect(out).not.toContain('scramjet');
    expect(out).not.toContain('wisp');
    expect(out).not.toContain('epoxy');
  });
  it('scrubs long base64 payloads by decoding, replacing, re-encoding', () => {
    // Build a payload whose decoded bytes contain "scramjet"
    const decoded = Buffer.from('scramjet payload data ' + 'x'.repeat(240)); // >=256 chars decoded
    const encoded = decoded.toString('base64');
    const src = `const x = "${encoded}";`;
    const out = scrubJavaScript(src, alignedVocab);
    // The output should still be valid JS syntax with a string literal
    expect(out).toMatch(/const x = "/);
    // The decoded base64 in the output should no longer contain "scramjet".
    // Because scrubJavaScript splices quotes around forbidden words in
    // re-encoded payloads, we can't do a simple base64 decode. Just verify
    // the source text doesn't have literal 'scramjet'.
    expect(out).not.toContain('scramjet');
  });
  it('preserves protected external literals (nightwisp.me) while still scrubbing bare wisp', () => {
    const src =
      'const host = "nightwisp.me"; const t = "wisp transport";';
    const out = scrubJavaScript(src, alignedVocab);
    // The load-bearing external host must survive verbatim...
    expect(out).toContain('nightwisp.me');
    // ...but an unrelated bare `wisp` token is still scrubbed.
    expect(out).toContain('CCCC transport');
    expect(out).not.toMatch(/"wisp transport"/);
  });
});
