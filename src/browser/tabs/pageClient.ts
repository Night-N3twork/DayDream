import type { TabsInterface } from './types';
import { decodeProxiedUrl } from './urlDecoder';
import { injectExtensionMenus, type ContextMenuClickInfo } from '@core/helium/host/contextMenus';

interface ExtManagerLike {
	contextMenusRegistry?: import('@core/helium/host/contextMenus').ContextMenuRegistry;
	fireEventOn?: (extId: string, method: string, args: unknown[]) => void;
	grantActiveTab?: (extId: string, tabId: number) => void;
}

interface PagePointerDownHandler {
	document: Document;
	handler: (event: PointerEvent) => void;
}

export class TabPageClient {
	private tabs: TabsInterface;
	private observers: Map<string, MutationObserver> = new Map();
	private intervalIds: Map<string, number[]> = new Map();
	private linkContextHandlers: Map<string, (event: MouseEvent) => void> =
		new Map();
	private pageBgContextHandlers: Map<
		string,
		(event: MouseEvent) => void
	> = new Map();
	private modifierClickHandlers: Map<
		string,
		(event: MouseEvent) => void
	> = new Map();
	private pagePointerDownHandlers: Map<string, PagePointerDownHandler> =
		new Map();

	constructor(tabs: TabsInterface) {
		this.tabs = tabs;
	}

	pageClient = (iframe: HTMLIFrameElement): void => {
		this.setupWindowOpenInterceptor(iframe);
		this.setupNamedTargetLinkInterceptor(iframe);
		this.setupModifierClickInterceptor(iframe);
		this.setupClickListener(iframe);
		this.setupPagePointerDownDismissal(iframe);
		this.setupLinkContextBridge(iframe);
		this.setupPageBackgroundContextBridge(iframe);
		this.setupNavigationTracking(iframe);
		this.setupPhaseEvents(iframe);
		this.setupKeyboardHandler(iframe);
	};

	cleanupIframe = (iframeId: string): void => {
		const observer = this.observers.get(iframeId);
		if (observer) {
			observer.disconnect();
			this.observers.delete(iframeId);
		}

		const intervals = this.intervalIds.get(iframeId);
		if (intervals) {
			intervals.forEach(id => clearTimeout(id));
			this.intervalIds.delete(iframeId);
		}

		const contextHandler = this.linkContextHandlers.get(iframeId);
		if (contextHandler) {
			try {
				const iframe = document.getElementById(
					iframeId
				) as HTMLIFrameElement | null;
				iframe?.contentDocument?.removeEventListener(
					'contextmenu',
					contextHandler,
					true
				);
			} catch {
				// ignore
			}
			this.linkContextHandlers.delete(iframeId);
		}

		const modifierHandler = this.modifierClickHandlers.get(iframeId);
		if (modifierHandler) {
			try {
				const iframe = document.getElementById(
					iframeId
				) as HTMLIFrameElement | null;
				iframe?.contentDocument?.removeEventListener(
					'click',
					modifierHandler,
					true
				);
				iframe?.contentDocument?.removeEventListener(
					'auxclick',
					modifierHandler,
					true
				);
			} catch {
				// ignore
			}
			this.modifierClickHandlers.delete(iframeId);
		}

		const pageBgHandler = this.pageBgContextHandlers.get(iframeId);
		if (pageBgHandler) {
			try {
				const iframe = document.getElementById(
					iframeId
				) as HTMLIFrameElement | null;
				iframe?.contentDocument?.removeEventListener(
					'contextmenu',
					pageBgHandler,
					true
				);
			} catch {
				// ignore
			}
			this.pageBgContextHandlers.delete(iframeId);
		}

		const pointerDownHandler = this.pagePointerDownHandlers.get(iframeId);
		if (pointerDownHandler) {
			pointerDownHandler.document.removeEventListener(
				'pointerdown',
				pointerDownHandler.handler,
				true
			);
			this.pagePointerDownHandlers.delete(iframeId);
		}
	};

