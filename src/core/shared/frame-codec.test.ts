import { describe, expect, it } from 'vitest';
import { createFrameCodec, type FrameCodecConfig } from './frame-codec';

const frameSpec: FrameCodecConfig = {
	version: 2,
	key: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
	tag: 'deadbeef',
	headerLength: 32,
	nonceLength: 12,
	metadataOffset: 4,
	paddingMinimum: 2,
	paddingMaximum: 10,
	paddingPlacement: 'split',
	keyStride: 3,
	nonceStride: 2
};

describe('frame codec (variable v2)', () => {
	it('round-trips arbitrary payloads', () => {
		const codec = createFrameCodec(frameSpec);
		const inputs = [
			new Uint8Array([1, 2, 3, 4, 5]),
			new Uint8Array(1024).fill(0x42),
			new Uint8Array(65535).map((_, i) => i & 0xff),
			new Uint8Array(0)
		];
		for (const input of inputs) {
			const wrapped = new Uint8Array(codec.encode(input));
			// byte 0 must never be a valid Wisp packet type (1..5)
			expect(wrapped[0] >= 1 && wrapped[0] <= 5).toBe(false);
			const unwrapped = new Uint8Array(codec.decode(wrapped));
			expect(Array.from(unwrapped)).toEqual(Array.from(input));
		}
	});

	it('produces different ciphertext for the same input across calls', () => {
		const codec = createFrameCodec(frameSpec);
		const input = new Uint8Array([0xa, 0xb, 0xc]);
		const a = new Uint8Array(codec.encode(input));
		const b = new Uint8Array(codec.encode(input));
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});

	it('rejects wrong tag', () => {
		const codec = createFrameCodec(frameSpec);
		const bogus = new Uint8Array(64).fill(0);
		expect(() => codec.decode(bogus)).toThrow(/frame/i);
	});

	it('rejects too-short frames', () => {
		const codec = createFrameCodec(frameSpec);
		const tooShort = new Uint8Array(4).fill(0);
		expect(() => codec.decode(tooShort)).toThrow(/frame/i);
	});

	it('rejects invalid config', () => {
		expect(() =>
			createFrameCodec({ ...frameSpec, version: 1 as any })
		).toThrow(/frame codec/i);
		expect(() => createFrameCodec({ ...frameSpec, key: 'zz' })).toThrow(
			/frame codec/i
		);
		expect(() =>
			createFrameCodec({ ...frameSpec, paddingPlacement: 'weird' as any })
		).toThrow(/frame codec/i);
	});
});
