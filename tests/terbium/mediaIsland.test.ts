import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMediaIsland } from '../../src/terbium/mediaIsland';

describe('installMediaIsland', () => {
  afterEach(() => {
    delete (globalThis as any).__ddxMediaMonitor;
  });

  it('syncs an audio element to Terbium music controls', () => {
    const music = vi.fn();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const audio = iframe.contentDocument!.createElement('audio');
    iframe.contentDocument!.body.appendChild(audio);

    installMediaIsland({ mediaplayer: { music } });
    (globalThis as any).__ddxMediaMonitor.monitorFrame(iframe);

    expect(music).toHaveBeenCalledWith(expect.objectContaining({
      track_name: 'about:blank',
      artist: 'Unknown',
    }));
  });

  it('hides the island when its monitored frame is removed', () => {
    const hide = vi.fn();
    installMediaIsland({ mediaplayer: { music: vi.fn(), hide } });

    (globalThis as any).__ddxMediaMonitor.cleanup();

    expect(hide).toHaveBeenCalledOnce();
  });
});
