import { expect, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import { convertHtmlToSvg } from './svg';

test.each(['load', 'error'])(
	'SVG startup waits for every module to settle (%s) before notifying DOMContentLoaded listeners',
	outcome => {
		const svg = convertHtmlToSvg(
			'<html><body><script type="module" src="./controller-loader.js"></script><script type="module" src="./home.js"></script></body></html>'
		);
		const source = svg.match(
			/<script\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/script>/
		)?.[1];
		expect(source).toBeTruthy();
		const scripts: any[] = [];
		const events: string[] = [];
		const body = {
			prepend() {},
			appendChild(node: any) {
				scripts.push(node);
			}
		};
		const document = {
			querySelector: () => body,
			createElement() {},
			createElementNS: (_ns: string, tag: string) => ({
				tag,
				setAttribute(key: string, value: string) {
					(this as any)[key] = value;
				}
			}),
			dispatchEvent(event: Event) {
				events.push(event.type);
			}
		};
		runInNewContext(source!, { document, Event });
		expect(scripts.map(s => s.src)).toEqual([
			'./controller-loader.js',
			'./home.js'
		]);
		// The small last-listed entry finishes before the large controller module.
		scripts[1].onload();
		expect(events).toEqual([]);
		expect(scripts[0][`on${outcome}`]).toBeTypeOf('function');
		scripts[0][`on${outcome}`]();
		expect(events).toEqual(['DOMContentLoaded']);
	}
);
