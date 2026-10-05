import { afterEach, expect, it, vi } from 'vitest';
import { openExtensionPopup, closeExtensionPopup } from './popupHost';

afterEach(() => {
  closeExtensionPopup();
  vi.unstubAllGlobals();
});

it('uses a compact neutral frame without host branding and applies reported popup dimensions', async () => {
  const anchor = document.createElement('button');
  anchor.style.outline = '1px solid red';
  anchor.setAttribute('aria-expanded', 'false');
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 16, y: 12, left: 16, top: 12, right: 50, bottom: 46,
    width: 34, height: 34, toJSON: () => ({}),
  });
  document.body.appendChild(anchor);
  const frames: HTMLIFrameElement[] = [];
  vi.stubGlobal('extensions', {
    createExtensionPlugin: () => ({}),
    wireAuxiliaryViewChannel: () => ({ close: vi.fn() }),
    registerPopupWindow: vi.fn(),
    unregisterPopupWindow: vi.fn(),
  });
  vi.stubGlobal('proxy', {
    createFrame: async (iframe: HTMLIFrameElement) => {
      frames.push(iframe);
      return { go: vi.fn() };
    },
  });
  openExtensionPopup({
    extId: 'sample-extension',
    ctx: { id: 'sample-extension', origin: 'sample-extension.ddx', manifestVersion: 3, manifest: { name: 'Sample tools' } as any },
    popupPath: 'popup.html',
    anchorEl: anchor,
    placement: 'right-start',
    highlightAnchor: true,
  });
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  const wrapper = document.querySelector('.extension-popup-wrapper')!;
  expect((wrapper as HTMLElement).style.width).toBe('312px');
  expect((wrapper as HTMLElement).style.left).toBe('58px');
  expect((wrapper as HTMLElement).style.top).toBe('12px');
  expect((wrapper as HTMLElement).style.background).toBe('rgb(48, 48, 48)');
  expect(anchor.getAttribute('aria-expanded')).toBe('true');
  expect(anchor.style.outline).toContain('2px');
  expect(wrapper.querySelector('.extension-popup-header')).toBeNull();
  expect(wrapper.querySelector('.extension-popup-title')).toBeNull();
  expect(wrapper.querySelector('.extension-popup-close')).toBeNull();
  expect(wrapper.querySelector('iframe')).not.toBeNull();
  expect(wrapper.querySelector('.extension-popup-status')?.textContent).toContain('Loading');
  frames[0]!.dispatchEvent(new Event('load'));
  expect(wrapper.querySelector('.extension-popup-status')).toBeNull();
  window.dispatchEvent(new MessageEvent('message', {
    source: frames[0]!.contentWindow,
    data: { __helium_popup_size__: true, w: 500, h: 350 },
  }));
  expect((wrapper as HTMLElement).style.width).toBe('500px');
  expect((wrapper as HTMLElement).style.height).toBe('350px');
  closeExtensionPopup();
  expect(anchor.getAttribute('aria-expanded')).toBe('false');
  expect(anchor.style.outline).toBe('1px solid red');
  anchor.remove();
});

it('keeps bottom-start placement for popup triggers outside the sidebar menu', async () => {
  const anchor = document.createElement('button');
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 16, y: 12, left: 16, top: 12, right: 50, bottom: 46,
    width: 34, height: 34, toJSON: () => ({}),
  });
  document.body.appendChild(anchor);
  vi.stubGlobal('extensions', {
    createExtensionPlugin: () => ({}),
    wireAuxiliaryViewChannel: () => ({ close: vi.fn() }),
  });
  vi.stubGlobal('proxy', { createFrame: async () => ({ go: vi.fn() }) });

  openExtensionPopup({
    extId: 'toolbar-extension',
    ctx: { id: 'toolbar-extension', origin: 'toolbar-extension.ddx', manifestVersion: 3, manifest: {} as any },
    popupPath: 'popup.html',
    anchorEl: anchor,
  });

  const wrapper = document.querySelector<HTMLElement>('.extension-popup-wrapper')!;
  expect(wrapper.style.left).toBe('16px');
  expect(wrapper.style.top).toBe('50px');
  anchor.remove();
});
