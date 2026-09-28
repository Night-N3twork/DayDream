import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabFrameManager } from './frameManager';

describe('TabFrameManager', () => {
  afterEach(() => {
    delete (globalThis as any).__ddxMediaMonitor;
  });

  it('cleans up media controls when its managed frame is destroyed', () => {
    const cleanupFrame = vi.fn();
    const iframe = document.createElement('iframe');
    const manager = new TabFrameManager({
      proxy: { deleteFrame: vi.fn().mockReturnValue(true) },
    } as any);
    (manager as any).managedByTabId.set('tab-1', {
      iframe,
      frameId: 'iframe-1',
      proxyHandle: {},
      placement: 'main',
    });
    (globalThis as any).__ddxMediaMonitor = { cleanupFrame };

    manager.cleanupFrame('tab-1');

    expect(cleanupFrame).toHaveBeenCalledWith(iframe);
  });
});
