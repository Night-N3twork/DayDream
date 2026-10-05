
import type { ExtensionContext } from '@core/helium';
import type { ExtensionBridgeChannel } from '@core/helium';

/**
 * Popup sizing bounds modeled after a compact browser extension menu.
 * The iframe reports its content size after load; dimensions are clamped
 * to the viewport and Chrome's approximate 800×600 popup ceiling.
 */
const POPUP_WIDTH = 312;
const POPUP_MIN_HEIGHT = 120;
const POPUP_MAX_HEIGHT = 600;
const POPUP_ANCHOR_GAP = 4;
const POPUP_SIDEBAR_GAP = 8;
const POPUP_EDGE_MARGIN = 8;

let currentPopup: HTMLDivElement | null = null;
let currentPopupOwner: { extId: string; win: Window; channel: ExtensionBridgeChannel | null } | null = null;
let currentPopupIframe: HTMLIFrameElement | null = null;
let currentPopupAnchor: { el: HTMLElement; ariaExpanded: string | null; outline: string; outlineOffset: string; backgroundColor: string } | null = null;
let dismissHandler: ((e: MouseEvent) => void) | null = null;
let resizeMessageHandler: ((e: MessageEvent) => void) | null = null;

export interface OpenExtensionPopupOpts {
	extId: string;
	ctx: ExtensionContext;
	popupPath: string;
	anchorEl: HTMLElement;
	placement?: 'bottom-start' | 'right-start';
	highlightAnchor?: boolean;
}

export function openExtensionPopup(opts: OpenExtensionPopupOpts): void {
	closeExtensionPopup();

	const wrapper = document.createElement('div');
	wrapper.className = 'extension-popup-wrapper';
  Object.assign(wrapper.style, {
		position: 'fixed',
		zIndex: '2147483647',
		boxSizing: 'border-box',
		width: `${POPUP_WIDTH}px`,
		height: `${POPUP_MIN_HEIGHT}px`,
		maxHeight: `${POPUP_MAX_HEIGHT}px`,
    overflow: 'hidden',
    background: '#303030',
    border: '1px solid #555',
    borderRadius: '4px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
  } as Partial<CSSStyleDeclaration>);

  const status = document.createElement('div');
  status.className = 'extension-popup-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading extension…';
  Object.assign(status.style, {
    position: 'absolute', inset: '0', zIndex: '1', display: 'grid',
    placeItems: 'center', padding: '16px', textAlign: 'center',
    color: '#aaa',
    background: '#303030',
    font: '13px/1.5 system-ui, sans-serif',
  } as Partial<CSSStyleDeclaration>);

	positionWrapper(wrapper, opts.anchorEl, opts.placement);

  const iframe = document.createElement('iframe');
	iframe.style.width = '100%';
	iframe.style.height = '100%';
	iframe.style.display = 'block';
	iframe.style.border = 'none';
	iframe.style.background = '#303030';
	iframe.dataset['heliumPopupExtId'] = opts.extId;
	iframe.title = 'Extension popup';
	iframe.addEventListener('load', () => status.remove(), { once: true });
	wrapper.append(iframe, status);

	document.body.appendChild(wrapper);
	currentPopup = wrapper;
	currentPopupIframe = iframe;
	if (opts.highlightAnchor) highlightAnchor(opts.anchorEl);

	// Auto-size the wrapper to whatever the popup's document reports.
	// See `bootstrap/client.ts` — the popup bootstrap ResizeObserves
	// `documentElement` and postMessages `{__helium_popup_size__, w, h}`
	// on every layout change. We filter by iframe.contentWindow so a
	// second popup can't drive the size of the first one.
	resizeMessageHandler = (e: MessageEvent) => {
		if (!currentPopup || !currentPopupIframe) return;
		if (e.source !== currentPopupIframe.contentWindow) return;
		const data = e.data as { __helium_popup_size__?: unknown; w?: unknown; h?: unknown } | null;
		if (!data || data.__helium_popup_size__ !== true) return;
    const reportedWidth = typeof data.w === 'number' ? data.w : POPUP_WIDTH;
    const reportedHeight = typeof data.h === 'number' ? data.h : NaN;
    if (!Number.isFinite(reportedWidth) || reportedWidth <= 0 || !Number.isFinite(reportedHeight) || reportedHeight <= 0) return;
    const maxWidth = Math.max(160, window.innerWidth - POPUP_EDGE_MARGIN * 2);
    const width = Math.min(800, maxWidth, Math.max(220, Math.ceil(reportedWidth)));
    const maxHeight = Math.max(POPUP_MIN_HEIGHT, Math.min(POPUP_MAX_HEIGHT, window.innerHeight - POPUP_EDGE_MARGIN * 2));
    const height = Math.min(maxHeight, Math.max(POPUP_MIN_HEIGHT, Math.ceil(reportedHeight)));
    currentPopup.style.width = `${width}px`;
    currentPopup.style.height = `${height}px`;
		// Re-run positioning so a grown popup that overflows the
		// bottom edge flips above the anchor.
		positionWrapper(currentPopup, opts.anchorEl, opts.placement);
	};
	window.addEventListener('message', resizeMessageHandler);

	void spawnPopupFrame(iframe, opts)
		.then((channel) => {
			tryRegisterPopupWindow(opts.extId, iframe, channel);
			iframe.addEventListener('load', () => {
				tryRegisterPopupWindow(opts.extId, iframe, channel);
			}, { once: true });
			tryRegisterPopupTarget(opts.extId, iframe);
		})
      .catch((err) => {
        console.warn('[helium/popupHost] spawn failed:', err);
        status.setAttribute('role', 'alert');
        status.textContent = 'Could not open this extension popup.';
        status.style.color = 'var(--error-color, #f87171)';
      });

	dismissHandler = (e: MouseEvent) => {
		if (!wrapper.contains(e.target as Node) && !opts.anchorEl.contains(e.target as Node)) {
			closeExtensionPopup();
		}
	};
	setTimeout(() => {
		if (dismissHandler) document.addEventListener('click', dismissHandler);
	}, 0);
}

