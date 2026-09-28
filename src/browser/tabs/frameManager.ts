import type { TabSplitPlacement, TabsInterface } from './types';

interface ManagedFrame {
	iframe: HTMLIFrameElement;
	frameId: string;
	proxyHandle: any;
	placement: TabSplitPlacement;
}

export class TabFrameManager {
	private tabs: TabsInterface;
	private managedByTabId: Map<string, ManagedFrame> = new Map();

	constructor(tabs: TabsInterface) {
		this.tabs = tabs;
	}

	createManagedFrame = async (
		tabId: string,
		url: string,
		placement: TabSplitPlacement = 'main',
		opts?: {
			plugins?: unknown[];
			/**
			 * Synchronous hook invoked AFTER the iframe element exists and
			 * the Scramjet frame handle has been attached, but BEFORE the
			 * navigation starts (before `frame.go(url)` or `iframe.src=`).
			 *
			 * Needed by extension-hosted tabs (uBlock dashboard, options
			 * pages): those tabs use `wireAuxiliaryViewChannel` to install
			 * a handshake port, and the wiring must be in place before the
			 * iframe loads or the load event fires without a listener and
			 * the bootstrap channel promise never resolves. See
			 * `TabLifecycle.createTab` for the caller side.
			 */
			onBeforeNavigate?: (iframe: HTMLIFrameElement) => void;
		}
	): Promise<{
		iframe: HTMLIFrameElement;
		frameId: string;
		proxyHandle: any;
	}> => {
		const tabSuffix = tabId.startsWith('tab-')
			? tabId.replace('tab-', '')
			: tabId;
		const iframe = this.tabs.ui.createElement('iframe', {
			id: `iframe-${tabSuffix}`,
			title: `Iframe for ${tabId}`
		}) as HTMLIFrameElement;

		iframe.setAttribute('data-tab-id', tabId);
		iframe.setAttribute('data-split-placement', placement);

		const hasPlugins = !!(opts?.plugins && opts.plugins.length > 0);
		const proxyHandle = hasPlugins
			? await this.tabs.proxy.createFrame(iframe, { plugins: opts!.plugins! })
			: await this.tabs.proxy.createFrame(iframe);

		if (opts?.onBeforeNavigate) {
			try { opts.onBeforeNavigate(iframe); }
			catch (err) {
				console.warn('[frameManager] onBeforeNavigate hook threw:', err);
			}
		}

		if (hasPlugins) {
			try {
				const frame = proxyHandle as { go?: (u: string) => void };
				if (typeof frame.go === 'function') {
					frame.go(url);
				} else {
					iframe.setAttribute('src', url);
				}
			} catch (err) {
				console.warn('[frameManager] frame.go failed, falling back to iframe.src:', err);
				iframe.setAttribute('src', url);
			}
		} else {
			const processedSrc = await this.tabs.proto.processUrl(url, iframe);
			if (processedSrc) {
				iframe.setAttribute('src', processedSrc);
			}
		}

		const managed: ManagedFrame = {
			iframe,
			frameId: iframe.id,
			proxyHandle,
			placement
		};

		this.managedByTabId.set(tabId, managed);
		const mediaMonitor = (globalThis as any).__ddxMediaMonitor;
		mediaMonitor?.monitorFrame?.(iframe);

		return {
			iframe,
			frameId: managed.frameId,
			proxyHandle
		};
	};

	attachFrame = (tabId: string, container: HTMLElement): void => {
		const managed = this.managedByTabId.get(tabId);
		if (!managed) return;
		if (managed.iframe.parentElement !== container) {
			container.appendChild(managed.iframe);
		}
	};

	navigateFrame = async (tabId: string, url: string): Promise<void> => {
		const managed = this.managedByTabId.get(tabId);
		if (!managed) return;
		const processedSrc = await this.tabs.proto.processUrl(
			url,
			managed.iframe
		);
		if (processedSrc) {
			managed.iframe.setAttribute('src', processedSrc);
		}
	};

	cleanupFrame = (tabId: string): void => {
		const managed = this.managedByTabId.get(tabId);
		if (!managed) return;
		(globalThis as any).__ddxMediaMonitor?.cleanupFrame?.(managed.iframe);

		try {
			managed.iframe.src = 'about:blank';
			managed.iframe.contentWindow?.stop();
		} catch {
			// best effort cleanup
		}

		const deleted = this.tabs.proxy.deleteFrame(managed.iframe);
		if (!deleted) {
			managed.iframe.remove();
		}

		this.managedByTabId.delete(tabId);
	};

	setFramePlacement = (
		tabId: string,
		splitPlacement: TabSplitPlacement
	): void => {
		const managed = this.managedByTabId.get(tabId);
		if (!managed) return;
		managed.placement = splitPlacement;
		managed.iframe.setAttribute('data-split-placement', splitPlacement);
	};
}
