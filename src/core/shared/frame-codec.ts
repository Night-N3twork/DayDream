/**
 * Frame codec — direct port of `Starlight/src/frame-codec.ts`.
 *
 * This module implements the client/server shared framing algorithm used to
 * obfuscate the WebSocket binary payloads shuttled between the DDX proxy
 * client and the server. It supports two configurations:
 *
 *   - Legacy: a single-byte marker + short nonce + XOR key stream. Selected
 *     when `createFrameCodec(marker, keyHex)` is called with a numeric marker.
 *   - Variable v2: header/nonce/padding/tag configuration driven entirely by
 *     `FrameCodecConfig`. Selected when `createFrameCodec(config)` is called
 *     with a config object.
 *
 * Both variants rely only on `Uint8Array` and `crypto.getRandomValues`, which
 * are available in modern browsers, Node 19+, and Bun — a single module
 * therefore serves both client and server.
 *
 * Reference: `Starlight/src/frame-codec.ts`.
 */

type FrameCodec = {
	encode(value: ArrayBuffer | ArrayBufferView): ArrayBuffer;
	decode(value: ArrayBuffer | ArrayBufferView): ArrayBuffer;
};

export type FrameCodecConfig = {
	version: 2;
	key: string;
	tag: string;
	headerLength: number;
	nonceLength: number;
	metadataOffset: number;
	paddingMinimum: number;
	paddingMaximum: number;
	paddingPlacement: 'prefix' | 'suffix' | 'split';
	keyStride: number;
	nonceStride: number;
};

const toBytes = (value: ArrayBuffer | ArrayBufferView) => {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	throw new TypeError('Expected a binary WebSocket frame');
};

const decodeHex = (value: string) => {
	if (!/^(?:[\da-f]{2})+$/i.test(value)) return new Uint8Array();
	return Uint8Array.from(value.match(/../g) || [], byte =>
		Number.parseInt(byte, 16)
	);
};

const fillRandom = (value: Uint8Array) => {
	for (let offset = 0; offset < value.length; offset += 65_536) {
		crypto.getRandomValues(value.subarray(offset, offset + 65_536));
	}
	return value;
};

const createLegacyFrameCodec = (marker: number, keyHex: string): FrameCodec => {
	const key = Uint8Array.from(keyHex.match(/../g) || [], value =>
		Number.parseInt(value, 16)
	);
	if (marker < 6 || marker > 255 || key.length < 16) {
		throw new Error('Invalid frame codec configuration');
	}

	return {
		encode(value) {
			const input = toBytes(value);
			const nonce = new Uint8Array(4);
			crypto.getRandomValues(nonce);
			const output = new Uint8Array(input.length + 5);
			output[0] = marker;
			output.set(nonce, 1);
			for (let index = 0; index < input.length; index++) {
				output[index + 5] =
					input[index] ^
					key[(index + nonce[index % nonce.length]) % key.length] ^
					nonce[index % nonce.length];
			}
			return output.buffer;
		},
		decode(value) {
			const input = toBytes(value);
			if (input.length < 5 || input[0] !== marker) {
				throw new Error('Invalid binary WebSocket frame');
			}
			const nonce = input.subarray(1, 5);
			const output = new Uint8Array(input.length - 5);
			for (let index = 0; index < output.length; index++) {
				output[index] =
					input[index + 5] ^
					key[(index + nonce[index % nonce.length]) % key.length] ^
					nonce[index % nonce.length];
			}
			return output.buffer;
		}
	};
};