/**
 * Position `wrapper` relative to `anchorEl`, keeping the popup fully
 * inside the viewport. Prefers below the anchor, flips above if there
 * isn't room. Both dimensions clamp to `POPUP_EDGE_MARGIN` on all
 * sides so a popup near any viewport edge can't render off-screen.
 *
 * Reads `wrapper.style.height` if set (post-resize); falls back to the
 * initial compact-height placeholder for the initial placement.
 */
function positionWrapper(
  wrapper: HTMLDivElement,
  anchorEl: HTMLElement,
  placement: OpenExtensionPopupOpts['placement'] = 'bottom-start',
): void {
	const rect = anchorEl.getBoundingClientRect();
	const viewportH = window.innerHeight;
	const viewportW = window.innerWidth;

	const parsedH = parseInt(wrapper.style.height || '', 10);
  const currentH = Number.isFinite(parsedH) && parsedH > 0 ? parsedH : POPUP_MIN_HEIGHT;
  const parsedW = parseInt(wrapper.style.width || '', 10);
  const currentW = Number.isFinite(parsedW) && parsedW > 0 ? parsedW : POPUP_WIDTH;

	if (placement === 'right-start') {
		const spaceRight = viewportW - rect.right - POPUP_SIDEBAR_GAP;
		const spaceLeft = rect.left - POPUP_SIDEBAR_GAP;
		const left = spaceRight >= currentW || spaceRight >= spaceLeft
			? Math.min(rect.right + POPUP_SIDEBAR_GAP, viewportW - currentW - POPUP_EDGE_MARGIN)
			: Math.max(POPUP_EDGE_MARGIN, rect.left - currentW - POPUP_SIDEBAR_GAP);
		wrapper.style.left = `${left}px`;
		wrapper.style.top = `${Math.max(POPUP_EDGE_MARGIN, Math.min(rect.top, viewportH - currentH - POPUP_EDGE_MARGIN))}px`;
		wrapper.style.bottom = '';
		return;
	}

	// Vertical: try below anchor, flip above if no room, then clamp.
	// Clear whichever coordinate we're not using so re-positioning
	// after a resize doesn't leave both `top` and `bottom` set.
	const spaceBelow = viewportH - rect.bottom - POPUP_ANCHOR_GAP;
	const spaceAbove = rect.top - POPUP_ANCHOR_GAP;
	if (spaceBelow >= currentH || spaceBelow >= spaceAbove) {
		const top = Math.max(
			POPUP_EDGE_MARGIN,
			Math.min(rect.bottom + POPUP_ANCHOR_GAP, viewportH - currentH - POPUP_EDGE_MARGIN),
		);
		wrapper.style.top = `${top}px`;
		wrapper.style.bottom = '';
	} else {
		const bottom = Math.max(
			POPUP_EDGE_MARGIN,
			Math.min(viewportH - rect.top + POPUP_ANCHOR_GAP, viewportH - currentH - POPUP_EDGE_MARGIN),
		);
		wrapper.style.bottom = `${bottom}px`;
		wrapper.style.top = '';
	}

	// Horizontal: left-align to anchor, clamp to both viewport edges.
	const desiredLeft = rect.left;
	const left = Math.max(
		POPUP_EDGE_MARGIN,
    Math.min(desiredLeft, viewportW - currentW - POPUP_EDGE_MARGIN),
	);
	wrapper.style.left = `${left}px`;
}

