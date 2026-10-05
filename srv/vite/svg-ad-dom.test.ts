import { expect, test } from 'vitest';
import { JSDOM } from 'jsdom';
import { convertHtmlToSvg } from './svg';

function shell() {
	const svg = convertHtmlToSvg(
		'<html><body><div id="app-host"></div></body></html>'
	);
	const dom = new JSDOM(svg, {
		url: 'https://example.test/package/index.svg',
		contentType: 'image/svg+xml',
		runScripts: 'outside-only'
	});
	const source =
		dom.window.document.querySelector('svg > script')!.textContent!;
	dom.window.eval(source);
	return dom;
}

test('HTML overlays appended to the XML document root render inside the foreignObject body', () => {
	const dom = shell();
	const { document } = dom.window;
	const overlay = document.createElement('div');
	document.documentElement.appendChild(overlay);
	expect(overlay.parentNode).toBe(document.body);
	expect(overlay.closest('foreignObject')).not.toBeNull();
	expect(document.documentElement.lastElementChild).toBe(overlay);
	expect(overlay.tagName).toBe('DIV');
	const nativeSvg = document.createElementNS(
		'http://www.w3.org/2000/svg',
		'rect'
	);
	document.documentElement.appendChild(nativeSvg);
	expect(nativeSvg.parentNode).toBe(document.documentElement);
	expect(document.documentElement.lastElementChild).toBe(nativeSvg);
	dom.window.close();
});

test('vendor iframe maintenance can reorder and remove real body siblings', () => {
	const dom = shell();
	const { document } = dom.window;
	const frame = document.createElement('iframe');
	frame.className = 'fixture-container';
	document.documentElement.appendChild(frame);
	expect(document.documentElement.lastElementChild?.tagName).toBe('IFRAME');
	const sibling = document.createElement('div');
	document.documentElement.appendChild(sibling);
	expect(frame.nextSibling).toBe(sibling);
	frame.parentNode!.insertBefore(sibling, frame);
	expect(document.documentElement.lastElementChild).toBe(frame);
	frame.parentNode!.removeChild(frame);
	expect(document.body.contains(frame)).toBe(false);
	dom.window.close();
});

test('written ad markup is parsed as HTML into the outer XHTML body rather than dropped', () => {
	const dom = shell();
	const { document } = dom.window;
	document.write('<div id="ad-written">Ad&nbsp;markup</div>');
	const overlay = document.getElementById('ad-written');
	expect(overlay?.parentNode).toBe(document.body);
	expect(overlay?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
	expect(overlay?.textContent).toBe('Ad\u00a0markup');
	dom.window.close();
});
