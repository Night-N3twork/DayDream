/**
 * Daydream → Terbium boot module.
 *
 * Runs as the first script in <head> when built with `--mode tapp`.
 * Detects parent.window.tb, resolves Terbium's Wisp URL, and primes
 * Daydream's settings so the page-side Proxy and the SW-side WispManager
 * both pick up the Terbium-shared Wisp without further code changes.
 *
 * Standalone behavior (no parent.tb): everything no-ops, Daydream runs
 * exactly as it would without this module.
 */

const TAG = '[terbium]';

export interface ParentBridge {
  tb: any;
  wispUrl: string | null;
}

/**
 * Walk the fallback chain to find Terbium's Wisp URL on the parent window.
 *
 * Order:
 *   1. parent.$scramjet.config.wisp        (likely path in Terbium v2)
 *   2. parent.tb._sj.config.wisp           (Terbium's internal SJ handle)
 *   3. parent.tb.proxy.wispUrl             (undocumented but plausible)
 *   4. wss://{parent.host}/wisp/           (same-origin guess)
 *   5. null                                (let Daydream's own fallback run)
 */
export function resolveParentWisp(parentWin: any, tb: any): string | null {
  try {
    const sjWisp = parentWin?.$scramjet?.config?.wisp;
    if (typeof sjWisp === 'string' && sjWisp.length > 0) return sjWisp;

    const tbSjWisp = tb?._sj?.config?.wisp;
    if (typeof tbSjWisp === 'string' && tbSjWisp.length > 0) return tbSjWisp;

    const proxyWisp = tb?.proxy?.wispUrl;
    if (typeof proxyWisp === 'string' && proxyWisp.length > 0) return proxyWisp;

    const host = parentWin?.location?.host;
    const protocol = parentWin?.location?.protocol;
    if (typeof host !== 'string' || !host) return null;
    const proto = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${host}/wisp/`;
  } catch {
    return null;
  }
}

/**
 * Detect whether we're running inside Terbium.
 *
 * Returns the bridge object if `window.parent.tb` exists and is accessible,
 * else null. Safe to call from any context — never throws.
 */
export function detectParent(win: any = (typeof window !== 'undefined' ? window : undefined)): ParentBridge | null {
  if (!win) return null;
  try {
    const p = win.parent;
    if (!p || p === win) return null;
    const tb = p.tb;
    if (!tb) return null;
    return { tb, wispUrl: resolveParentWisp(p, tb) };
  } catch {
    return null;
  }
}

/**
 * Synchronously expose the Terbium Wisp URL on the global so that
 * `Proxy.initReady` (in src/apis/proxy.ts) and `WispManager.ensureWisp`
 * (in src/core/sw/wisp.ts) read it before falling back to settings or
 * probing.
 *
 * The settings write is also performed (async) for persistence across
 * reloads — but the synchronous global ensures correctness on the very
 * first boot in Terbium, before settings has finished initializing.
 */
async function primeWisp(bridge: ParentBridge): Promise<void> {
  if (!bridge.wispUrl) {
    console.warn(TAG, 'no parent Wisp URL resolved; Daydream will use its own fallback');
    return;
  }
  (globalThis as any).__ddxOverrideWisp = bridge.wispUrl;
  console.log(TAG, 'wisp override set:', bridge.wispUrl);

  // Persist to settings so future loads pick it up even before parent.tb is reachable
  try {
    const { SettingsAPI } = await import('@apis/settings');
    const settings = new SettingsAPI();
    await settings.setItem('wisp', bridge.wispUrl);
    console.log(TAG, 'wisp persisted to settings');
  } catch (err) {
    console.warn(TAG, 'failed to persist wisp to settings:', err);
  }

  // Belt-and-suspenders: if Daydream's Proxy is already constructed when
  // we get here (rare — only if module loading reorders us), hot-swap.
  const startedAt = Date.now();
  const maxWaitMs = 5000;
  const tryHotSwap = (): void => {
    const proxy = (globalThis as any).proxy;
    if (proxy?.swapWispServer) {
      proxy.swapWispServer(bridge.wispUrl).catch((err: unknown) => {
        console.warn(TAG, 'hot-swap failed:', err);
      });
      return;
    }
    if (Date.now() - startedAt < maxWaitMs) {
      setTimeout(tryHotSwap, 100);
    } else {
      console.warn(
        TAG,
        `hot-swap window (${maxWaitMs}ms) expired without seeing globalThis.proxy; ` +
        `relying on Proxy.initReady to read __ddxOverrideWisp`,
      );
    }
  };
  tryHotSwap();
}

/**
 * Propagate the Wisp URL to Daydream's service worker via postMessage.
 *
 * Daydream's SW listens for `{ type: 'ddx:wisp-override', url }` (added
 * in Task 8) and stores it for use by WispManager. This handles the race
 * where the SW is registered before settings has been written.
 */
async function notifyServiceWorker(wispUrl: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'ddx:wisp-override', url: wispUrl });
  } catch (err) {
    console.warn(TAG, 'failed to notify SW:', err);
  }
}

export async function bootInTerbium(): Promise<void> {
  const bridge = detectParent();
  if (!bridge) {
    console.log(TAG, 'standalone (no parent.tb) — boot.ts no-op');
    return;
  }
  (globalThis as any).__terbium = { tb: bridge.tb };
  console.log(TAG, 'running inside Terbium');

  await primeWisp(bridge);
  if (bridge.wispUrl) {
    void notifyServiceWorker(bridge.wispUrl);
  }

  // Pull in the rest of the integration. These are statically imported
  // so rolldown can inline them into the single boot.js IIFE bundle —
  // see `src/terbium/rolldown.config.ts` for why we bundle as one file
  // (classic-script ordering before Daydream's bundle).
  try {
    const { installDownloads } = await import('./downloads');
    const { installIsland } = await import('./island');
    const { installMediaIsland } = await import('./mediaIsland');
    const { installNotifications } = await import('./notifications');
    if (typeof installDownloads === 'function') {
      installDownloads(bridge.tb);
    } else {
      console.warn(TAG, 'downloads module loaded but installDownloads not exported');
    }
    if (typeof installIsland === 'function') {
      installIsland(bridge.tb);
    } else {
      console.warn(TAG, 'island module loaded but installIsland not exported');
    }
    if (typeof installMediaIsland === 'function') {
      installMediaIsland(bridge.tb);
    }
    if (typeof installNotifications === 'function') {
      installNotifications(bridge.tb);
    }
  } catch (err) {
    console.warn(TAG, 'failed to install Terbium integrations:', err);
  }

  // Title sync — mirror document.title to Terbium's titlebar
  try {
    if (bridge.tb.window?.titlebar?.setText) {
      const sync = (): void => {
        try { bridge.tb.window.titlebar.setText(document.title); } catch {}
      };
      sync();
      const titleEl = document.querySelector('title');
      if (titleEl) {
        new MutationObserver(sync).observe(titleEl, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    }
  } catch (err) {
    console.warn(TAG, 'title sync setup failed:', err);
  }
}

// Self-invoke when loaded as a script tag (production TAPP build).
// In tests / non-script contexts, the exports are used directly and
// this auto-invocation is harmless because detectParent() returns null.
if (typeof window !== 'undefined') {
  bootInTerbium().catch(err => console.error(TAG, 'boot failed:', err));
}
