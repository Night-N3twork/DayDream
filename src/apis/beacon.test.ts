import { afterEach, expect, it, vi } from 'vitest';
import { trackEvent } from './beacon';

afterEach(() => { vi.unstubAllGlobals(); delete (window as any).gtag; delete (window as any).dataLayer; });

it('queues GA-compatible app events on the browser tag without posting custom beacons', () => {
  const entries: unknown[][] = [];
  (window as any).gtag = (...args: unknown[]) => entries.push(args);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  trackEvent('tab:created', { event_category: 'app_events', value: 1 });
  expect(entries).toEqual([['event', 'tab_created', { event_category: 'app_events', value: 1 }]]);
  expect(fetch).not.toHaveBeenCalled();
});

it('does not break the app when the browser tag is unavailable', () => {
  delete (window as any).gtag;
  expect(() => trackEvent('tab:created')).not.toThrow();
});

it('uses the shell tag for events emitted from same-origin internal pages', () => {
  const entries: unknown[][] = [];
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const page = iframe.contentWindow!;
  // Vitest's global window facade differs from jsdom's actual frame parent.
  (page.parent as any).gtag = (...args: unknown[]) => entries.push(args);
  vi.stubGlobal('window', page);
  try {
    trackEvent('settings:changed');
    expect(entries).toEqual([['event', 'settings_changed', {}]]);
  } finally { delete (page.parent as any).gtag; vi.unstubAllGlobals(); iframe.remove(); }
});
