import type { ProxyTransport } from '@mercuryworkshop/proxy-transports';
import type * as ScramjetGlobal from '@mercuryworkshop/scramjet';
import type * as ScramjetControllerGlobal from '@mercuryworkshop/scramjet-controller';
import type { SearchEngineRegistry } from '@apis/searchEngines';
import type { CommandRegistry } from '@apis/commands';
import type { Omnibox } from '@browser/omnibox';
import type { CachePluginManager } from '@apis/cachePlugins';
import type { CaptchaManager } from '@apis/captcha';

declare global {
	const $scramjet: typeof ScramjetGlobal;
	const $scramjetController: typeof ScramjetControllerGlobal;
	interface Window {
		__scramjet$config: SJConfig;
		__scramjet$flags: SJFlags;
		/** Set by src/terbium/boot.ts when running inside a Terbium TAPP — Wisp URL to use, takes precedence over settings. */
		__ddxOverrideWisp?: string;
		/** Set by src/terbium/boot.ts when running inside a Terbium TAPP — handle for the parent Terbium tb API. */
		__terbium?: { tb: unknown };
		/** Set by the Terbium boot integration when native media controls are available. */
		__ddxMediaMonitor?: import('./terbium/mediaIsland').MediaIslandMonitor;
		/** Set by the Terbium boot integration when native toasts are available. */
		__ddxNotify?: (message: string, options?: Record<string, unknown>) => void;
		__obscura: {
			ready: boolean;
			encode: (url: string) => string;
			decode: (url: string) => string;
		};
		$scramjet$wrap: Function;
		nightmare: Nightmare;
		settings: SettingsAPI;
		searchEngines: SearchEngineRegistry;
		commands: CommandRegistry;
		omnibox: Omnibox;
		cache: CacheAPI;
		// New host-side HTTP cache management — distinct from `cache`
		// (which is the legacy tab session cache in `src/apis/cache.ts`).
		// See `src/apis/cachePlugins/` and the spec at
		// `docs/superpowers/specs/2026-06-06-opfs-cache-plugin-system-design.md`.
		cachePlugins: CachePluginManager;
		// Night+ captcha plugin manager — see `src/apis/captcha/` and
		// `docs/superpowers/specs/2026-06-07-night-plus-captcha-plugin-design.md`.
		captcha: CaptchaManager;
		eventsAPI: EventSystem;
		extensions: ExtensionsAPI;
		proxy: Proxy;
		protocols: Protocols;
		logging: Logger;
		profiles: ProfilesAPI;
		globals: DDXGlobal;
		renderer: Render;
		items: Items;
		tabs: Tabs;
		windowing: Windowing;
		functions: Functions;
		keys: Keys;
		SWconfig: any;
		SWSettings: any;
		ProxySettings: string;
		devtools: import('@apis/devtools').DevToolsManager;
		nyxBridge?: import('@apis/nyxBridge').NyxBridge;
		liveInject?: any;
		codeInject?: any;
		d: ShadowRoot;
		downloadsManager?: import('@apis/downloads').DownloadsManager;
		sitePermissionsStore?: import('@apis/sitePermissions').SitePermissionsStore;
		downloadShelf?: import('@browser/downloads/shelf').DownloadShelf;
		lockDropdown?: import('@browser/sitePermissions/lockDropdown').LockDropdown;
		extensionToolbar?: import('@browser/extensions/toolbarButtons').ExtensionToolbarButtons;
		dnsResolver?: import('@apis/network/dns').DnsResolver;
	}

	interface SWConfig {
		file: string;
		config: any;
		func: Function;
	}

	interface SJConfig {
		prefix: string;
		injectPath: string;
		scramjetPath: string;
		virtualWasmPath: string;
		wasmPath: string;
		codec: {
			encode: (url: string) => string;
			decode: (url: string) => string;
		};
	}

	interface SJFlags {
		globals: {
			wrapfn: string;
			wrappropertybase: string;
			wrappropertyfn: string;
			cleanrestfn: string;
			importfn: string;
			rewritefn: string;
			metafn: string;
			wrappostmessagefn: string;
			pushsourcemapfn: string;
			trysetfn: string;
			templocid: string;
			tempunusedid: string;
		};
		flags: {
			syncxhr: boolean;
			strictRewrites: boolean;
			rewriterLogs: boolean;
			captureErrors: boolean;
			cleanErrors: boolean;
			scramitize: boolean;
			sourcemaps: boolean;
			destructureRewrites: boolean;
			allowInvalidJs: boolean;
			debugTrampolines: boolean;
			allowFailedIntercepts: boolean;
			encapsulateWorkers: boolean;
			debugSourceURL: boolean;
		};
		siteFlags: Record<string, any>;
		maskedfiles: string[];
	}

	interface SJController {
		id: string;
		config: SJConfig;
		scramjetConfig: SJFlags;
		frames: ScramjetControllerGlobal.Frame[];
		serviceWorkerController: ServiceWorker | null;
		rpc: any;
		transport: ProxyTransport | null;
	}
}

export {};
