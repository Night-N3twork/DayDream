/**
 * Cross-frame events bridge for scramjet-proxied iframes.
 *
 * Two distinct primitives live in this file:
 *
 *  1. **Host→page broadcast** (the original): `installEventsBridge`,
 *     `postEventToIframe`, `sendToProxiedFrame`. Fire-and-forget,
 *     re-dispatches as `CustomEvent` inside the proxied document. No
 *     request/response correlation.
 *
 *  2. **Page→host RPC** (`RequestResponseChannel` — added later):
 *     proxied page calls `window.parent.postMessage({ [reqMarker]:
 *     {requestId, type, ...payload} })`, host bridge runs the
 *     registered handler for `type` and replies via
 *     `event.source.postMessage({ [resMarker]: {requestId, ok, result|error} })`.
 *     Used by the captcha plugin (see `src/apis/captcha/`) and any
 *     future feature that needs a page-initiated query.
 *
 * Why this exists
 * ---------------
 * `EventSystem.emit` in `src/apis/events.ts` broadcasts each event to every
 * iframe via `iframe.contentWindow.postMessage(message, "*")`. For our
 * internal `ddx://` pages (settings, newtab, error) this works directly —
 * they aren't routed through scramjet's service worker.
 *
 * For scramjet-proxied iframes the situation is different: scramjet has
 * trapped `Window.prototype.postMessage` inside the proxied window. Its
 * wrapper expects every outgoing message to be re-wrapped in the envelope
 * `{$scramjet$messagetype, $scramjet$origin, $scramjet$data}`. When the
 * host calls `iframe.contentWindow.postMessage(raw)`, the wrapper tries to
 * read `e.url.origin` from its own (scramjet-internal) client context.
 * That context is host-side and has no URL, so the wrapper crashes with
 * `Cannot read properties of undefined (reading 'url')`.
 *
 * Even if the wrapper succeeded, the receiving proxied page would see the
 * scramjet envelope, not our raw payload, so any in-iframe receiver would
 * never match on `event.data.eventName`.
 *
 * This module solves both halves of the problem:
 *
 *   1. `sendToProxiedFrame(iframe, message)` — wrap our payload in the
 *      scramjet envelope before posting, satisfying the wrapper contract
 *      and ensuring the message arrives intact on the proxied side.
 *
 *   2. `installEventsBridge(controller)` — tap scramjet's per-frame
 *      `init.post` hook. For every newly initialised proxied frame,
 *      attach a host-context `message` listener on its proxied window that
 *      unwraps our payload and re-dispatches it as a `CustomEvent` on the
 *      proxied document. Proxied pages opt in by doing
 *      `document.addEventListener('ddx:foo', ...)` — the same API surface
 *      our internal pages already use.
 *
 * Public API stays inside `EventSystem` (`eventsAPI.emit/addEventListener`).
 * Callers don't need to know whether their target is proxied or not.
 */

const HOST_SENDER_TAG = '__ddxHostBridge';

/**
 * Build the scramjet-envelope-wrapped form of one of our event payloads.
 * The proxied window's scramjet `postMessage` wrapper unpacks any message
 * shaped this way and delivers `$scramjet$data` as the visible `event.data`.
 */
export function wrapForProxiedFrame(message: unknown): Record<string, unknown> {
	return {
		$scramjet$messagetype: 'window',
		$scramjet$origin: location.origin,
		$scramjet$data: {
			...((typeof message === 'object' && message !== null
				? (message as Record<string, unknown>)
				: { value: message }) as Record<string, unknown>),
			[HOST_SENDER_TAG]: true
		}
	};
}

/**
 * Membership test: is this iframe element registered as a scramjet
 * proxy frame? Read-only against `controller.frames`; safe to call
 * with a null/undefined controller (returns false).
 */
export function isProxiedIframe(
	iframe: HTMLIFrameElement,
	controller: any
): boolean {
	if (!controller || !Array.isArray(controller.frames)) return false;
	return controller.frames.some((f: any) => f?.element === iframe);
}

/**
 * Safe postMessage to one iframe. Picks the right delivery path based on
 * whether the iframe is scramjet-proxied. All errors are swallowed — a
 * single misbehaving iframe (mid-navigation, detached, cross-origin
 * reflinkage) must not break the rest of the broadcast.
 */
