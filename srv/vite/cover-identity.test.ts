import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { coverIdentityPlugin } from './cover-identity';
import { createBuildConfig } from './build-config';

describe('production analytics initialization', () => {
  it.each(['index.html', 'src/pages/landing/index.html'])('initializes a browser tag through the local script endpoint in %s', (file) => {
    const plugin = coverIdentityPlugin(createBuildConfig('analytics-test'));
    const handler = (plugin.transformIndexHtml as any).handler;
    const html = handler(readFileSync(file, 'utf8'), { filename: file });
    // Execute inline scripts only: the test never contacts Google.
    const dom = new JSDOM(html, { url: 'https://example.com/app/', runScripts: 'outside-only' });
    const window = dom.window as any;
    window.setTimeout = () => 0;
    for (const script of window.document.querySelectorAll('script:not([src])')) {
      if (script.type !== 'module') window.eval(script.textContent);
    }
    expect(typeof window.gtag).toBe('function');
    expect(Array.from(window.dataLayer[1])).toEqual(['config', 'G-BMERY7ZH6Z']);
    const tag = Array.from(
      window.document.querySelectorAll('script[src]')
    ).find((el: any) => el.src.endsWith('/api/tag.js'));
    expect(tag).not.toBeUndefined();
    expect(tag!.async).toBe(true);
    expect(window.dataLayer.some((entry: any) => entry[2]?.transport_url)).toBe(false);
    // Static deployments have no API server; fall back to Google's script only.
    tag.onerror();
    const direct = window.document.querySelector(
      'script[src="https://www.googletagmanager.com/gtag/js?id=G-BMERY7ZH6Z"]'
    );
    expect(direct).not.toBeNull();
    expect(tag.onerror).toBeNull();
    dom.window.close();
  });
});
