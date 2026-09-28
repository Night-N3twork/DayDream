// buildConfig import removed with the encoded route — plain /wisp/ only.

interface WispSettings {
	getItem<T>(key: string): Promise<T | null>;
	setItem<T>(key: string, value: T): Promise<T>;
}

class WispManager {
	private readonly settingsStore: WispSettings;
	private wispReady = false;

	constructor(settingsStore: WispSettings) {
		this.settingsStore = settingsStore;
	}

	generateRandomString(): string {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		const length = 16 + Math.floor(Math.random() * 17);
		let result = '';
		for (let i = 0; i < length; i++) {
			result += chars[Math.floor(Math.random() * chars.length)];
		}
		return result;
	}

	// encodedPath() removed with the encoded/framed route disable; kept
	// as a comment so re-enabling is a two-line diff.

	private canConnect(url: string): Promise<boolean> {
		return new Promise(resolve => {
			let done = false;
			const finish = (ok: boolean) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				try {
					ws.close();
				} catch {
					/* ignore */
				}
				resolve(ok);
			};
			const ws = new WebSocket(url);
			const timer = setTimeout(() => finish(false), 5000);
			ws.addEventListener('open', () => finish(true));
			ws.addEventListener('error', () => finish(false));
		});
	}

	/**
	 * Probe the server for a working WISP endpoint. Encoded/framed route is
	 * currently disabled (per operator request); we only try plain `/wisp/`
	 * so failures propagate quickly instead of spamming setTransports().
	 */
	async probeServer(): Promise<{ url: string; encoded: boolean } | null> {
		const proto = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${self.location.host}/wisp/`;
		if (await this.canConnect(url)) {
			console.log(`[DDXWorker] Server /wisp/ endpoint found at ${url}`);
			return { url, encoded: false };
		}
		console.log('[DDXWorker] Server /wisp/ endpoint not available');
		return null;
	}

	/**
	 * @deprecated Use `probeServer()` — this method exists only for backward
	 * compatibility with callers that just want a boolean plain-endpoint check.
	 */
	checkServerWisp(): Promise<boolean> {
		const proto = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${self.location.host}/wisp/`;
		return this.canConnect(url).then(ok => {
			if (ok) {
				console.log(
					`[DDXWorker] Server /wisp/ endpoint found at ${url}`
				);
			} else {
				console.log('[DDXWorker] Server /wisp/ endpoint not available');
			}
			return ok;
		});
	}

	async ensureWisp(): Promise<boolean> {
		if (this.wispReady) return true;

		try {
			// Terbium TAPP: src/terbium/boot.ts posts `ddx:wisp-override`
			// to the SW. The message handler in sw/index.ts caches the URL
			// on `self.__ddxOverrideWisp`. Honor it before consulting
			// settings — Terbium's Wisp takes precedence.
			const override = (self as any).__ddxOverrideWisp;
			if (typeof override === 'string' && override.length > 0) {
				await this.settingsStore.setItem('wisp', override);
				await this.settingsStore.setItem('wisp:encoded', false);
				console.log(
					`[DDXWorker] Using Terbium-provided WISP: ${override}`
				);
				this.wispReady = true;
				return true;
			}

			let wispUrl = await this.settingsStore.getItem<string>('wisp');
			console.log(`[DDXWorker] ensureWisp: current value = ${wispUrl}`);

			// If the saved value is a same-origin URL that is NOT `/wisp/`,
			// it's a stale encoded route from a previous build (encoded
			// route disabled). Discard so we re-probe below.
			if (wispUrl) {
				try {
					const parsed = new URL(wispUrl);
					const sameOrigin = parsed.host === self.location.host;
					if (sameOrigin && parsed.pathname !== '/wisp/') {
						console.log(
							`[DDXWorker] Discarding stale encoded WISP: ${wispUrl}`
						);
						wispUrl = null;
					}
				} catch {
					wispUrl = null;
				}
			}

			if (!wispUrl) {
				const probe = await this.probeServer();

				if (probe) {
					wispUrl = probe.url;
					await this.settingsStore.setItem('wisp', wispUrl);
					await this.settingsStore.setItem(
						'wisp:encoded',
						probe.encoded
					);
					console.log(
						`[DDXWorker] Using ${probe.encoded ? 'encoded' : 'plain'} WISP endpoint: ${wispUrl}`
					);
				} else {
					const subdomain = this.generateRandomString();
					wispUrl = `wss://${subdomain}.nightwisp.me.cdn.cloudflare.net/wisp/`;
					await this.settingsStore.setItem('wisp', wispUrl);
					await this.settingsStore.setItem('wisp:encoded', false);
					console.log(
						`[DDXWorker] Generated WISP server: ${wispUrl}`
					);
				}
			}

			this.wispReady = true;
			return true;
		} catch (err) {
			console.error('[DDXWorker] ensureWisp failed:', err);
			return false;
		}
	}

	/**
	 * Synchronously synthesises a fallback WISP URL without touching
	 * settings or the network. Used by the shared transport module as a
	 * `defaultWisp` provider when the `wisp` setting is missing — this
	 * avoids re-running the full `ensureWisp` probe on every fetch.
	 *
	 * Returns the encoded build-config-derived same-origin URL — the plain
	 * `/wisp/` endpoint is only used when the server also serves it and
	 * `probeServer()` has previously verified it.
	 */
	computeWispUrl(): string {
		const proto = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${self.location.host}/wisp/`;
	}
}

export { WispManager };
