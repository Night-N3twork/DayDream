import { describe, expect, it, vi } from 'vitest';
import { MenuManager } from './menuManager';
import { TabPageClient } from '@browser/tabs/pageClient';

describe('MenuManager menus', () => {
  it('keeps an open menu open when pointerdown targets a trigger descendant', () => {
    const menuBtn = document.createElement('button');
    const icon = document.createElement('span');
    menuBtn.appendChild(icon);
    const menuPopup = document.createElement('div');
    document.body.append(menuBtn, menuPopup);

    const manager = new MenuManager(
      { extrasButton: menuBtn, menuContent: menuPopup } as never,
      {} as never
    );
    manager.menus();
    menuBtn.click();

    icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    menuBtn.click();

    expect(menuPopup.style.opacity).toBe('0');

    menuBtn.remove();
    menuPopup.remove();
  });

  it('dismisses the active right-click menu without canceling shell pointerdown', () => {
    const menuBtn = document.createElement('button');
    const menuPopup = document.createElement('div');
    const page = document.createElement('div');
    const closeMenu = vi.fn();
    document.body.append(menuBtn, menuPopup, page);

    const manager = new MenuManager(
      { extrasButton: menuBtn, menuContent: menuPopup } as never,
      { rightclickmenu: { closeMenu } } as never
    );
    manager.menus();

    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true
    });
    page.dispatchEvent(event);

    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);

    menuBtn.remove();
    menuPopup.remove();
    page.remove();
  });

  it('keeps the active right-click menu available for its own pointerdown', () => {
    const menuBtn = document.createElement('button');
    const menuPopup = document.createElement('div');
    const contextMenu = document.createElement('div');
    const action = document.createElement('button');
    const closeMenu = vi.fn();
    contextMenu.appendChild(action);
    document.body.append(menuBtn, menuPopup, contextMenu);

    const manager = new MenuManager(
      { extrasButton: menuBtn, menuContent: menuPopup } as never,
      { rightclickmenu: { closeMenu, container: contextMenu } } as never
    );
    manager.menus();
    action.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(closeMenu).not.toHaveBeenCalled();

    menuBtn.remove();
    menuPopup.remove();
    contextMenu.remove();
  });

  it('closes the right-click menu when an iframe forwards pointerdown', () => {
    const menuBtn = document.createElement('button');
    const menuPopup = document.createElement('div');
    const iframe = document.createElement('iframe');
    const closeMenu = vi.fn();
    document.body.append(menuBtn, menuPopup, iframe);

    const manager = new MenuManager(
      { extrasButton: menuBtn, menuContent: menuPopup } as never,
      { rightclickmenu: { closeMenu } } as never
    );
    manager.menus();
    new TabPageClient({} as never).pageClient(iframe);

    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true
    });
    iframe.contentDocument!.body.dispatchEvent(event);

    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);

    menuBtn.remove();
    menuPopup.remove();
    iframe.remove();
  });

  it('does not register duplicate shell dismissal listeners', () => {
    const menuBtn = document.createElement('button');
    const menuPopup = document.createElement('div');
    const page = document.createElement('div');
    const closeMenu = vi.fn();
    document.body.append(menuBtn, menuPopup, page);

    const manager = new MenuManager(
      { extrasButton: menuBtn, menuContent: menuPopup } as never,
      { rightclickmenu: { closeMenu } } as never
    );
    manager.menus();
    manager.menus();
    page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(closeMenu).toHaveBeenCalledTimes(1);

    menuBtn.remove();
    menuPopup.remove();
    page.remove();
  });

  it('keeps pointer interaction enabled when reopened before the close transition ends', () => {
    vi.useFakeTimers();
    const menuBtn = document.createElement('button');
    const menuPopup = document.createElement('div');
    const page = document.createElement('div');
    document.body.append(menuBtn, menuPopup, page);

    const manager = new MenuManager(
      { extrasButton: menuBtn, menuContent: menuPopup } as never,
      {} as never
    );
    manager.menus();
    menuBtn.click();
    page.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    menuBtn.click();
    vi.advanceTimersByTime(180);

    expect(menuPopup.style.pointerEvents).toBe('auto');

    menuBtn.remove();
    menuPopup.remove();
    page.remove();
    vi.useRealTimers();
  });
});
