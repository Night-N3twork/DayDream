import type { ExtensionContext } from '../../extfs/types';
import { lookupMessage } from '../../host/i18n/lookup';

/**
 * `chrome.i18n` — provides extension-internal localized strings.
 *
 * IMPORTANT: this implementation is SYNCHRONOUS, by design.
 *
 * Chrome's contract is that `chrome.i18n.getMessage(key, subs?)` returns
 * a string immediately. Real-world extensions universally write things
 * like `el.textContent = chrome.i18n.getMessage('extName')` — if we
 * returned a Promise (the natural shape of RPC-backed APIs), `[object
 * Promise]` would appear in their UI. So instead, the host preloads the
 * negotiated locale's `messages.json` into the on-wire ExtensionContext
 * (see `i18nMessages` on `ExtensionContext`), the bootstrap parses it
 * out of `<meta name="helium-ctx">`, and this class resolves
 * lookups locally without any host round-trip.
 *
 * Because of this, `i18n.getMessage` is intentionally EXCLUDED from the
 * RPC_BINDINGS table in `bootstrap/client.ts` — `installRpcBindings`
 * would otherwise overwrite our sync impl with an async stub.
 *
 * `detectLanguage` still throws (it needs CLD or a network call —
 * neither is wired up).
 */
export class ChromeI18n {
  protected readonly ctx: ExtensionContext;
  /** Local cache of the on-wire `i18nMessages` for fast lookups. */
  private readonly messages: Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
  private readonly locale: string;

  constructor(ctx: ExtensionContext) {
    this.ctx = ctx;
    this.messages = ctx.i18nMessages ?? {};
    const manifestDefault = (ctx.manifest as { default_locale?: string }).default_locale;
    this.locale = ctx.i18nLocale ?? manifestDefault ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  }

  detectLanguage(..._args: any[]): any {
    throw new Error('chrome.i18n.detectLanguage is not implemented');
  }

  /**
   * Synchronous. Returns the user's accept-language list as understood
   * by the iframe's own navigator.languages — that's what Chrome would
   * have returned anyway (the renderer never asks the browser process
   * for the system list in this code path). Matches the (callback, []
   * substitutions) signature: if a callback is supplied we invoke it
   * with the result; otherwise we return the array directly.
   */
  getAcceptLanguages(...args: any[]): any {
    const langs = typeof navigator !== 'undefined' && Array.isArray((navigator as any).languages)
      ? [...(navigator as any).languages]
      : [this.locale];
    const cb = typeof args[0] === 'function' ? args[0] : null;
    if (cb) {
      try { cb(langs); } catch (err) { console.warn('[helium/i18n] getAcceptLanguages callback threw:', err); }
      return undefined;
    }
    return langs;
  }

  /**
   * Synchronous lookup. Two valid signatures (both supported by Chrome):
   *   getMessage(messageName: string, substitutions?: string | string[]): string
   *
   * Chrome's `@@`-prefixed keys are special:
   *   @@extension_id      → the runtime ID
   *   @@ui_locale         → the negotiated locale (BCP-47ish)
   *   @@bidi_dir          → 'ltr' | 'rtl' (we assume ltr for now)
   *   @@bidi_reversed_dir → 'rtl' | 'ltr'
   *   @@bidi_start_edge   → 'left' | 'right'
   *   @@bidi_end_edge     → 'right' | 'left'
   *
   * Unknown keys return '' (Chrome's behaviour — not throwing).
   */
  getMessage(...args: any[]): any {
    const key = args[0];
    const substitutions = args[1];
    if (typeof key !== 'string') return '';

    if (key.startsWith('@@')) {
      switch (key) {
        case '@@extension_id': return this.ctx.id;
        case '@@ui_locale':    return this.locale.replace(/-/g, '_');
        case '@@bidi_dir':          return 'ltr';
        case '@@bidi_reversed_dir': return 'rtl';
        case '@@bidi_start_edge':   return 'left';
        case '@@bidi_end_edge':     return 'right';
        default: return '';
      }
    }

    const entry = lookupMessage(this.messages, key);
    if (!entry) return '';

    let msg = entry.message;

    if (entry.placeholders) {
      for (const [name, p] of Object.entries(entry.placeholders)) {
        msg = msg.replace(new RegExp(`\\$${escapeRegExp(name)}\\$`, 'gi'), p.content);
      }
    }

    const subs = Array.isArray(substitutions) ? substitutions : substitutions != null ? [String(substitutions)] : [];
    for (let i = 0; i < 9; i++) {
      msg = msg.replace(new RegExp(`\\$${i + 1}`, 'g'), subs[i] != null ? String(subs[i]) : '');
    }

    return msg;
  }

  getUILanguage(): string {
    return this.locale.replace(/_/g, '-');
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