	cleanupAll = (): void => {
		this.observers.forEach(observer => observer.disconnect());
		this.observers.clear();

		this.intervalIds.forEach(intervals => {
			intervals.forEach(id => clearTimeout(id));
		});
		this.intervalIds.clear();

		this.linkContextHandlers.forEach((handler, iframeId) => {
			try {
				const iframe = document.getElementById(
					iframeId
				) as HTMLIFrameElement | null;
				iframe?.contentDocument?.removeEventListener(
					'contextmenu',
					handler,
					true
				);
			} catch {
				// ignore
			}
		});
		this.linkContextHandlers.clear();

		this.modifierClickHandlers.forEach((handler, iframeId) => {
			try {
				const iframe = document.getElementById(
					iframeId
				) as HTMLIFrameElement | null;
				iframe?.contentDocument?.removeEventListener(
					'click',
					handler,
					true
				);
				iframe?.contentDocument?.removeEventListener(
					'auxclick',
					handler,
					true
				);
			} catch {
				// ignore
			}
		});
		this.modifierClickHandlers.clear();

		this.pageBgContextHandlers.forEach((handler, iframeId) => {
			try {
				const iframe = document.getElementById(
					iframeId
				) as HTMLIFrameElement | null;
				iframe?.contentDocument?.removeEventListener(
					'contextmenu',
					handler,
					true
				);
			} catch {
				// ignore
			}
		});
		this.pageBgContextHandlers.clear();

		this.pagePointerDownHandlers.forEach(({ document, handler }) => {
			document.removeEventListener('pointerdown', handler, true);
		});
		this.pagePointerDownHandlers.clear();
	};

	private setupPagePointerDownDismissal(iframe: HTMLIFrameElement): void {
		try {
			const iframeDocument = iframe.contentDocument;
			if (!iframeDocument) return;

			const existing = this.pagePointerDownHandlers.get(iframe.id);
			if (existing) {
				existing.document.removeEventListener(
					'pointerdown',
					existing.handler,
					true
				);
			}

			const handler = () => {
				document.dispatchEvent(new CustomEvent('ddx:page.clicked'));
			};
			iframeDocument.addEventListener('pointerdown', handler, true);
			this.pagePointerDownHandlers.set(iframe.id, {
				document: iframeDocument,
				handler
			});
		} catch {
			// Cross-origin iframe documents cannot be observed from the shell.
		}
	}

	private setupLinkContextBridge(iframe: HTMLIFrameElement): void {
		if (!iframe.contentDocument) return;

		const existing = this.linkContextHandlers.get(iframe.id);
		if (existing) {
			iframe.contentDocument.removeEventListener(
				'contextmenu',
				existing,
				true
			);
		}

		const handler = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const anchor = target?.closest(
				'a[href]'
			) as HTMLAnchorElement | null;
			if (!anchor) return;

			event.preventDefault();
			event.stopPropagation();

			const href = anchor.href;
			const text = (anchor.textContent || '').trim();
			this.openLinkContextMenu(event, href, text);
		};

