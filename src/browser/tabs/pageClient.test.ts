import { describe, expect, it, vi } from 'vitest';
import { TabPageClient } from './pageClient';

describe('TabPageClient extension page link handling', () => {
  it('opens named-target links in a managed tab instead of letting the iframe navigate', async () => {
    const createTab = vi.fn(async () => 'tab-2');
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML = '<a id="dashboard" href="https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ddx/dashboard.html" target="uBODashboard">dashboard</a>';

    const client = new TabPageClient({
      createTab,
      logger: { createLog: vi.fn() },
      proxy: { decodeUrl: (url: string) => url },
    } as never);

    client.pageClient(iframe);
    iframe.contentDocument!.getElementById('dashboard')!.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));

    await Promise.resolve();

    expect(createTab).toHaveBeenCalledWith('https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ddx/dashboard.html');
  });
});

describe('TabPageClient page dismissal', () => {
  it('forwards iframe pointerdown to the host without canceling it', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const client = new TabPageClient({} as never);
    const onPageClicked = vi.fn();
    document.addEventListener('ddx:page.clicked', onPageClicked);

    client.pageClient(iframe);

    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    iframe.contentDocument!.body.dispatchEvent(event);

    expect(onPageClicked).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);

    document.removeEventListener('ddx:page.clicked', onPageClicked);
    iframe.remove();
  });

  it('replaces the iframe dismissal listener and removes it during cleanup', () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'iframe-tab-1';
    document.body.appendChild(iframe);
    const client = new TabPageClient({} as never);
    const onPageClicked = vi.fn();
    document.addEventListener('ddx:page.clicked', onPageClicked);

    client.pageClient(iframe);
    client.pageClient(iframe);
    iframe.contentDocument!.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })
    );
    client.cleanupIframe(iframe.id);
    iframe.contentDocument!.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })
    );

    expect(onPageClicked).toHaveBeenCalledTimes(1);

    document.removeEventListener('ddx:page.clicked', onPageClicked);
    iframe.remove();
  });
});
