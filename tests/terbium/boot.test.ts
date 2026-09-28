import { describe, it, expect, vi } from 'vitest';
import { resolveParentWisp, detectParent } from '../../src/terbium/boot';
import { installIsland } from '../../src/terbium/island';

function makeParent(opts: {
  scramjetWisp?: string;
  tbSjWisp?: string;
  proxyWispUrl?: string;
  host?: string;
  protocol?: string;
}): any {
  return {
    location: {
      host: opts.host ?? 'terbium.example',
      protocol: opts.protocol ?? 'https:',
    },
    $scramjet: opts.scramjetWisp
      ? { config: { wisp: opts.scramjetWisp } }
      : undefined,
    tb: {
      _sj: opts.tbSjWisp ? { config: { wisp: opts.tbSjWisp } } : undefined,
      proxy: opts.proxyWispUrl ? { wispUrl: opts.proxyWispUrl } : undefined,
    },
  };
}

describe('resolveParentWisp', () => {
  it('prefers parent.$scramjet.config.wisp', () => {
    const p = makeParent({
      scramjetWisp: 'wss://a.test/wisp/',
      tbSjWisp: 'wss://b.test/wisp/',
      proxyWispUrl: 'wss://c.test/wisp/',
    });
    expect(resolveParentWisp(p, p.tb)).toBe('wss://a.test/wisp/');
  });

  it('falls back to parent.tb._sj.config.wisp', () => {
    const p = makeParent({
      tbSjWisp: 'wss://b.test/wisp/',
      proxyWispUrl: 'wss://c.test/wisp/',
    });
    expect(resolveParentWisp(p, p.tb)).toBe('wss://b.test/wisp/');
  });

  it('falls back to parent.tb.proxy.wispUrl', () => {
    const p = makeParent({ proxyWispUrl: 'wss://c.test/wisp/' });
    expect(resolveParentWisp(p, p.tb)).toBe('wss://c.test/wisp/');
  });

  it('falls back to same-origin /wisp/ when nothing else available', () => {
    const p = makeParent({ host: 'terb.local', protocol: 'https:' });
    expect(resolveParentWisp(p, p.tb)).toBe('wss://terb.local/wisp/');
  });

  it('uses ws:// for http origins', () => {
    const p = makeParent({ host: 'terb.local', protocol: 'http:' });
    expect(resolveParentWisp(p, p.tb)).toBe('ws://terb.local/wisp/');
  });

  it('returns null if accessing parent throws', () => {
    const throwingParent: any = new Proxy({}, {
      get() { throw new Error('cross-origin'); },
    });
    expect(resolveParentWisp(throwingParent, {})).toBeNull();
  });
});

describe('detectParent', () => {
  it('returns null when window.parent === window (standalone)', () => {
    const win: any = {};
    win.parent = win;
    expect(detectParent(win)).toBeNull();
  });

  it('returns null when parent has no tb', () => {
    const win: any = {
      parent: { location: { host: 'a', protocol: 'https:' } },
    };
    expect(detectParent(win)).toBeNull();
  });

  it('returns bridge when parent.tb present', () => {
    const parent: any = {
      location: { host: 'terbium.example', protocol: 'https:' },
      tb: { version: 'fake' },
    };
    const win: any = { parent };
    const result = detectParent(win);
    expect(result).not.toBeNull();
    expect(result?.tb).toBe(parent.tb);
    expect(result?.wispUrl).toBe('wss://terbium.example/wisp/');
  });

  it('catches cross-origin parent access and returns null', () => {
    const win: any = {
      get parent() { throw new DOMException('cross-origin', 'SecurityError'); },
    };
    expect(detectParent(win)).toBeNull();
  });
});

describe('installIsland', () => {
  it('adds compatible Terbium shortcuts to the app menu', () => {
    const addControl = vi.fn();
    const create = vi.fn();
    const tb = {
      window: { island: { addControl, removeControl: vi.fn() } },
      contextmenu: { create },
    };

    installIsland(tb);
    const control = (addControl as any).mock.calls[0][0];
    control.click();
    const labels = create.mock.calls[0][0].options
      .filter(Boolean)
      .map((option: { text: string }) => option.text);

    expect(labels).toContain('New Window');
    expect(labels).toContain('Extensions');
    expect(labels).toContain('DevTools');
  });
});
