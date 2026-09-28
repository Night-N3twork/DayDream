import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { scrubJavaScript } from '../../../../srv/vite/scrub';
import { createArtifactVocabulary } from '../../../../srv/vite/build-config';

// The controller injects a small inline bootstrap into every proxied frame.
// Its first statement removes scripts a previous injection left behind, keyed
// off scramjet's `scramjet-injected` marker attribute. The production build
// runs the vocabulary scrub over the emitted bundle, which rewrites every
// artifact word (here: `scramjet`) to a token that ALWAYS starts with `$`
// (see build-config.ts createArtifactVocabulary). A `$`-prefixed name is an
// invalid CSS identifier, so `querySelectorAll("script[<token>-injected]")`
// throws a SyntaxError in the proxied frame, aborting the whole bootstrap
// before `$scramjetController.load(...)` runs — which is why the rewritten
// page then reports `_ddx$pushsourcemap is not defined`.
//
// This test extracts the actual cleanup statement from source, subjects it to
// the real scrub, and runs it against a document that mirrors what scramjet's
// rewriter emits, proving the cleanup survives the scrub.

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'src', 'index.ts'), 'utf8');

const extractCleanup = (): string => {
	const match = source.match(
		/\/\*__INJECT_CLEANUP_START__\*\/([\s\S]*?)\/\*__INJECT_CLEANUP_END__\*\//,
	);
	if (!match) throw new Error('inject-cleanup markers not found in index.ts');
	return match[1]!.trim();
};

describe('inject-cleanup scrub-safety', () => {
	const vocabulary = createArtifactVocabulary('inject-cleanup-test-seed');
	const token = vocabulary.scramjet!;
	const scrubbedAttr = `${token}-injected`;

	it('the scrub token is a valid CSS/attribute identifier (root-cause guard)', () => {
		// The scrub token for any artifact word must be usable both as a JS
		// identifier AND as a CSS/attribute-name identifier. A `$` (the old
		// scheme) is valid only in JS, which made the CSS attribute selector
		// below throw. It must now be `$`-free and start with a letter/`_`.
		expect(token).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
		expect(() =>
			document.querySelectorAll(`script[${scrubbedAttr}]`),
		).not.toThrow();
	});

	it('scrubbed cleanup removes injected scripts without throwing', () => {
		const cleanup = extractCleanup();
		const scrubbed = scrubJavaScript(cleanup, vocabulary);

		// Sanity: the scrub must have rewritten the marker word.
		expect(scrubbed).not.toContain('scramjet');
		expect(scrubbed).toContain(scrubbedAttr);

		// Reproduce the document shape scramjet's rewriter emits: injected
		// scripts carry the marker attribute (set via HTML parsing, which
		// tolerates `$`-prefixed attribute names), alongside ordinary scripts.
		document.body.innerHTML =
			`<script ${scrubbedAttr}="true" id="injected-a"></script>` +
			`<script id="keep-me"></script>` +
			`<script ${scrubbedAttr}="true" id="injected-b"></script>`;

		// Running the scrubbed cleanup must not throw and must remove only the
		// marked scripts.
		expect(() => {
			// eslint-disable-next-line no-eval
			(0, eval)(scrubbed);
		}).not.toThrow();

		expect(document.getElementById('injected-a')).toBeNull();
		expect(document.getElementById('injected-b')).toBeNull();
		expect(document.getElementById('keep-me')).not.toBeNull();
	});
});
