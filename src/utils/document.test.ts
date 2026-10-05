import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchDocument } from './document';

afterEach(() => vi.unstubAllGlobals());

describe('patchDocument SVG integration', () => {
	it.each(['write', 'writeln'] as const)(
		'preserves SVG bootstrap %s outside the app shadow root',
		method => {
			const svgDocument = new DOMParser().parseFromString(
				'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><div id="app-host"/></body></foreignObject></svg>',
				'image/svg+xml'
			);
			const body = svgDocument.querySelector('body')!;
			const host = svgDocument.getElementById('app-host')!;
			const root = host.attachShadow({ mode: 'open' });
			const write = vi.fn((...parts: string[]) => {
				const parsed = new DOMParser().parseFromString(
					parts.join(''),
					'text/html'
				);
				for (const node of Array.from(parsed.body.childNodes)) {
					body.appendChild(svgDocument.importNode(node, true));
				}
			});
			Object.defineProperty(svgDocument, method, {
				value: write,
				configurable: true,
				writable: true
			});
			vi.stubGlobal('document', svgDocument);

			patchDocument(root, svgDocument);
			expect(svgDocument[method]).toBe(write);
			svgDocument[method]('<div id="ad-overlay">', 'Ad&nbsp;<br></div>');
			// Avoid jsdom's ID-selector optimization through the patched document.
			expect(body.querySelector('[id="ad-overlay"]')?.textContent).toBe(
				'Ad\u00a0'
			);
			expect(root.querySelector('#ad-overlay')).toBeNull();
			expect(svgDocument.querySelector('#app-host')).toBeNull();
		}
	);

	it('retains shadow-root writes for ordinary HTML documents', () => {
		const htmlDocument = document.implementation.createHTMLDocument();
		const host = htmlDocument.createElement('div');
		htmlDocument.body.appendChild(host);
		const root = host.attachShadow({ mode: 'open' });
		vi.stubGlobal('document', htmlDocument);

		patchDocument(root, htmlDocument);
		htmlDocument.write('<span id="app-write">App</span>');
		expect(root.querySelector('#app-write')?.textContent).toBe('App');
		expect(htmlDocument.body.querySelector('#app-write')).toBeNull();
	});
});