export function postEventToIframe(
	iframe: HTMLIFrameElement,
	message: unknown,
	controller: any
): void {
	const target = iframe.contentWindow;
	if (!target) return;

	try {
		if (isProxiedIframe(iframe, controller)) {
			target.postMessage(wrapForProxiedFrame(message), '*');
		} else {
			target.postMessage(message, '*');
		}
	} catch (error) {
		console.warn(
			'[eventsBridge] postMessage to iframe failed (continuing):',
			error
		);
	}
}

/**
 * Receiver script installed inside every proxied window via the
 * `init.post` hook. Listens for our host-tagged payloads, strips
 * the sender tag, and re-emits as a `CustomEvent` on the proxied
 * document. Proxied pages consume with `document.addEventListener`.
 *
 * Runs from the host context but bound to the proxied window — exactly
 * the right scope for receiving messages targeted at that window.
 */
function attachProxiedReceiver(proxiedWindow: Window): void {
	const handler = (event: MessageEvent) => {
		const data = event?.data as Record<string, unknown> | null | undefined;
		if (!data || typeof data !== 'object') return;
		if (!data[HOST_SENDER_TAG]) return;

		const eventName = data['eventName'];
		if (typeof eventName !== 'string' || !eventName) return;

		const payload = data['data'];

		try {
			const doc = proxiedWindow.document;
			if (!doc) return;
			doc.dispatchEvent(
				new CustomEvent(eventName, { detail: payload ?? {} })
			);
		} catch (error) {
			console.warn(
				'[eventsBridge] receiver dispatch failed (continuing):',
				error
			);
		}
	};

	try {
		proxiedWindow.addEventListener('message', handler);
	} catch (error) {
		console.warn(
			'[eventsBridge] failed to attach proxied receiver:',
			error
		);
	}
}

/**
 * Install the per-frame init hook that wires the receiver into every
 * scramjet-proxied frame as it boots. Call once after the scramjet
 * controller is ready. Idempotent — re-invocation is a no-op.
 *
 * We accept `controller` as `any` because the scramjet-controller types
 * pin `hooks.init` to scramjet's internal `TapInstance` shape;
 * accessing it positionally avoids leaking that surface into our code.
 */
let installed = false;
export function installEventsBridge(controller: any): void {
	if (installed) return;
	if (!controller) {
		console.warn(
			'[eventsBridge] install called with no controller; skipping'
		);
		return;
	}

	const scramjet = (window as any).$scramjet;
	if (!scramjet?.Plugin) {
		console.warn(
			'[eventsBridge] $scramjet.Plugin unavailable; receiver not installed'
		);
		return;
	}

	const installOnFrame = (frame: any) => {
		try {
			const postHook = frame?.hooks?.init?.post;
			if (!postHook) return;
			const plugin = new scramjet.Plugin('ddx-events-bridge');
			plugin.tap(postHook, (context: any) => {
				const win = context?.window as Window | undefined;
				if (win) attachProxiedReceiver(win);
			});
		} catch (error) {
			console.warn(
				'[eventsBridge] failed to tap init on frame:',
				error
			);
		}
	};

	if (Array.isArray(controller.frames)) {
		for (const frame of controller.frames) installOnFrame(frame);
	}

	const originalCreateFrame = controller.createFrame?.bind(controller);
	if (typeof originalCreateFrame === 'function') {
		controller.createFrame = (...args: any[]) => {
			const frame = originalCreateFrame(...args);
			if (frame) installOnFrame(frame);
			return frame;
		};
	}

	installed = true;
}

// ============================================================================
// Page→host RPC primitive — RequestResponseChannel
// ============================================================================

