import { describe, expect, it } from 'vitest';
import { convertHtmlToSvg } from './svg';

describe('convertHtmlToSvg deployment-relative assets', () => {
	it('rewrites root-absolute document resources and external script loaders relative to the SVG', () => {
		const svg = convertHtmlToSvg(`<!doctype html><html><head>
			<link rel="stylesheet" href="/assets/app.css">
			<link rel="icon" href="/favicon.svg">
			<script type="module" src="/_astro/app.js"></script>
			<style>.hero { background-image: url('/images/hero.png') }</style>
		</head><body><img src="/images/logo.png"><a href="/settings/">Settings</a></body></html>`);

		expect(svg).toContain('href="./assets/app.css"');
		expect(svg).toContain('href="./favicon.svg"');
		expect(svg).toContain('src":"./_astro/app.js"');
		expect(svg).toContain('src="./images/logo.png"');
		expect(svg).toContain('href="./settings/"');
		expect(svg).toContain("url('./images/hero.png')");
		expect(svg).not.toContain('href="/assets/');
	});

	it('leaves external, protocol-relative, fragment, and already-relative URLs alone', () => {
		const svg = convertHtmlToSvg(`<html><body>
			<a href="https://example.com/x">external</a>
			<a href="//cdn.example.com/x">protocol-relative</a>
			<a href="#section">fragment</a>
			<img src="./images/local.png">
		</body></html>`);

		expect(svg).toContain('href="https://example.com/x"');
		expect(svg).toContain('href="//cdn.example.com/x"');
		expect(svg).toContain('href="#section"');
		expect(svg).toContain('src="./images/local.png"');
	});

	it('serializes HTML named entities as XML-safe character references', () => {
		const svg = convertHtmlToSvg(
			'<html><body><p>&copy; 2026</p></body></html>'
		);
		expect(svg).not.toContain('&copy;');
		expect(svg).toContain('&#169; 2026');
	});

	it('does not execute JSON-LD script payloads as JavaScript', () => {
		const svg = convertHtmlToSvg(
			`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script></head><body><p>Site</p></body></html>`
		);
		expect(svg).not.toContain('"@context"');
		expect(svg).toContain('Site');
	});

	it('preserves inert text/plain payloads verbatim with id for fallback loaders', () => {
		const svg = convertHtmlToSvg(
			`<html><head><script id="ddx-gtag-inline" type="text/plain">window.x=1<2&&a]]>b;</script></head><body><p>Site</p></body></html>`
		);
		expect(svg).toContain('id="ddx-gtag-inline"');
		expect(svg).toContain('window.x=1');
		expect(svg).toContain('<![CDATA[window.x=1<2&&a]]]]><![CDATA[>b;]]>');
	});
});