		iframe.contentDocument.addEventListener('contextmenu', handler, true);
		this.linkContextHandlers.set(iframe.id, handler);
	}

	/**
	 * Page-background context menu bridge.
	 *
	 * Fires for `contextmenu` events that DON'T land on a link (the link
	 * bridge already handles those). Always preventDefault — per the design
	 * decision to override site contextmenu handlers for consistent UX.
	 *
	 * Listens at capture phase so we beat any inner site handlers.
	 */
	private setupPageBackgroundContextBridge(iframe: HTMLIFrameElement): void {
		if (!iframe.contentDocument) return;

		const existing = this.pageBgContextHandlers.get(iframe.id);
		if (existing) {
			iframe.contentDocument.removeEventListener(
				'contextmenu',
				existing,
				true
			);
		}

		const handler = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('a[href]')) return;

			event.preventDefault();
			event.stopPropagation();

			this.openPageBackgroundMenu(iframe, event);
		};

		iframe.contentDocument.addEventListener('contextmenu', handler, true);
		this.pageBgContextHandlers.set(iframe.id, handler);
	}

	private openPageBackgroundMenu(
		iframe: HTMLIFrameElement,
		event: MouseEvent
	): void {
		const rightClickMenu =
			this.tabs.ui?.rightclickmenu ??
			this.tabs.ui?.np?.rightclickmenu ??
			this.tabs.nightmarePlugins?.rightclickmenu;
		if (!rightClickMenu) return;

		rightClickMenu.closeMenu();

		const menu = this.tabs.auxiliaryMenus?.buildPageBackgroundMenu(iframe);
		if (!menu) return;

		const rect = iframe.getBoundingClientRect();
		const hostX = rect.left + event.clientX;
		const hostY = rect.top + event.clientY;

		const tempAnchor = this.tabs.ui.createElement('div', {
			style: `position:fixed;left:${hostX}px;top:${hostY}px;width:1px;height:1px;opacity:0;pointer-events:none;`
		});
		document.body.appendChild(tempAnchor);

		const hostEvent = new MouseEvent('contextmenu', {
			clientX: hostX,
			clientY: hostY,
			bubbles: false,
			cancelable: true
		});
		Object.defineProperty(hostEvent, 'pageX', { value: hostX });
		Object.defineProperty(hostEvent, 'pageY', { value: hostY });

		rightClickMenu.openMenu(tempAnchor, hostEvent, menu);

		setTimeout(() => tempAnchor.remove(), 0);
	}

	private openLinkContextMenu(
		event: MouseEvent,
		href: string,
		text: string
	): void {
		const rightClickMenu =
			this.tabs.ui?.rightclickmenu ??
			this.tabs.ui?.np?.rightclickmenu ??
			this.tabs.nightmarePlugins?.rightclickmenu;

		if (!rightClickMenu) return;

		rightClickMenu.closeMenu();

		const menu = this.tabs.ui.createElement(
			'div',
			{
				class: 'fixed z-50 bg-[var(--bg-1)] border border-[var(--white-08)] rounded-lg shadow-xl py-2 min-w-56',
				style: 'backdrop-filter: blur(8px);'
			},
			[
				this.tabs.ui.createElement(
					'button',
					{
						class: 'flex items-center gap-3 px-4 py-2 hover:bg-[var(--white-05)] transition-colors w-full text-left text-sm rounded-md',
						onclick: async () => {
							await this.tabs.createTab(href);
							rightClickMenu.closeMenu();
						}
					},
					[
						this.tabs.ui.createElement(
							'i',
							{
								'data-lucide': 'external-link',
								class: 'h-4 w-4'
							},
							[]
						),
						this.tabs.ui.createElement('span', {}, [
							'Open Link in New Tab'
						])
					]
				),
				this.tabs.ui.createElement(
					'button',
					{
						class: 'flex items-center gap-3 px-4 py-2 opacity-60 cursor-not-allowed w-full text-left text-sm rounded-md',
						disabled: true
					},
					[
						this.tabs.ui.createElement(
							'i',
							{ 'data-lucide': 'columns-2', class: 'h-4 w-4' },
							[]
						),
						this.tabs.ui.createElement('span', {}, [
							'Open Link in Split View'
						])
					]
				),
				this.tabs.ui.createElement(
					'button',
					{
						class: 'flex items-center gap-3 px-4 py-2 hover:bg-[var(--white-05)] transition-colors w-full text-left text-sm rounded-md',
						onclick: async () => {
							try {
								await navigator.clipboard.writeText(href);
							} catch {
								// no-op
							}
							rightClickMenu.closeMenu();
						}
					},
					[
						this.tabs.ui.createElement(
							'i',
							{ 'data-lucide': 'copy', class: 'h-4 w-4' },
							[]
						),
						this.tabs.ui.createElement('span', {}, [
							'Copy Link Address'
						])
					]
				),
				this.tabs.ui.createElement('div', {
					class: 'h-px bg-[var(--white-08)] my-1'
				}),
				this.tabs.ui.createElement(
					'div',
					{
						class: 'px-4 py-1 text-xs text-[var(--text)]/60 truncate',
						title: href
					},
					[text || href]
				)
			]
		);

		try {
			const extMgr = (window as { extensions?: ExtManagerLike }).extensions;
			const registry = extMgr?.contextMenusRegistry;
			if (registry) {
				const items: HTMLElement[] = [];
				const fireOnClicked = (extId: string, click: ContextMenuClickInfo, tabArg?: unknown) => {
					extMgr?.fireEventOn?.(extId, 'chrome.contextMenus.onClicked', [click, tabArg]);
				};
				const deps: Parameters<typeof injectExtensionMenus>[5] = {
					registry,
					fireOnClicked,
					createElement: (tag, attrs, children) =>
						this.tabs.ui.createElement(tag, attrs ?? {}, (children ?? []) as (string | HTMLElement)[]),
				};
				if (extMgr?.grantActiveTab) deps.grantActiveTab = extMgr.grantActiveTab.bind(extMgr);
				injectExtensionMenus(items, 'link', { linkUrl: href }, undefined, undefined, deps);
				for (const el of items) menu.appendChild(el);
			}
		} catch (err) {
			console.warn('[pageClient] link extension menu injection failed:', err);
		}

		const tempAnchor = this.tabs.ui.createElement('div', {
			style: `position:fixed;left:${event.pageX}px;top:${event.pageY}px;width:1px;height:1px;opacity:0;pointer-events:none;`
		});
		document.body.appendChild(tempAnchor);

		rightClickMenu.openMenu(tempAnchor, event, menu);

		setTimeout(() => {
			tempAnchor.remove();
		}, 0);
	}

	/**
	 * Patch the iframe's `window.open` to route popups into a new host tab.
	 * Mirrors the behavior of native `window.open(url)` from the user's
	 * perspective (a fresh tab opens) but keeps the new content inside our
	 * tab UI instead of spawning a real top-level browser window.
	 */
	private setupWindowOpenInterceptor(iframe: HTMLIFrameElement): void {
		try {
			if (!iframe.contentWindow) return;

			iframe.contentWindow.window.open = (
				url?: string | URL
			): Window | null => {
				this.handleNewWindowNavigation(url);
				return null;
			};
		} catch (err) {
			console.warn('[pageClient] window.open interceptor unavailable:', err);
		}
	}

	private setupNamedTargetLinkInterceptor(iframe: HTMLIFrameElement): void {
		if (!iframe.contentDocument) return;

		const handler = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;

			const target = event.target as HTMLElement | null;
			const anchor = target?.closest(
				'a[href][target]'
			) as HTMLAnchorElement | null;
			if (!anchor) return;

			const targetName = anchor.getAttribute('target')?.toLowerCase() ?? '';
			if (targetName === '' || targetName === '_self' || targetName === '_parent' || targetName === '_top') {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			this.handleNewWindowNavigation(anchor.href);
		};

		iframe.contentDocument.addEventListener('click', handler, true);
	}

	/**
	 * Catch ctrl/cmd+click and middle-click on `<a[href]>` inside the iframe.
	 * Without this, the browser opens those as native top-level popup windows
	 * pointing at the scramjet-rewritten URL, which would load our host shell
	 * outside the current tab UI. We preventDefault and route to a new tab.
	 *
	 * Listens at capture phase to beat any inner click handlers, and tracks
	 * registration per-iframe so cleanup can remove the listener.
	 */
	private setupModifierClickInterceptor(iframe: HTMLIFrameElement): void {
		if (!iframe.contentDocument) return;

		const existing = this.modifierClickHandlers.get(iframe.id);
		if (existing) {
			iframe.contentDocument.removeEventListener(
				'click',
				existing,
				true
			);
			iframe.contentDocument.removeEventListener(
				'auxclick',
				existing,
				true
			);
		}

		const handler = (event: MouseEvent) => {
			const isMiddle = event.button === 1;
			const isModifierLeft =
				event.button === 0 && (event.ctrlKey || event.metaKey);
			if (!isMiddle && !isModifierLeft) return;

			const target = event.target as HTMLElement | null;
			const anchor = target?.closest(
				'a[href]'
			) as HTMLAnchorElement | null;
			if (!anchor) return;

			const href = anchor.href;
			if (!href) return;

			event.preventDefault();
			event.stopPropagation();

			this.handleNewWindowNavigation(href);
		};

		iframe.contentDocument.addEventListener('click', handler, true);
		iframe.contentDocument.addEventListener('auxclick', handler, true);
		this.modifierClickHandlers.set(iframe.id, handler);
	}

	/**
	 * Common entrypoint for "open this URL in a new host tab".
	 * Used by both the window.open polyfill and the modifier-click handler.
	 *
	 * URLs reaching this method can be scramjet-encoded (e.g. when read
	 * from `anchor.href` in the host context, since the per-anchor href
	 * getter trap only fires in the proxied window's prototype chain).
	 * We always run them through `decodeProxiedUrl` so `createTab` gets
	 * the real underlying URL and re-proxies it cleanly for the new tab.
	 */
	private async handleNewWindowNavigation(
		url?: string | URL
	): Promise<void> {
		try {
			if (!url) return;

			const raw = url instanceof URL ? url.href : url.toString();
			if (!raw) return;

			const decoded = decodeProxiedUrl(raw, this.tabs.proxy);
			const target = decoded || raw;

			console.log('[PageClient] Opening new tab with URL:', target);

			await this.tabs.createTab(target);
			this.tabs.logger?.createLog?.(`New tab opened: ${target}`);
		} catch (error) {
			console.error('[PageClient] Error opening new tab:', error);
		}
	}

	private setupClickListener(iframe: HTMLIFrameElement): void {
		iframe.contentWindow?.document.body.addEventListener('click', () => {
			window.parent.eventsAPI?.emit?.('ddx:page.clicked', null);
		});
	}

	private setupNavigationTracking(iframe: HTMLIFrameElement): void {
		if (!iframe.contentWindow) return;

		const iframeId = iframe.id;
		let lastKnownUrl = iframe.contentWindow.location.href;

		const checkUrlChange = () => {
			try {
				const currentUrl = iframe.contentWindow?.location?.href;
				if (currentUrl && currentUrl !== lastKnownUrl) {
					lastKnownUrl = currentUrl;
					this.handleUrlChange(iframe);
				}
			} catch (e) {
				console.warn('Could not check URL change:', e);
			}
		};

		iframe.contentWindow.document.addEventListener('click', e => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'A' || target.closest('a')) {
				setTimeout(checkUrlChange, 100);
				setTimeout(checkUrlChange, 500);
				setTimeout(checkUrlChange, 1000);
			}
		});

		iframe.contentWindow.document.addEventListener('submit', () => {
			setTimeout(checkUrlChange, 100);
			setTimeout(checkUrlChange, 500);
			setTimeout(checkUrlChange, 1000);
		});

		const observer = new MutationObserver(() => {
			checkUrlChange();
		});

		observer.observe(iframe.contentWindow.document.documentElement, {
			childList: true,
			subtree: true
		});

		this.observers.set(iframeId, observer);
	}

	private handleUrlChange(iframe: HTMLIFrameElement): void {
		const tabId = iframe.id.replace('iframe-', 'tab-');
		const iframeLoadedEvent = new CustomEvent('iframeLoaded', {
			detail: {
				tabId,
				iframe,
				tabElement: document.getElementById(tabId)
			}
		});
		document.dispatchEvent(iframeLoadedEvent);

		let href: string | undefined;
		try {
			href = iframe.contentWindow?.location?.href ?? undefined;
		} catch {
			href = undefined;
		}
		const detail = {
			tabId,
			url: href,
			phase: 'committed' as const,
			fromUrlChange: true
		};
		window.dispatchEvent(new CustomEvent('tabNavigated', { detail }));
		document.dispatchEvent(new CustomEvent('tabNavigated', { detail }));
	}

	/**
	 * Wires `DOMContentLoaded` + `load` listeners on the iframe's
	 * contentWindow so we can dispatch `tabNavigated` with phases
	 * `'dom-content-loaded'` and `'completed'`. These phases match
	 * chrome.webNavigation.onDOMContentLoaded / onCompleted semantics.
	 *
	 * Note: Scramjet proxies the iframe's window/document. The native
	 * iframe `load` event on the iframe element (registered separately
	 * below) always fires regardless of proxy state and acts as the
	 * "completed" fallback. DOMContentLoaded fired from inside the
	 * Scramjet-proxied contentWindow is best-effort — it may fire
	 * late, fire after `load`, or not fire at all for some proxied
	 * pages. Consumers should treat the absence of a dom-content-loaded
	 * event as "not observed" and rely on `completed` as the
	 * authoritative end-of-navigation signal.
	 */
	private setupPhaseEvents(iframe: HTMLIFrameElement): void {
		const tabId = iframe.id.replace('iframe-', 'tab-');
		let domFired = false;
		let loadFired = false;

		const fire = (phase: 'dom-content-loaded' | 'completed') => {
			let url: string | undefined;
			try {
				url = iframe.contentWindow?.location?.href ?? undefined;
			} catch {
				url = undefined;
			}
			const detail = { tabId, url, phase, fromPageLoad: true };
			window.dispatchEvent(new CustomEvent('tabNavigated', { detail }));
			document.dispatchEvent(new CustomEvent('tabNavigated', { detail }));
		};

		try {
			const win = iframe.contentWindow;
			if (win) {
				win.addEventListener(
					'DOMContentLoaded',
					() => {
						if (domFired) return;
						domFired = true;
						fire('dom-content-loaded');
					},
					{ once: false }
				);
				win.addEventListener(
					'load',
					() => {
						if (loadFired) return;
						loadFired = true;
						fire('completed');
					},
					{ once: false }
				);
			}
		} catch {
			// proxied window may not support addEventListener; fall back below
		}

		iframe.addEventListener('load', () => {
			if (!domFired) {
				domFired = true;
				fire('dom-content-loaded');
			}
			if (!loadFired) {
				loadFired = true;
				fire('completed');
			}
		});
	}

	private setupKeyboardHandler(iframe: HTMLIFrameElement): void {
		if (!iframe.contentWindow) return;

		try {
			iframe.contentWindow.document.addEventListener(
				'keydown',
				async event => {
					const keyboardManager = (window as any).functions
						?.keyboardManager;
					if (
						keyboardManager &&
						typeof keyboardManager.handleKeyDown === 'function'
					) {
						await keyboardManager.handleKeyDown(event);
					}
				},
				true
			);
			console.log('[PageClient] Keyboard handler attached to iframe');
		} catch (error) {
			console.warn(
				'[PageClient] Could not attach keyboard handler:',
				error
			);
		}
	}

}
