import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { convertHtmlToSvg } from './svg';

describe('inline SVG icons in the XML app shell', () => {
	it('restores SVG namespaces for Astro symbol/use icons without changing fragment references', () => {
		const document = new JSDOM(
			convertHtmlToSvg(`<html><body>
      <nav><svg data-icon="ph:house-bold" width="24" height="24"><symbol id="ai:ph:house-bold" viewBox="0 0 256 256"><path d="M0 0h24v24z" /></symbol><use href="#ai:ph:house-bold" /></svg></nav>
      <aside><svg data-icon="ph:house-bold"><use href="#ai:ph:house-bold" /></svg></aside>
      <p>Home</p>
    </body></html>`),
			{ contentType: 'image/svg+xml' }
		).window.document;
		for (const element of document.querySelectorAll(
			'svg, symbol, path, use'
		)) {
			expect(element.namespaceURI).toBe('http://www.w3.org/2000/svg');
		}
		for (const use of document.querySelectorAll('use')) {
			expect(use.getAttribute('href')).toBe('#ai:ph:house-bold');
			expect(
				document.getElementById('ai:ph:house-bold')?.namespaceURI
			).toBe('http://www.w3.org/2000/svg');
		}
		expect(document.querySelector('p')?.namespaceURI).toBe(
			'http://www.w3.org/1999/xhtml'
		);
	});

	it('keeps an explicitly namespaced logo valid without duplicate xmlns attributes', () => {
		const document = new JSDOM(
			convertHtmlToSvg(
				'<html><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24" /></svg></body></html>'
			),
			{
				contentType: 'image/svg+xml'
			}
		).window.document;
		expect(document.querySelector('body svg path')?.namespaceURI).toBe(
			'http://www.w3.org/2000/svg'
		);
	});
});