/**
 * Page→host request/response channel built on `window.postMessage`.
 *
 * Usage (host side):
 * ```ts
 * const channel = new RequestResponseChannel({
 *   reqMarker: '__ddx_captcha_req',
 *   resMarker: '__ddx_captcha_res',
 * });
 * channel.registerHandler('turnstile', async (req, source) => {
 *   // do work, return result (any JSON-serializable)
 *   return 'token-string';
 * });
 * channel.install();
 * ```
 *
 * Usage (page side — typically inside a script injected via
 * `scriptInjectionRegistry`, see `src/apis/captcha/hook.runtime.js` for a
 * working example):
 * ```js
 * window.parent.postMessage({
 *   __ddx_captcha_req: { requestId: 'abc', type: 'turnstile', sitekey: '...', ... }
 * }, '*');
 * window.addEventListener('message', (e) => {
 *   const r = e?.data?.__ddx_captcha_res;
 *   if (r && r.requestId === 'abc') { ... }
 * });
 * ```
 *
 * Wire protocol
 * -------------
 * - **Request** (page→host):
 *   `{ [reqMarker]: { requestId: string, type: string, ...payload } }`
 *   `requestId` is a page-generated unique-per-message ID. `type` is the
 *   handler key the host registered. Everything else in the envelope is
 *   forwarded to the handler as the `req` argument.
 * - **Response** (host→page, via `event.source.postMessage(..., '*')`):
 *   - success: `{ [resMarker]: { requestId, ok: true, result } }`
 *   - failure: `{ [resMarker]: { requestId, ok: false, error: string | { code, message } } }`
 *     Ordinary errors are strings; errors with string `code` and `message`
 *     fields preserve that structured shape.
 *
 * Security
 * --------
 * - The channel rejects messages whose `event.source === window` (i.e.
 *   messages the host page is posting to itself). This prevents code
 *   running in the host context from spoofing a request that should
 *   only come from a proxied iframe. There is no `event.origin` check
 *   because all proxied frames share `location.origin` with the host
 *   under scramjet's prefix-based URL scheme.
 * - Handlers MUST NOT trust the request payload for any
 *   authority-bearing decision without re-validating (e.g. a captcha
 *   solve request says "type: turnstile, sitekey: X" — the host MUST
 *   re-derive sensitive context like Night+ status itself, not trust
 *   anything in the request).
 *
 * Timeouts
 * --------
 * The channel does NOT enforce a per-request timeout on the host side.
 * If a handler hangs, the page's `requestId` entry will never be
 * resolved. Pages MAY implement their own per-request timeout (the
 * captcha hook does not — it lets the page's own captcha-widget UX
 * decide what to do with a hung promise).
 */
/**
 * How `RequestResponseChannel` delivers the reply payload back to the
 * iframe that sent the request. Two reasons callers may want to override
 * this:
 *
 *   1. The default `event.source.postMessage(...)` traverses scramjet's
 *      wrapped `Window.postMessage` trap on the proxied window. On some
 *      pages (notably dash.cloudflare.com), that trap throws inside
 *      scramjet's bundle: `Cannot read properties of undefined
 *      (reading 'url')`. The reply never lands.
 *   2. Callers that already know about the proxy controller can route
 *      replies via `iframe.contentWindow.postMessage` of the host-owned
 *      iframe, optionally via scramjet's envelope-wrap path
 *      (`postEventToIframe` in this file). That path is robust to the
 *      wrapper's quirks because the cross-frame boundary is traversed
 *      the way scramjet expects.
 *
 * The transport receives the same `event.source` we got from the
 * inbound message and the already-wrapped `{ [resMarker]: { ... } }`
 * envelope, and is responsible for any fallback semantics (logging,
 * silent drop, etc).
 */
export type ReplyTransport = (
	source: MessageEventSource | null,
	wrapped: Record<string, unknown>
) => void;

export interface RequestResponseChannelOptions {
	/** Envelope key for incoming requests, e.g. `'__ddx_captcha_req'`. */
	reqMarker: string;
	/** Envelope key for outgoing responses, e.g. `'__ddx_captcha_res'`. */
	resMarker: string;
	/**
	 * Optional override for how replies are delivered to the page.
	 * Defaults to a direct `event.source.postMessage(wrapped, '*')`,
	 * which is correct for non-proxied iframes but can fail on some
	 * scramjet-proxied frames — see `ReplyTransport` jsdoc.
	 */
	replyTransport?: ReplyTransport;
}

export type RequestHandler = (
	req: Record<string, unknown>,
	source: MessageEventSource | null
) => Promise<unknown> | unknown;

export class RequestResponseChannel {
	private opts: RequestResponseChannelOptions;
	private handlers = new Map<string, RequestHandler>();
	private listening = false;
	private listener: ((e: MessageEvent) => void) | null = null;

	constructor(opts: RequestResponseChannelOptions) {
		this.opts = opts;
	}

