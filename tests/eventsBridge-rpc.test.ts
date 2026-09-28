import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RequestResponseChannel } from '@apis/eventsBridge';

/**
 * jsdom doesn't dispatch postMessage cross-window the way browsers do —
 * we synthesize MessageEvents directly to exercise the channel's listener.
 */

const REQ = '__test_req';
const RES = '__test_res';

function makeFakeSource() {
	const calls: Array<{ data: unknown; targetOrigin: unknown }> = [];
	const src = {
		postMessage(data: unknown, targetOrigin?: unknown) {
			calls.push({ data, targetOrigin });
		},
		_calls: calls
	} as unknown as Window & {
		_calls: Array<{ data: unknown; targetOrigin: unknown }>;
	};
	return src;
}

describe('RequestResponseChannel — install / uninstall', () => {
	let channel: RequestResponseChannel;
	beforeEach(() => {
		channel = new RequestResponseChannel({ reqMarker: REQ, resMarker: RES });
	});
	afterEach(() => channel.uninstall());

	it('install is idempotent', () => {
		channel.install();
		channel.install();
		// no throw, no double listener (we can't introspect listener count
		// from jsdom; just verifying no error).
		expect(channel.size()).toBe(0);
	});

	it('registerHandler returns a disposer', () => {
		channel.install();
		const dispose = channel.registerHandler('foo', async () => 'ok');
		expect(channel.size()).toBe(1);
		dispose();
		expect(channel.size()).toBe(0);
	});

	it('re-registering same type replaces handler', () => {
		channel.install();
		channel.registerHandler('foo', async () => 'a');
		channel.registerHandler('foo', async () => 'b');
		expect(channel.size()).toBe(1);
	});
});

