/**
 * Terbium App Island menu for Daydream.
 *
 * Adds a single control labelled "Daydream" to Terbium's App Island.
 * Clicking it opens a context menu with shortcuts to common internal
 * pages (bookmarks, history, downloads, settings) and new-tab actions.
 *
 * All Terbium API calls are feature-detected — if Terbium changes or
 * removes any of these surfaces, the integration silently skips that
 * specific feature without breaking the rest of Daydream.
 */

const TAG = '[terbium/island]';
const CONTROL_ID = 'daydream_menu';

interface DaydreamGlobals {
	tabs?: { createTab: (url: string) => void; activeTabId?: string | null };
	protocols?: { navigate: (url: string) => void };
	windowing?: { newWindow: () => void };
	devtools?: { toggle: (tabId: string) => void };
}

function openInternal(page: string): void {
	const g = globalThis as unknown as DaydreamGlobals;
	// Prefer the protocols API (handles ddx://... URLs uniformly)
	if (g.protocols?.navigate) {
		g.protocols.navigate(`ddx://${page}/`);
		return;
	}
	// Fall back to creating a new tab with the internal URL
	if (g.tabs?.createTab) {
		g.tabs.createTab(`ddx://${page}/`);
	}
}

function newTab(opts: { incognito?: boolean } = {}): void {
	const g = globalThis as unknown as DaydreamGlobals;
	if (!g.tabs?.createTab) return;
	const url = opts.incognito ? 'ddx://newtab/?incognito=1' : 'ddx://newtab/';
	g.tabs.createTab(url);
}

export function installIsland(tb: any): void {
	if (!tb?.window?.island?.addControl || !tb?.contextmenu?.create) {
		console.warn(
			TAG,
			'tb.window.island or tb.contextmenu missing — skipping install'
		);
		return;
	}

	try {
		tb.window.island.addControl({
			text: 'Daydream',
			appname: 'Daydream',
			id: CONTROL_ID,
			click: () => {
				const appIsland =
					(typeof window !== 'undefined' &&
						window.parent?.document?.querySelector(
							'.app_island'
						)) as HTMLElement | undefined;
				const y = (appIsland?.clientHeight ?? 32) + 12;

				tb.contextmenu.create({
					x: 6,
					y,
					iframe: false,
					options: [
						{ text: 'New Tab', click: () => newTab() },
						{ text: 'New Window', click: () => (globalThis as unknown as DaydreamGlobals).windowing?.newWindow() },
						{
							text: 'New Incognito Tab',
							click: () => newTab({ incognito: true })
						},
						null,
						{
							text: 'Bookmarks',
							click: () => openInternal('bookmarks')
						},
						{
							text: 'History',
							click: () => openInternal('history')
						},
						{
							text: 'Downloads',
							click: () => openInternal('downloads')
						},
						{ text: 'Extensions', click: () => openInternal('extensions') },
						null,
						{
							text: 'Settings',
							click: () => openInternal('settings')
						},
						{
							text: 'DevTools',
							click: () => {
								const g = globalThis as unknown as DaydreamGlobals;
								if (g.tabs?.activeTabId) g.devtools?.toggle(g.tabs.activeTabId);
							}
						}
					]
				});
			}
		});

		// Cleanup on unload
		window.addEventListener('beforeunload', () => {
			try {
				tb.window.island.removeControl(CONTROL_ID);
			} catch {
				// parent already gone — swallow
			}
		});

		console.log(TAG, 'island control installed');
	} catch (err) {
		console.warn(TAG, 'install failed:', err);
	}
}