	/**
	 * Register a handler for one request `type`. Returns a disposer that
	 * unregisters JUST this handler (the channel itself stays installed).
	 * Re-registering the same type replaces the handler.
	 */
	registerHandler(type: string, handler: RequestHandler): () => void {
		this.handlers.set(type, handler);
		return () => {
			if (this.handlers.get(type) === handler) {
				this.handlers.delete(type);
			}
		};
	}

	/** Mount the global `message` listener. Idempotent. */
	install(): void {
		if (this.listening) return;
		this.listener = (event: MessageEvent) => {
			void this.onMessage(event);
		};
		window.addEventListener('message', this.listener);
		this.listening = true;
	}

	/** Explicit teardown — primarily for tests. */
	uninstall(): void {
		if (!this.listening || !this.listener) return;
		window.removeEventListener('message', this.listener);
		this.listening = false;
		this.listener = null;
	}

	/** Number of registered handlers — diagnostic only. */
	size(): number {
		return this.handlers.size;
	}

	private async onMessage(event: MessageEvent): Promise<void> {
		// Ignore messages posted by the host to itself. Without this,
		// any code running on the host page could spoof a request.
		if (event.source === window) return;

		// Unwrap scramjet's `$scramjet$messagetype` envelope if present.
		// When a proxied page calls `window.parent.postMessage(...)`,
		// scramjet's `Window.postMessage` proxy in the proxied realm
		// wraps the message into `{$scramjet$messagetype, $scramjet$origin,
		// $scramjet$data}` before posting. The host therefore sees the
		// wrapped form, not the raw payload. We unwrap if we see the
		// sentinel; otherwise the message is from a non-proxied source
		// (internal pages, host code, tests) and we use it as-is.
		const raw = event?.data as Record<string, unknown> | null | undefined;
		if (!raw || typeof raw !== 'object') return;
		const data =
			'$scramjet$messagetype' in raw &&
			raw.$scramjet$data &&
			typeof raw.$scramjet$data === 'object'
				? (raw.$scramjet$data as Record<string, unknown>)
				: raw;

		const envelope = data[this.opts.reqMarker] as
			| Record<string, unknown>
			| undefined;
		if (!envelope || typeof envelope !== 'object') return;

		const requestId = envelope.requestId as string | undefined;
		const type = envelope.type as string | undefined;
		if (typeof requestId !== 'string' || typeof type !== 'string') return;

		const handler = this.handlers.get(type);
		if (!handler) {
			try {
				console.warn(
					`[RequestResponseChannel ${this.opts.reqMarker}] no handler registered for type "${type}" — known types: [${[...this.handlers.keys()].join(', ')}]`
				);
			} catch {}
			this.reply(event.source, {
				requestId,
				ok: false,
				error: 'no_handler_for_type'
			});
			return;
		}

		try {
			const result = await handler(envelope, event.source);
			this.reply(event.source, { requestId, ok: true, result });
		} catch (err) {
			if (
				err &&
				typeof err === 'object' &&
				'code' in err &&
				'message' in err &&
				typeof err.code === 'string' &&
				typeof err.message === 'string'
			) {
				this.reply(event.source, {
					requestId,
					ok: false,
					error: { code: err.code, message: err.message }
				});
				return;
			}
			const message = err instanceof Error ? err.message : String(err ?? 'unknown_error');
			this.reply(event.source, { requestId, ok: false, error: message });
		}
	}

	private reply(
		source: MessageEventSource | null,
		payload: Record<string, unknown>
	): void {
		if (!source) return;
		const wrapped = { [this.opts.resMarker]: payload };
		const transport = this.opts.replyTransport ?? defaultReplyTransport;
		try {
			transport(source, wrapped);
		} catch (err) {
			console.warn(
				`[RequestResponseChannel ${this.opts.reqMarker}] reply failed:`,
				err
			);
		}
	}
}

function defaultReplyTransport(
	source: MessageEventSource | null,
	wrapped: Record<string, unknown>
): void {
	if (!source) return;
	// MessageEventSource is a union (Window | MessagePort | ServiceWorker).
	// We're always replying to a Window in practice (iframes), so cast
	// and pass '*' targetOrigin. May throw inside scramjet's wrapper on
	// proxied pages — callers that need robustness should provide a
	// custom `replyTransport` (see CaptchaBridge for the canonical
	// example).
	(source as Window).postMessage(wrapped, '*');
}
