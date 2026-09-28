import { createNyxBridge } from '@apis/nyxBridge';
import { ExtensionManager } from '@apis/extensions';
import { Omnibox } from '@browser/omnibox';
import { Functions } from '@browser/functions';
import { resolvePath } from '@utils/basepath';
import type { BootReadiness } from './readiness';
import type { BackgroundResult } from './backgroundInit';
import type { Proxy } from '@apis/proxy';
import type { Protocols } from '@browser/protocols';
import type { Items } from '@browser/items';
import type { Tabs } from '@browser/tabs';

interface FeatureInitDeps {
	tabs: Tabs;
	proto: Protocols;
	items: Items;
	proxy: Proxy;
	swConfig: Record<string, any>;
	proxySetting: string;
}

export async function featureInit(
	readiness: BootReadiness,
	bgPromise: Promise<BackgroundResult>,
	deps: FeatureInitDeps,
): Promise<void> {
	const { tabs, proto, items, proxy, swConfig, proxySetting } = deps;
	const { settingsAPI, searchEngines } = await bgPromise;

	const nyxBridge = createNyxBridge({
		tabs: window.tabs,
		proxy: window.proxy,
		settings: window.settings,
	});
	await nyxBridge.init();
	window.nyxBridge = nyxBridge;

	const extensionManager = new ExtensionManager(
		window.proxy,
		nyxBridge.getHandlerContext(),
	);

	const { ExtensionUrlOverrides } = await import('@apis/extensions/urlOverrides');
	const urlOverrides = new ExtensionUrlOverrides(proto);
	extensionManager.setUrlOverrides(urlOverrides);

	await extensionManager.init();
	(window as any).extensions = extensionManager;
	(window as any).extensionUrlOverrides = urlOverrides;
	readiness.resolveExtensions();

	await urlOverrides.applyAll((extId) => extensionManager.getManifest(extId));

	try {
		const { ExtensionToolbarButtons } = await import('@browser/extensions/toolbarButtons');
		const toolbar = new ExtensionToolbarButtons();
		const tryMount = (): void => {
			if (!toolbar.install()) requestAnimationFrame(tryMount);
		};
		tryMount();
		(window as any).extensionToolbar = toolbar;
	} catch (err) {
		console.warn('[boot] extension toolbar mount failed:', err);
	}

	try {
		const { DownloadShelf } = await import('@browser/downloads/shelf');
		const shelf = new DownloadShelf();
		const tryMount = (): void => {
			if (!shelf.install()) requestAnimationFrame(tryMount);
		};
		tryMount();
		window.downloadShelf = shelf;
	} catch (err) {
		console.warn('[boot] download shelf mount failed:', err);
	}

	try {
		const { LockDropdown } = await import('@browser/sitePermissions/lockDropdown');
		const lock = new LockDropdown();
		const tryMount = (): void => {
			if (!lock.install()) requestAnimationFrame(tryMount);
		};
		tryMount();
		window.lockDropdown = lock;
	} catch (err) {
		console.warn('[boot] lock dropdown mount failed:', err);
	}

	const startupBehavior =
		(await settingsAPI.getItem('startupBehavior')) || 'newtab';
	const startupCustomUrl =
		(await settingsAPI.getItem('startupCustomUrl')) || '';

	if (startupBehavior === 'restore') {
		const restored = await window.tabs.restoreSession();
		// If no persisted session exists (fresh install / cleared cache),
		// fall back to a new tab so the app never boots into a zero-tab
		// state — which leaves the shell rendered but content-less.
		if (!restored) window.tabs.createTab('ddx://newtab/');
	} else if (startupBehavior === 'custom' && startupCustomUrl) {
		window.tabs.createTab(startupCustomUrl);
	} else {
		// Default (startupBehavior === 'newtab' or unset): create the initial
		// newtab. Without this, `startupBehavior === 'newtab'` was a no-op and
		// the app came up with zero tabs (visible only under bootstrap /
		// fresh-install where no session was persisted).
		window.tabs.createTab('ddx://newtab/');
	}

	const functions = new Functions(tabs, proto);
	await functions.initPromise;
	await functions.init();
	window.functions = functions;

	if (
		proxySetting === 'sj' &&
		swConfig[proxySetting as keyof typeof swConfig] &&
		typeof swConfig[proxySetting as keyof typeof swConfig].func ===
			'function'
	) {
		await (
			swConfig[proxySetting as keyof typeof swConfig].func as Function
		)();
	}

	let proxyReadyPromise: Promise<void> | null = null;
	const ensureProxyReady = async (): Promise<void> => {
		if (!proxyReadyPromise) {
			proxyReadyPromise = (async () => {
				await proxy.registerSW(swConfig[proxySetting as keyof typeof swConfig]);
				await proxy.setTransports();
				const transport = await proxy.getTransports().then(transports => transports.active);
				if (transport == null) {
					await proxy.setTransports();
				}
				readiness.resolveProxy();
			})().catch(err => {
				proxyReadyPromise = null;
				throw err;
			});
		}

		await proxyReadyPromise;
	};

	const searchBar = items.addressBar;

	searchBar!.addEventListener('keydown', async e => {
		if (e.key === 'Enter') {
			if ((e as any).__omniboxConsumed) return;
			e.preventDefault();

			const searchValue = searchBar!.value.trim();

			if (proto.isRegisteredProtocol(searchValue)) {
				const url =
					(await proto.processUrl(searchValue)) ||
					resolvePath('internal/error/');
				const iframe = items.frameContainer!.querySelector(
					'iframe.active'
				) as HTMLIFrameElement | null;

				if (iframe) {
					iframe.setAttribute('src', url);
				} else {
					console.warn('No active iframe found for navigation');
				}
			} else {
				const swConfigSettings =
					swConfig[proxySetting as keyof typeof swConfig];
				window.SWSettings = swConfigSettings;

				if (!swConfigSettings || !swConfigSettings.config) {
					console.warn(
						'[urlbar] No swConfig for proxySetting',
						proxySetting
					);
					return;
				}

				const activeIframe = document.querySelector(
					'iframe.active'
				) as HTMLIFrameElement | null;

				if (activeIframe) {
					await proxy.redirect(
						swConfig,
						proxySetting,
						searchValue,
						activeIframe
					);
					readiness.resolveProxy();
				} else {
					await ensureProxyReady();
					const prefix =
						swConfigSettings.config?.prefix ?? '/~/sj/';
					const encodedUrl =
						prefix +
						proxy.encodeUrl(proxy.search(searchValue));
					tabs.createTab(location.origin + encodedUrl);
				}
			}
		}
	});

	{
		const { KeybindManager } = await import('@browser/functions/keybinds');
		const km = new KeybindManager(settingsAPI);
		await km.loadKeybinds();
		window.commands.seedFromKeybinds({
			keybinds: km.getAllKeybinds(),
			formatKeybind: (kb) => km.formatKeybind(kb),
			tabs,
			protocols: proto,
		});
		window.commands.seedFromProtocols(proto.listRoutes(), (url) => proto.navigate(url));
		window.commands.seedBuiltins({ tabs, protocols: proto });
	}

	if (items.addressBar) {
		const omnibox = new Omnibox({
			input: items.addressBar,
			proxy,
			protocols: proto,
			tabs,
			searchEngines,
			commands: window.commands,
			swConfig,
			proxySetting,
		});
		omnibox.attach();
		window.omnibox = omnibox;
	}
}
