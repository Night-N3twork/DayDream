import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const legalPages = [
	'src/pages/privacy/index.html',
	'src/pages/terms/index.html'
];
const functionalClasses = new Set(['stack', 'masked-shape', 'overlay']);

describe('legal pages', () => {
	it('use the shared semantic legal-page stylesheet contract', async () => {
		const stylesheet = await readFile('src/css/pages/legal.scss', 'utf8');
		const internalStyles = await readFile('src/css/internal.scss', 'utf8');

		expect(internalStyles).toContain('@use "pages/legal";');
		expect(stylesheet).toContain('.legal-page');
		expect(stylesheet).toContain('.legal-content');
		expect(stylesheet).toContain('.legal-card');
		expect(stylesheet).toContain('.legal-back-link');
		expect(stylesheet).toContain('.has-background-image .legal-page');
		expect(stylesheet).toContain('.has-background-image .legal-header');
		expect(stylesheet).toContain('calc(var(--menu-opacity) * 100%)');

		for (const page of legalPages) {
			const html = await readFile(page, 'utf8');

			expect(html).toMatch(/<body class="legal-page">/);
			expect(html).toMatch(/<main class="legal-main">/);
			expect(html).toMatch(/<header class="legal-header">/);
			expect(html).toMatch(/<section class="legal-section">/);
			expect(html).toMatch(/<div\s+class="legal-card">/);
			expect(html).toMatch(
				/<h[23] class="legal-(?:heading|subheading)">/
			);
			expect(html).toMatch(/<div class="legal-body">/);
			expect(html).toContain('class="legal-back-link"');

			const classAttributes = [...html.matchAll(/\bclass="([^"]+)"/g)];
			const semanticClasses = new Set<string>();
			for (const [, classes] of classAttributes) {
				for (const className of classes.split(/\s+/)) {
					expect(
						className.startsWith('legal-') ||
							functionalClasses.has(className)
					).toBe(true);
					if (className.startsWith('legal-'))
						semanticClasses.add(className);
				}
			}

			for (const className of semanticClasses) {
				expect(stylesheet).toMatch(
					new RegExp(`\\.${className}(?![a-zA-Z0-9-])`)
				);
			}
		}
	});
});