function highlightAnchor(el: HTMLElement): void {
	currentPopupAnchor = {
		el,
		ariaExpanded: el.getAttribute('aria-expanded'),
		outline: el.style.outline,
		outlineOffset: el.style.outlineOffset,
		backgroundColor: el.style.backgroundColor,
	};
	el.setAttribute('aria-expanded', 'true');
	el.style.outline = '2px solid #fff';
	el.style.outlineOffset = '1px';
	el.style.backgroundColor = 'rgba(255,255,255,0.12)';
}

function restoreAnchor(): void {
	if (!currentPopupAnchor) return;
	const { el, ariaExpanded, outline, outlineOffset, backgroundColor } = currentPopupAnchor;
	if (ariaExpanded === null) el.removeAttribute('aria-expanded');
	else el.setAttribute('aria-expanded', ariaExpanded);
	el.style.outline = outline;
	el.style.outlineOffset = outlineOffset;
	el.style.backgroundColor = backgroundColor;
	currentPopupAnchor = null;
}

export function closeExtensionPopup(): void {
	if (!currentPopup) return;
	restoreAnchor();
	if (dismissHandler) {
		document.removeEventListener('click', dismissHandler);
		dismissHandler = null;
	}
	if (resizeMessageHandler) {
		window.removeEventListener('message', resizeMessageHandler);
		resizeMessageHandler = null;
	}
	currentPopupIframe = null;
	if (currentPopupOwner) {
		const owner = currentPopupOwner;
		const w = window as { extensions?: { unregisterPopupWindow?: (extId: string, win: Window) => void } };
		try {
			w.extensions?.unregisterPopupWindow?.(owner.extId, owner.win);
		} catch (err) {
			console.warn('[helium/popupHost] unregisterPopupWindow threw:', err);
		}
		try {
			const w2 = window as {
				extDevtools?: import('@apis/devtools/extensionManager').ExtensionDevToolsManager;
			};
			w2.extDevtools?.targetRegistry.unregister(owner.extId, 'popup');
		} catch (err) {
			console.warn('[helium/popupHost] unregister popup target threw:', err);
		}
		if (owner.channel) {
			try {
				owner.channel.close();
			} catch (err) {
				console.warn('[helium/popupHost] channel.close threw:', err);
			}
		}
		currentPopupOwner = null;
	}
	currentPopup.remove();
	currentPopup = null;
}

