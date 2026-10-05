import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	decodeInlinePayload,
	emitFallbackAsset,
	encodeInlinePayload,
	FALLBACK_ASSET,
	inlineBlockHtml,
} from './analytics-inline';

const RAW = 'window.gtagLoaded=true;if(a<b){c&&d]]>e}';

describe('encodeInlinePayload', () => {
	it('round-trips arbitrary payload bytes without underscore identifiers', () => {
		const encoded = encodeInlinePayload(RAW);
		expect(encoded).not.toContain('_');
		expect(encoded).not.toMatch(/<\/script/i);
		expect(decodeInlinePayload(encoded)).toBe(RAW);
	});

	it('maps empty input to empty output', () => {
		expect(encodeInlinePayload('')).toBe('');
		expect(decodeInlinePayload('')).toBe('');
	});
});

describe('inlineBlockHtml', () => {
	it('emits a marked inert block carrying the encoded payload', () => {
		const html = inlineBlockHtml('abc123');
		expect(html).toBe(
			'<script id="ddx-gtag-inline" type="text/plain">abc123</script>'
		);
	});
});

describe('emitFallbackAsset', () => {
	it('writes the baked payload byte-identical under a neutral name', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'analytics-inline-'));
		const baked = 'window.gtagLoaded=true;// G-TEST\n';
		const path = await emitFallbackAsset(dir, baked);
		expect(path?.endsWith(FALLBACK_ASSET)).toBe(true);
		expect(await readFile(path!, 'utf8')).toBe(baked);
	});

	it('writes nothing when the baked payload is empty', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'analytics-inline-'));
		expect(await emitFallbackAsset(dir, '')).toBeNull();
	});
});
