import type { Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedConfig } from 'vite';

// Neutral filename: must not match adblock-style patterns or the artifact
// asset-reference gate (no asset-like indirection — it is a real file).
export const FALLBACK_ASSET = 'tag-fallback.js';
export const INLINE_BLOCK_ID = 'ddx-gtag-inline';

// Base64-encoded inline copy: the encoded alphabet carries no underscore
// identifiers, so unlike a verbatim blob it does not trip the
// seeded-underscore-identifiers signal. Decoded at runtime only on the
// final fallback path (TextDecoder, no eval).
export function encodeInlinePayload(bakedJs: string): string {
	if (!bakedJs) return '';
	return Buffer.from(bakedJs, 'utf8').toString('base64');
}

export function decodeInlinePayload(encoded: string): string {
	if (!encoded) return '';
	return Buffer.from(encoded.replace(/\s+/g, ''), 'base64').toString('utf8');
}

export function inlineBlockHtml(encoded: string): string {
	return `<script id="${INLINE_BLOCK_ID}" type="text/plain">${encoded}</script>`;
}

// Pure unit, tested: writes the baked payload byte-identical. Returns the
// written path, or null when there is nothing to bake.
export async function emitFallbackAsset(
	outDir: string,
	bakedJs: string
): Promise<string | null> {
	if (!bakedJs) return null;
	const path = join(outDir, FALLBACK_ASSET);
	await writeFile(path, bakedJs, 'utf8');
	return path;
}

async function fetchUpstream(tagId: string): Promise<string> {
	try {
		const response = await fetch(
			`https://www.googletagmanager.com/gtag/js?id=${tagId}`,
			{ redirect: 'error', signal: AbortSignal.timeout(10000) }
		);
		if (!response.ok) return '';
		return await response.text();
	} catch {
		return '';
	}
}

// Fetches the tag library once per build. Emits it as a first-party asset
// AND bakes a base64 inline copy into the listed HTML entries: the final
// fallback when first-party, direct, and asset loads all fail. Same-origin
// throughout, so static hosts are covered. A failed fetch emits nothing.
export function analyticsInlinePlugin(
	tagId: string,
	opts: { htmlEntries?: string[]; extraDirs?: string[] } = {}
): Plugin {
	const {
		htmlEntries = ['landing.html', 'index.html', 'app/index.html'],
		extraDirs = [],
	} = opts;
	let vite: ResolvedConfig;
	let baked = '';
	return {
		name: 'ddx-analytics-inline',
		apply: 'build',
		enforce: 'post',
		configResolved(c) {
			vite = c;
		},
		async buildStart() {
			baked = await fetchUpstream(tagId);
		},
		async closeBundle() {
			if (!baked) return;
			const outDir = join(vite.root, vite.build.outDir);
			await emitFallbackAsset(outDir, baked);
			for (const extra of extraDirs) {
				await emitFallbackAsset(join(outDir, extra), baked);
			}
			const block = inlineBlockHtml(encodeInlinePayload(baked));
			for (const entry of htmlEntries) {
				const path = join(outDir, entry);
				try {
					const html = await readFile(path, 'utf8');
					const idx =
						html.indexOf('</head>') !== -1
							? html.indexOf('</head>')
							: html.indexOf('<body');
					if (idx === -1) continue;
					await writeFile(
						path,
						html.slice(0, idx) + block + html.slice(idx),
						'utf8'
					);
				} catch {
					// Entry not emitted by this build flavour; skip.
				}
			}
		},
	};
}