function tryRegisterPopupTarget(extId: string, iframe: HTMLIFrameElement): void {
	try {
		const w = window as {
			extDevtools?: import('@apis/devtools/extensionManager').ExtensionDevToolsManager;
		};
		if (!w.extDevtools) return;
		w.extDevtools.targetRegistry.register({
			extId,
			targetId: 'popup',
			kind: 'popup',
			iframe,
			label: 'Popup',
		});
	} catch (err) {
		console.warn('[helium/popupHost] register popup target threw:', err);
	}
}

function tryRegisterPopupWindow(
	extId: string,
	iframe: HTMLIFrameElement,
	channel: ExtensionBridgeChannel | null,
): void {
	const win = iframe.contentWindow;
	if (!win) return;
	if (currentPopupOwner && currentPopupOwner.win === win && currentPopupOwner.extId === extId) {
		return;
	}
	currentPopupOwner = { extId, win, channel };
	const w = window as { extensions?: { registerPopupWindow?: (extId: string, win: Window) => void } };
	try {
		w.extensions?.registerPopupWindow?.(extId, win);
	} catch (err) {
		console.warn('[helium/popupHost] registerPopupWindow threw:', err);
	}
}

/**
 * Spawn the Scramjet frame for the popup AND wire its
 * MessageChannel handshake so the popup's bootstrap can talk to the
 * host (so `chrome.runtime.sendMessage`, `chrome.storage.local.get`,
 * etc. actually work inside the popup realm).
 *
 * Returns the popup's ExtensionBridgeChannel so the caller can close
 * it when the popup is dismissed. May return null if the extension
 * is not currently running (no ctx → no plugin → no point).
 */
async function spawnPopupFrame(
	iframe: HTMLIFrameElement,
	opts: OpenExtensionPopupOpts,
): Promise<ExtensionBridgeChannel | null> {
	const w = window as {
		proxy?: { createFrame: (i: HTMLIFrameElement, o: unknown) => Promise<{ go: (url: string) => unknown }> };
		extensions?: {
			createExtensionPlugin?: (extId: string) => unknown;
			wireAuxiliaryViewChannel?: (
				ctx: ExtensionContext,
				iframe: HTMLIFrameElement,
				opts?: { isBackground: boolean },
			) => ExtensionBridgeChannel;
		};
	};

	if (!w.proxy?.createFrame) {
		console.warn('[helium/popupHost] proxy.createFrame unavailable');
		return null;
	}

	const url = `https://${opts.ctx.origin}/${opts.popupPath.replace(/^\/+/, '')}`;

	let plugin: unknown = null;
	try {
		plugin = w.extensions?.createExtensionPlugin?.(opts.extId) ?? null;
	} catch (err) {
		console.warn('[helium/popupHost] createExtensionPlugin threw:', err);
	}

	if (!plugin) {
		console.warn(
			'[helium/popupHost] no HeliumExtensionPlugin for extId=' +
				opts.extId +
				' — popup HTML will fail to load (extension not running?)',
		);
		return null;
	}

	let channel: ExtensionBridgeChannel | null = null;
	if (typeof w.extensions?.wireAuxiliaryViewChannel === 'function') {
		try {
			channel = w.extensions.wireAuxiliaryViewChannel(opts.ctx, iframe, { isBackground: false });
		} catch (err) {
			console.warn('[helium/popupHost] wireAuxiliaryViewChannel threw:', err);
		}
	} else {
		console.warn(
			'[helium/popupHost] window.extensions.wireAuxiliaryViewChannel unavailable — popup will load but `chrome.*` RPCs will hang',
		);
	}

	const frameOpts: { plugins?: unknown[] } = { plugins: [plugin] };
	const frame = await w.proxy.createFrame(iframe, frameOpts);
	frame.go(url);
	return channel;
}