describe('RequestResponseChannel — round-trip', () => {
	let channel: RequestResponseChannel;
	beforeEach(() => {
		channel = new RequestResponseChannel({ reqMarker: REQ, resMarker: RES });
	});
	afterEach(() => channel.uninstall());

	it('replies with {ok:true, result} when handler resolves', async () => {
		channel.install();
		channel.registerHandler('echo', async (req) => req.value);

		const source = makeFakeSource();
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { requestId: 'r1', type: 'echo', value: 42 } },
				source
			})
		);

		// Give the async handler a tick to resolve and reply.
		await new Promise((r) => setTimeout(r, 0));

		const calls = (source as unknown as { _calls: Array<{ data: { [k: string]: unknown } }> })._calls;
		expect(calls.length).toBe(1);
		const reply = calls[0]!.data[RES] as { requestId: string; ok: boolean; result: unknown };
		expect(reply.requestId).toBe('r1');
		expect(reply.ok).toBe(true);
		expect(reply.result).toBe(42);
	});

	it('replies with {ok:false, error} when handler throws', async () => {
		channel.install();
		channel.registerHandler('bad', async () => {
			throw new Error('boom');
		});

		const source = makeFakeSource();
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { requestId: 'r2', type: 'bad' } },
				source
			})
		);
		await new Promise((r) => setTimeout(r, 0));

		const calls = (source as unknown as { _calls: Array<{ data: { [k: string]: unknown } }> })._calls;
		expect(calls.length).toBe(1);
		const reply = calls[0]!.data[RES] as { requestId: string; ok: boolean; error: string };
		expect(reply.ok).toBe(false);
		expect(reply.error).toBe('boom');
	});

	it('preserves structured errors when handler throws one', async () => {
		channel.install();
		channel.registerHandler('bad', async () => {
			throw { code: 'handshake_required', message: 'no_session_id' };
		});

		const source = makeFakeSource();
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { requestId: 'r2', type: 'bad' } },
				source
			})
		);
		await new Promise((r) => setTimeout(r, 0));

		const calls = (source as unknown as { _calls: Array<{ data: { [k: string]: unknown } }> })._calls;
		const reply = calls[0]!.data[RES] as { requestId: string; ok: boolean; error: unknown };
		expect(reply.ok).toBe(false);
		expect(reply.error).toEqual({ code: 'handshake_required', message: 'no_session_id' });
	});

	it('replies with no_handler_for_type for unknown type', async () => {
		channel.install();
		const source = makeFakeSource();
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { requestId: 'r3', type: 'never-registered' } },
				source
			})
		);
		await new Promise((r) => setTimeout(r, 0));

		const calls = (source as unknown as { _calls: Array<{ data: { [k: string]: unknown } }> })._calls;
		expect(calls.length).toBe(1);
		const reply = calls[0]!.data[RES] as { requestId: string; ok: boolean; error: string };
		expect(reply.ok).toBe(false);
		expect(reply.error).toBe('no_handler_for_type');
	});

	it('unwraps scramjet $scramjet$messagetype envelope', async () => {
		channel.install();
		channel.registerHandler('echo', async (req) => req.value);

		const source = makeFakeSource();
		// Simulate the wrapper that scramjet's proxied
		// `Window.postMessage` applies: the raw payload gets nested
		// under `$scramjet$data` with sibling sentinel keys. Without
		// the unwrap in `onMessage`, this would never match our marker
		// check and the request would be silently dropped.
		window.dispatchEvent(
			new MessageEvent('message', {
				data: {
					$scramjet$messagetype: 'window',
					$scramjet$origin: 'https://example.com',
					$scramjet$data: {
						[REQ]: { requestId: 'sj1', type: 'echo', value: 'unwrapped' }
					}
				},
				source
			})
		);
		await new Promise((r) => setTimeout(r, 0));

		const calls = (source as unknown as { _calls: Array<{ data: { [k: string]: unknown } }> })._calls;
		expect(calls.length).toBe(1);
		const reply = calls[0]!.data[RES] as {
			requestId: string;
			ok: boolean;
			result: string;
		};
		expect(reply.requestId).toBe('sj1');
		expect(reply.ok).toBe(true);
		expect(reply.result).toBe('unwrapped');
	});

	it('ignores messages from the host (event.source === window)', async () => {
		channel.install();
		let called = false;
		channel.registerHandler('selfspoof', async () => {
			called = true;
			return 'pwned';
		});

		// Synthesize a message whose source is `window` itself.
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { requestId: 'r4', type: 'selfspoof' } },
				source: window
			})
		);
		await new Promise((r) => setTimeout(r, 0));
		expect(called).toBe(false);
	});

	it('ignores malformed messages', async () => {
		channel.install();
		let called = false;
		channel.registerHandler('x', async () => {
			called = true;
			return null;
		});

		const source = makeFakeSource();
		// missing reqMarker
		window.dispatchEvent(new MessageEvent('message', { data: { wrong: {} }, source }));
		// reqMarker but no requestId
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { type: 'x' } },
				source
			})
		);
		// reqMarker but no type
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { requestId: 'x' } },
				source
			})
		);
		// data is not an object
		window.dispatchEvent(new MessageEvent('message', { data: 'string', source }));
		await new Promise((r) => setTimeout(r, 0));

		expect(called).toBe(false);
		expect(
			(source as unknown as { _calls: unknown[] })._calls.length
		).toBe(0);
	});

	it('disposer leaves channel installed but removes that handler', async () => {
		channel.install();
		const dispose = channel.registerHandler('echo', async () => 'first');
		channel.registerHandler('echo2', async () => 'second');
		dispose();

		const source = makeFakeSource();
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { [REQ]: { requestId: 'r', type: 'echo' } },
				source
			})
		);
		await new Promise((r) => setTimeout(r, 0));

		const calls = (source as unknown as { _calls: Array<{ data: { [k: string]: unknown } }> })._calls;
		expect(calls.length).toBe(1);
		const reply = calls[0]!.data[RES] as { ok: boolean; error: string };
		expect(reply.ok).toBe(false);
		expect(reply.error).toBe('no_handler_for_type');
	});
});
