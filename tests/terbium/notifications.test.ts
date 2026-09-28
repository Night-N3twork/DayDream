import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNotifications } from '../../src/terbium/notifications';

describe('installNotifications', () => {
  afterEach(() => {
    delete (globalThis as any).__ddxNotify;
  });

  it('exposes a Terbium toast helper with Daydream defaults', () => {
    const Toast = vi.fn();

    installNotifications({ notification: { Toast } });
    (globalThis as any).__ddxNotify('Download complete', { time: 4000 });

    expect(Toast).toHaveBeenCalledWith({
      message: 'Download complete',
      application: 'Daydream',
      iconSrc: './icon.png',
      time: 4000,
    });
  });

  it('does not expose a helper when the Toast API is unavailable', () => {
    installNotifications({});

    expect((globalThis as any).__ddxNotify).toBeUndefined();
  });
});