const createVariableFrameCodec = (config: FrameCodecConfig): FrameCodec => {
	const key = decodeHex(config.key);
	const tag = decodeHex(config.tag);
	const metadataLength = config.nonceLength + 2 + tag.length;
	const integers = [
		config.headerLength,
		config.nonceLength,
		config.metadataOffset,
		config.paddingMinimum,
		config.paddingMaximum,
		config.keyStride,
		config.nonceStride
	];
	if (
		config.version !== 2 ||
		integers.some(value => !Number.isSafeInteger(value)) ||
		key.length < 24 ||
		tag.length !== 4 ||
		config.nonceLength < 8 ||
		config.nonceLength > 16 ||
		config.headerLength < config.nonceLength + 12 ||
		config.metadataOffset < 1 ||
		config.metadataOffset + metadataLength > config.headerLength ||
		config.paddingMinimum < 0 ||
		config.paddingMaximum < config.paddingMinimum ||
		config.paddingMaximum > 63 ||
		!['prefix', 'suffix', 'split'].includes(config.paddingPlacement) ||
		config.keyStride < 1 ||
		config.nonceStride < 1
	) {
		throw new Error('Invalid variable frame codec configuration');
	}

	const nonceOffset = config.metadataOffset;
	const paddingOffset = nonceOffset + config.nonceLength;
	const prefixOffset = paddingOffset + 1;
	const tagOffset = prefixOffset + 1;
	const mask = (index: number, nonce: Uint8Array) =>
		key[
			(index * config.keyStride + nonce[index % nonce.length]) %
				key.length
		] ^ nonce[(index * config.nonceStride) % nonce.length];

	return {
		encode(value) {
			const input = toBytes(value);
			const random = new Uint8Array(2);
			crypto.getRandomValues(random);
			const paddingRange =
				config.paddingMaximum - config.paddingMinimum + 1;
			const padding = config.paddingMinimum + (random[0] % paddingRange);
			const prefixPadding =
				config.paddingPlacement === 'prefix'
					? padding
					: config.paddingPlacement === 'suffix'
						? 0
						: random[1] % (padding + 1);
			const output = new Uint8Array(
				config.headerLength + padding + input.length
			);
			fillRandom(output);
			while (output[0] >= 1 && output[0] <= 5) {
				crypto.getRandomValues(output.subarray(0, 1));
			}

			const nonce = output.subarray(
				nonceOffset,
				nonceOffset + config.nonceLength
			);
			output[paddingOffset] = padding ^ mask(0, nonce);
			output[prefixOffset] = prefixPadding ^ mask(1, nonce);
			for (let index = 0; index < tag.length; index++) {
				output[tagOffset + index] = tag[index] ^ mask(index + 2, nonce);
			}

			const payloadOffset = config.headerLength + prefixPadding;
			for (let index = 0; index < input.length; index++) {
				output[payloadOffset + index] =
					input[index] ^ mask(index + 6, nonce);
			}
			return output.buffer;
		},
		decode(value) {
			const input = toBytes(value);
			if (input.length < config.headerLength + config.paddingMinimum) {
				throw new Error('Invalid binary WebSocket frame');
			}
			const nonce = input.subarray(
				nonceOffset,
				nonceOffset + config.nonceLength
			);
			const padding = input[paddingOffset] ^ mask(0, nonce);
			const prefixPadding = input[prefixOffset] ^ mask(1, nonce);
			if (
				padding < config.paddingMinimum ||
				padding > config.paddingMaximum ||
				prefixPadding > padding ||
				(config.paddingPlacement === 'prefix' &&
					prefixPadding !== padding) ||
				(config.paddingPlacement === 'suffix' && prefixPadding !== 0) ||
				input.length < config.headerLength + padding
			) {
				throw new Error('Invalid binary WebSocket frame');
			}
			for (let index = 0; index < tag.length; index++) {
				if (
					(input[tagOffset + index] ^ mask(index + 2, nonce)) !==
					tag[index]
				) {
					throw new Error('Invalid binary WebSocket frame');
				}
			}

			const output = new Uint8Array(
				input.length - config.headerLength - padding
			);
			const payloadOffset = config.headerLength + prefixPadding;
			for (let index = 0; index < output.length; index++) {
				output[index] =
					input[payloadOffset + index] ^ mask(index + 6, nonce);
			}
			return output.buffer;
		}
	};
};

export const createFrameCodec = (
	configOrMarker: FrameCodecConfig | number,
	legacyKey?: string
): FrameCodec =>
	typeof configOrMarker === 'number'
		? createLegacyFrameCodec(configOrMarker, legacyKey || '')
		: createVariableFrameCodec(configOrMarker);

export const wrapWebSocket = (socket: any, codec: FrameCodec) => {
	const messageListeners = new Map<any, any>();
	let onmessage: any = null;
	let wrappedOnmessage: any = null;
	let wrappedSocket: any;

	const wrapEvent = (event: any) =>
		new Proxy(event, {
			get(target, property) {
				if (property === 'data') return codec.decode(target.data);
				const value = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
	const wrapListener = (listener: any) => (event: any) => {
		const wrappedEvent = wrapEvent(event);
		if (typeof listener === 'function') {
			Reflect.apply(listener, wrappedSocket, [wrappedEvent]);
		} else {
			Reflect.apply(listener.handleEvent, listener, [wrappedEvent]);
		}
	};

	wrappedSocket = new Proxy(socket, {
		get(target, property) {
			switch (property) {
				case 'send':
					return (value: any, ...args: any[]) =>
						target.send(codec.encode(value), ...args);
				case 'addEventListener':
					return (type: any, listener: any, options: any) => {
						if (type !== 'message' || !listener) {
							return target.addEventListener(
								type,
								listener,
								options
							);
						}
						const wrapped = wrapListener(listener);
						messageListeners.set(listener, wrapped);
						return target.addEventListener(type, wrapped, options);
					};
				case 'removeEventListener':
					return (type: any, listener: any, options: any) => {
						const wrapped =
							type === 'message'
								? messageListeners.get(listener) || listener
								: listener;
						messageListeners.delete(listener);
						return target.removeEventListener(
							type,
							wrapped,
							options
						);
					};
				case 'onmessage':
					return onmessage;
				default: {
					const value = Reflect.get(target, property, target);
					return typeof value === 'function'
						? value.bind(target)
						: value;
				}
			}
		},
		set(target, property, value) {
			if (property !== 'onmessage') {
				return Reflect.set(target, property, value, target);
			}
			onmessage = value;
			wrappedOnmessage = value ? wrapListener(value) : null;
			target.onmessage = wrappedOnmessage;
			return true;
		}
	});

	return wrappedSocket;
};

export const installWebSocketCodec = (
	endpoint: string | ((url: string) => boolean),
	codec: FrameCodec
) => {
	const NativeWebSocket = globalThis.WebSocket;
	const shouldWrap =
		typeof endpoint === 'function'
			? endpoint
			: (url: string) => url === endpoint;
	const FramedWebSocket = new Proxy(NativeWebSocket, {
		construct(target, args) {
			const socket = Reflect.construct(target, args, target);
			const url = new URL(args[0], location.href).href;
			return shouldWrap(url) ? wrapWebSocket(socket, codec) : socket;
		}
	});
	globalThis.WebSocket = FramedWebSocket;
	return () => {
		if (globalThis.WebSocket === FramedWebSocket) {
			globalThis.WebSocket = NativeWebSocket;
		}
	};
};
