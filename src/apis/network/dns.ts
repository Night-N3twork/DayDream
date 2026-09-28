
export interface DnsResolveResult {
  address: string;
  statusCode: number;
}

export interface DnsBackend {
  resolve(hostname: string): Promise<DnsResolveResult>;
}

import { coverIdentity } from '@core/shared/build-runtime';

/**
 * Singleton DnsResolver. Holds a single registered backend; calls
 * `resolve()` on it when chrome.dns.resolve fires. If no backend
 * is set, throws synchronously with a clear "register a backend"
 * error rather than silently returning a placeholder address.
 */
export class DnsResolver {
  private backend: DnsBackend | null = null;

  /**
   * Register the active DNS backend. Replaces any prior backend.
   * Returns an unregister function (for tests / hot-swapping).
   */
  setBackend(backend: DnsBackend): () => void {
    this.backend = backend;
    return () => {
      if (this.backend === backend) this.backend = null;
    };
  }

  /** Whether a backend is currently registered. */
  hasBackend(): boolean {
    return this.backend !== null;
  }

  /**
   * Resolve a hostname via the registered backend. Throws if no
   * backend is registered (`chrome.dns.resolve` callers see this as
   * the promise rejection / lastError).
   */
  async resolve(hostname: string): Promise<DnsResolveResult> {
    if (!this.backend) {
      throw new Error(
        'chrome.dns.resolve: No DNS backend registered. ' +
          'Register one via DnsResolver.setBackend(impl) — this typically ' +
          `happens when ${coverIdentity().product}'s internal network stack initializes.`,
      );
    }
    if (typeof hostname !== 'string' || !hostname) {
      throw new Error('chrome.dns.resolve: hostname must be a non-empty string');
    }
    return this.backend.resolve(hostname);
  }
}

let _resolver: DnsResolver | null = null;

/**
 * Get the shared DnsResolver. Created lazily on first call so the
 * import is cheap and idempotent.
 */
export function getDnsResolver(): DnsResolver {
  if (!_resolver) {
    _resolver = new DnsResolver();
    (window as { dnsResolver?: DnsResolver }).dnsResolver = _resolver;
  }
  return _resolver;
}
