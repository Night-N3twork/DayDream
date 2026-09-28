/**
 * Helium extension lifecycle + host-side RPC for the chrome.* surface.
 *
 * Owns the hidden iframe container, per-extension MessagePort
 * channels, and the handlers for async chrome.* methods. Delegates
 * browser-control methods (tabs.*) to NyxBridge's existing dispatch.
 *
 * Boot flow (see src/index.ts):
 *   1. new ExtensionManager(proxy, nyxBridge.getHandlerContext())
 *   2. await mgr.init() — hydrates from /extensions/_index.json and
 *      spawns each enabled extension.
 *
 * Lifecycle:
 *   - installFromBytes(crxBytes) → unpack + persist + spawn
 *   - uninstall(id) → kill iframe + delete TFS
 *   - setEnabled(id, true|false) → spawn or kill, persist flag
 */

import type { Proxy } from './proxy';
import { expandSearchTemplate } from './searchEngines';
import type { HandlerContext as NyxHandlerContext } from './nyxBridge/handlers';
import type { TabsInterface } from '@browser/tabs/types';
import {
  ActionHandlers,
  AlarmScheduler,
  AlarmsHandlers,
  BookmarksHandlers,
  CommandsHandlers,
  ContentScriptRelay,
  ContextMenuRegistry,
  ContextMenusHandlers,
  CookiesHandlers,
  DebuggerHandlers,
  DeclarativeContentHandlers,
  DevtoolsHandlers,
  DevtoolsPageHost,
  DnrEngineFacadeImpl,
  DnrHandlers,
  DnrStorage,
  DownloadsHandlers,
  ExtensionBridgeChannel,
  ExtensionHandlers,
  HeliumExtensionPlugin,
  HistoryHandlers,
  I18nHandlers,
  IdentityHandlers,
  IdleHandlers,
  ManagementHandlers,
  OffscreenHandlers,
  NotificationsHandlers,
  OmniboxHandlers,
  OmniboxRegistry,
  PermissionsHandlers,
  PortRouter,
  RuntimeHandlers,
  ScriptingHandlers,
  SidePanelHandlers,
  TabsHandlers,
  WebNavigationHandlers,
  WebRequestHandlers,
  WebRequestRegistry,
  WindowsHandlers,
  installBookmarkEventListeners,
  installContentScripts,
  installCookieEventListeners,
  installDownloadsEventListeners,
  installReadingListEventListeners,
  installExtension,
  getExtension,
  contentTypeFromPath,
  buildSwDnrUpdate,
  installHistoryEventListeners,
  installManagementEventListeners,
  installTabEventListeners,
  installWebNavigationEventListeners,
  installWebRequestEventRpc,
  installWindowEventListeners,
  listExtensions,
  loadExtensionsAtBoot,
  parseManifestRulesets,
  pushRulesToSw,
  readExtensionFile,
  registerCommandsForExtension,
  setExtensionEnabled as fsSetEnabled,
  uninstallContentScripts,
  uninstallExtension as fsUninstall,
  unpackExtension,
  writeExtensionFile,
  type ExtensionContext,
  type ExtensionIndexEntry,
  type LoadedExtension,
  type RegisteredCommandsHandle,
} from '@core/helium';
import { CookieAccessor } from './data/cookies';
import { installWebRequestHook } from '@core/helium/host/webRequest';
import { openExtensionPopup } from '@browser/extensions/popupHost';
import { ReadingListManager } from '@apis/readingList';
import { getDdxGroupId, hashGroupId } from '@apis/nyxBridge/tabResolver';
import { DDX_CHROME_BASELINE, isSupportedMinimumChromeVersion } from './extensions/versionGate';
import { sanitizeTabsForExtension } from './extensions/tabPermissions';
import { attachExtensionHandshakeWhenReady } from './extensions/handshake';
import { coverIdentity } from '@core/shared/build-runtime';

const CONTAINER_ID = '__helium_extensions__';
const SEND_MESSAGE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Map: chrome.* method name → required manifest permission.
 * `null` means "no permission needed" (chrome.runtime.* is always
 * available). Every handler in handlerImpls() MUST have an entry here
 * — checked at ExtensionManager construction.
 */
const HANDLER_PERMISSIONS: Record<string, string | null> = {
  'chrome.storage.local.get':    'storage',
  'chrome.storage.local.set':    'storage',
  'chrome.storage.local.remove': 'storage',
  'chrome.storage.local.clear':  'storage',
  'chrome.storage.local.getBytesInUse': 'storage',
  'chrome.storage.local.getKeys': 'storage',
  'chrome.storage.sync.get':     'storage',
  'chrome.storage.sync.set':     'storage',
  'chrome.storage.sync.remove':  'storage',
  'chrome.storage.sync.clear':   'storage',
  'chrome.storage.sync.getBytesInUse': 'storage',
  'chrome.storage.sync.getKeys': 'storage',
  'chrome.storage.session.get':    'storage',
  'chrome.storage.session.set':    'storage',
  'chrome.storage.session.remove': 'storage',
  'chrome.storage.session.clear':  'storage',
  'chrome.storage.session.getBytesInUse': 'storage',
  'chrome.storage.session.getKeys':       'storage',
  'chrome.storage.managed.get':           'storage',
  'chrome.storage.managed.getBytesInUse': 'storage',

  'chrome.runtime.sendMessage':  null,
  'chrome.runtime.getBackgroundPage': null,
  'chrome.runtime.getPlatformInfo':   null,
  'chrome.runtime.getPackageDirectoryEntry': null,
  'chrome.runtime.requestUpdateCheck':       null,
  'chrome.runtime.reload':                   null,
  'chrome.runtime.setUninstallURL':          null,
  'chrome.runtime.openOptionsPage':          null,
  'chrome.runtime.connectNative':            null,
  'chrome.runtime.sendNativeMessage':        null,

  'chrome.extension.getBackgroundPage':        null,
  'chrome.extension.getViews':                 null,
  'chrome.extension.getURL':                   null,
  'chrome.extension.isAllowedIncognitoAccess': null,
  'chrome.extension.isAllowedFileSchemeAccess':null,

  'chrome.scripting.executeScript':                  'scripting',
  'chrome.scripting.insertCSS':                      'scripting',
  'chrome.scripting.removeCSS':                      'scripting',
  'chrome.scripting.registerContentScripts':         'scripting',
  'chrome.scripting.unregisterContentScripts':       'scripting',
  'chrome.scripting.getRegisteredContentScripts':    'scripting',
  'chrome.scripting.updateContentScripts':           'scripting',

  'chrome.tabs.executeScript':                       'tabs',
  'chrome.tabs.insertCSS':                           'tabs',
  'chrome.tabs.removeCSS':                           'tabs',

  'chrome.tabs.query':           null,
  'chrome.tabs.get':             'tabs',
  'chrome.tabs.getCurrent':      'tabs',
  'chrome.tabs.create':          'tabs',
  'chrome.tabs.update':          'tabs',
  'chrome.tabs.remove':          'tabs',
  'chrome.tabs.duplicate':       'tabs',
  'chrome.tabs.reload':          'tabs',
  'chrome.tabs.goBack':          'tabs',
  'chrome.tabs.goForward':       'tabs',
  'chrome.tabs.captureVisibleTab': 'tabs',
  'chrome.tabs.move':            'tabs',
  'chrome.tabs.group':           'tabs',
  'chrome.tabs.ungroup':         'tabs',
  'chrome.tabs.detectLanguage':  'tabs',
  'chrome.tabs.discard':         'tabs',
  'chrome.tabs.highlight':       'tabs',
  'chrome.tabs.getZoom':         'tabs',
  'chrome.tabs.setZoom':         'tabs',
  'chrome.tabs.getZoomSettings': 'tabs',
  'chrome.tabs.setZoomSettings': 'tabs',
  'chrome.tabs.toggleReaderMode': 'tabs',
  'chrome.tabs.sendMessage':     'tabs',

  'chrome.windows.get':            null,
  'chrome.windows.getCurrent':     null,
  'chrome.windows.getLastFocused': null,
  'chrome.windows.getAll':         null,
  'chrome.windows.create':         null,
  'chrome.windows.update':         null,
  'chrome.windows.remove':         null,

  'chrome.alarms.create':   'alarms',
  'chrome.alarms.get':      'alarms',
  'chrome.alarms.getAll':   'alarms',
  'chrome.alarms.clear':    'alarms',
  'chrome.alarms.clearAll': 'alarms',

  'chrome.bookmarks.get':         'bookmarks',
  'chrome.bookmarks.getChildren': 'bookmarks',
  'chrome.bookmarks.getRecent':   'bookmarks',
  'chrome.bookmarks.getTree':     'bookmarks',
  'chrome.bookmarks.getSubTree':  'bookmarks',
  'chrome.bookmarks.search':      'bookmarks',
  'chrome.bookmarks.create':      'bookmarks',
  'chrome.bookmarks.move':        'bookmarks',
  'chrome.bookmarks.update':      'bookmarks',
  'chrome.bookmarks.remove':      'bookmarks',
  'chrome.bookmarks.removeTree':  'bookmarks',

  'chrome.history.search':      'history',
  'chrome.history.getVisits':   'history',
  'chrome.history.addUrl':      'history',
  'chrome.history.deleteUrl':   'history',
  'chrome.history.deleteRange': 'history',
  'chrome.history.deleteAll':   'history',

  'chrome.cookies.get':                'cookies',
  'chrome.cookies.getAll':             'cookies',
  'chrome.cookies.set':                'cookies',
  'chrome.cookies.remove':             'cookies',
  'chrome.cookies.getAllCookieStores': 'cookies',

  'chrome.i18n.getMessage':         null,
  'chrome.i18n.getUILanguage':      null,
  'chrome.i18n.getAcceptLanguages': null,
  'chrome.i18n.detectLanguage':     null,

  'chrome.webNavigation.getFrame':     'webNavigation',
  'chrome.webNavigation.getAllFrames': 'webNavigation',

  'chrome.action.setTitle': null,
  'chrome.action.getTitle': null,
  'chrome.action.setPopup': null,
  'chrome.action.getPopup': null,
  'chrome.action.setBadgeText': null,
  'chrome.action.getBadgeText': null,
  'chrome.action.setBadgeBackgroundColor': null,
  'chrome.action.getBadgeBackgroundColor': null,
  'chrome.action.setBadgeTextColor': null,
  'chrome.action.getBadgeTextColor': null,
  'chrome.action.setIcon': null,
  'chrome.action.enable': null,
  'chrome.action.disable': null,
  'chrome.action.isEnabled': null,
  'chrome.action.openPopup': null,
  'chrome.action.getUserSettings': null,
  'chrome.browserAction.setTitle': null,
  'chrome.browserAction.getTitle': null,
  'chrome.browserAction.setPopup': null,
  'chrome.browserAction.getPopup': null,
  'chrome.browserAction.setBadgeText': null,
  'chrome.browserAction.getBadgeText': null,
  'chrome.browserAction.setBadgeBackgroundColor': null,
  'chrome.browserAction.getBadgeBackgroundColor': null,
  'chrome.browserAction.setBadgeTextColor': null,
  'chrome.browserAction.getBadgeTextColor': null,
  'chrome.browserAction.setIcon': null,
  'chrome.browserAction.enable': null,
  'chrome.browserAction.disable': null,
  'chrome.browserAction.isEnabled': null,
  'chrome.browserAction.openPopup': null,
  'chrome.browserAction.getUserSettings': null,
  'chrome.pageAction.show': null,
  'chrome.pageAction.hide': null,
  'chrome.pageAction.setTitle': null,
  'chrome.pageAction.getTitle': null,
  'chrome.pageAction.setPopup': null,
  'chrome.pageAction.getPopup': null,
  'chrome.pageAction.setIcon': null,

  'chrome.commands.getAll': null,

  'chrome.notifications.create':             'notifications',
  'chrome.notifications.update':             'notifications',
  'chrome.notifications.clear':              'notifications',
  'chrome.notifications.getAll':             'notifications',
  'chrome.notifications.getPermissionLevel': 'notifications',

  'chrome.contextMenus.create':    'contextMenus',
  'chrome.contextMenus.update':    'contextMenus',
  'chrome.contextMenus.remove':    'contextMenus',
  'chrome.contextMenus.removeAll': 'contextMenus',
  'chrome.menus.create':    'contextMenus',
  'chrome.menus.update':    'contextMenus',
  'chrome.menus.remove':    'contextMenus',
  'chrome.menus.removeAll': 'contextMenus',

  'chrome.omnibox.setDefaultSuggestion': null,

  'chrome.webRequest.handlerBehaviorChanged': 'webRequest',

  'chrome.declarativeNetRequest.updateDynamicRules':       'declarativeNetRequest',
  'chrome.declarativeNetRequest.getDynamicRules':          'declarativeNetRequest',
  'chrome.declarativeNetRequest.updateSessionRules':       'declarativeNetRequest',
  'chrome.declarativeNetRequest.getSessionRules':          'declarativeNetRequest',
  'chrome.declarativeNetRequest.updateEnabledRulesets':    'declarativeNetRequest',
  'chrome.declarativeNetRequest.getEnabledRulesets':       'declarativeNetRequest',
  'chrome.declarativeNetRequest.getAvailableStaticRules':  'declarativeNetRequest',
  'chrome.declarativeNetRequest.getAvailableStaticRuleCount': 'declarativeNetRequest',
  'chrome.declarativeNetRequest.getDisabledRuleIds':       'declarativeNetRequest',
  'chrome.declarativeNetRequest.updateStaticRules':        'declarativeNetRequest',
  'chrome.declarativeNetRequest.setExtensionActionOptions':'declarativeNetRequest',
  'chrome.declarativeNetRequest.getMatchedRules':          'declarativeNetRequestFeedback',
  'chrome.declarativeNetRequest.isRegexSupported':         'declarativeNetRequest',
  'chrome.declarativeNetRequest.testMatchOutcome':         'declarativeNetRequest',

  'chrome.devtools.panels.create':                                   null,
  'chrome.devtools.panels.elements.createSidebarPane':               null,
  'chrome.devtools.panels.sources.createSidebarPane':                null,
  'chrome.devtools.panels.setOpenResourceHandler':                   null,
  'chrome.devtools.inspectedWindow.tabId':                           null,
  'chrome.devtools.inspectedWindow.eval':                            null,
  'chrome.devtools.inspectedWindow.reload':                          null,
  'chrome.devtools.inspectedWindow.getResources':                    null,
  'chrome.devtools.network.getHAR':                                  null,

  'chrome.permissions.getAll':   null,
  'chrome.permissions.contains': null,
  'chrome.permissions.request':  null,
  'chrome.permissions.remove':   null,

  'chrome.sidePanel.setOptions':       'sidePanel',
  'chrome.sidePanel.getOptions':       'sidePanel',
  'chrome.sidePanel.setPanelBehavior': 'sidePanel',
  'chrome.sidePanel.getPanelBehavior': 'sidePanel',
  'chrome.sidePanel.open':             'sidePanel',

  'chrome.downloads.download':          'downloads',
  'chrome.downloads.search':            'downloads',
  'chrome.downloads.pause':             'downloads',
  'chrome.downloads.resume':            'downloads',
  'chrome.downloads.cancel':            'downloads',
  'chrome.downloads.remove':            'downloads',
  'chrome.downloads.erase':             'downloads',
  'chrome.downloads.open':              'downloads',
  'chrome.downloads.show':              'downloads',
  'chrome.downloads.showDefaultFolder': 'downloads',
  'chrome.downloads.acceptDanger':      'downloads',
  'chrome.downloads.setShelfEnabled':   'downloads',

  'chrome.identity.getAuthToken':             'identity',
  'chrome.identity.getProfileUserInfo':       'identity',
  'chrome.identity.launchWebAuthFlow':        'identity',
  'chrome.identity.removeCachedAuthToken':    'identity',
  'chrome.identity.clearAllCachedAuthTokens': 'identity',
  'chrome.identity.getAccounts':              'identity',
  'chrome.identity.getRedirectURL':           'identity',

  'chrome.management.getAll':                          'management',
  'chrome.management.get':                             'management',
  'chrome.management.getSelf':                         null,
  'chrome.management.setEnabled':                      'management',
  'chrome.management.uninstall':                       'management',
  'chrome.management.uninstallSelf':                   'management',
  'chrome.management.getPermissionWarningsById':       'management',
  'chrome.management.getPermissionWarningsByManifest': 'management',
  'chrome.management.launchApp':                       'management',
  'chrome.management.createAppShortcut':               'management',
  'chrome.management.setLaunchType':                   'management',
  'chrome.management.generateAppForLink':              'management',

  'chrome.idle.queryState':            'idle',
  'chrome.idle.setDetectionInterval':  'idle',

  'chrome.runtime.getContexts':        null,

  'chrome.offscreen.createDocument':  'offscreen',
  'chrome.offscreen.closeDocument':   'offscreen',
  'chrome.offscreen.hasDocument':     'offscreen',

  'chrome.search.query':              null,

  'chrome.sessions.getDevices':         'sessions',
  'chrome.sessions.getRecentlyClosed':  'sessions',
  'chrome.sessions.restore':            'sessions',

  'chrome.topSites.get':                null,

  'chrome.browsingData.remove':         'browsingData',
  'chrome.browsingData.removeAppcache': 'browsingData',
  'chrome.browsingData.removeCache':       'browsingData',
  'chrome.browsingData.removeCacheStorage':'browsingData',
  'chrome.browsingData.removeCookies':   'browsingData',
  'chrome.browsingData.removeDownloads': 'browsingData',
  'chrome.browsingData.removeFileSystems':'browsingData',
  'chrome.browsingData.removeFormData':  'browsingData',
  'chrome.browsingData.removeHistory':   'browsingData',
  'chrome.browsingData.removeIndexedDB': 'browsingData',
  'chrome.browsingData.removeLocalStorage':'browsingData',
  'chrome.browsingData.removePasswords':  'browsingData',
  'chrome.browsingData.removePluginData': 'browsingData',
  'chrome.browsingData.removeServiceWorkers':'browsingData',
  'chrome.browsingData.removeWebSQL':    'browsingData',
  'chrome.browsingData.settings':        'browsingData',

  'chrome.tabGroups.get':    'tabGroups',
  'chrome.tabGroups.move':   'tabGroups',
  'chrome.tabGroups.query':  'tabGroups',
  'chrome.tabGroups.update': 'tabGroups',

  'chrome.readingList.addEntry':    'readingList',
  'chrome.readingList.query':       'readingList',
  'chrome.readingList.removeEntry': 'readingList',
  'chrome.readingList.updateEntry': 'readingList',

  'chrome.dns.resolve':             null,

  'chrome.debugger.attach':         'debugger',
  'chrome.debugger.detach':         'debugger',
  'chrome.debugger.sendCommand':    'debugger',
  'chrome.debugger.getTargets':     'debugger',

  'chrome.declarativeContent.addRules':    'declarativeContent',
  'chrome.declarativeContent.removeRules': 'declarativeContent',
  'chrome.declarativeContent.getRules':    'declarativeContent',
};

const KNOWN_API_PERMS = [
  'storage',
  'tabs',
  'activeTab',
  'notifications',
  'webRequest',
  'webRequestBlocking',
  'cookies',
  'history',
  'bookmarks',
  'scripting',
  'alarms',
  'commands',
  'contextMenus',
  'menus',                  // alias for contextMenus
  'declarativeNetRequest',
  'declarativeNetRequestFeedback',
  'declarativeNetRequestWithHostAccess',
  'webNavigation',
  'identity',
  'downloads',
  'management',
  'sidePanel',
  'i18n',                   // auto-granted
  'permissions',            // for chrome.permissions
  'idle',
  'offscreen',
  'sessions',
  'browsingData',
  'tabGroups',
  'system.cpu',
  'system.memory',
  'system.storage',
  'system.display',
  'readingList',
  'debugger',
  'declarativeContent',
];

interface SpawnedContext {
  id: string;
  ctx: ExtensionContext;
  entry: ExtensionIndexEntry;
  iframe: HTMLIFrameElement;
  channel: ExtensionBridgeChannel;
  plugin: HeliumExtensionPlugin;
}

export class ChromePermissionError extends Error {
  readonly requiredPerm: string;
  constructor(method: string, requiredPerm: string) {
    super(
      `The "${method}" API requires the "${requiredPerm}" permission, which is not declared in the manifest.`,
    );
    this.name = 'ChromePermissionError';
    this.requiredPerm = requiredPerm;
  }
}

function collectPermissions(manifest: any): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(manifest.permissions)) {
    for (const p of manifest.permissions) {
      if (typeof p === 'string' && KNOWN_API_PERMS.includes(p)) {
        out.add(p);
      }
    }
  }
  return out;
}

export class ExtensionManager {
  private readonly proxy: Proxy;
  private readonly nyxCtx: NyxHandlerContext;
  private readonly spawned: Map<string, SpawnedContext> = new Map();
  private container: HTMLDivElement | null = null;
  private readonly listeners: Map<string, Set<(id: string) => void>> = new Map();
  private contentScriptRelay: ContentScriptRelay | null = null;
  private portRouter: PortRouter | null = null;
  private scriptingHandlers: ScriptingHandlers | null = null;
  private readonly activeTabGrants: Map<string, Set<number>> = new Map();
  private activeTabListenersInstalled = false;

  private tabsHandlers: TabsHandlers | null = null;
  private windowsHandlers: WindowsHandlers | null = null;
  private alarmsHandlers: AlarmsHandlers | null = null;
  private alarmScheduler: AlarmScheduler | null = null;
  private runtimeHandlers: RuntimeHandlers | null = null;
  private extensionHandlers: ExtensionHandlers | null = null;
  private bookmarksHandlers: BookmarksHandlers | null = null;
  private historyHandlers: HistoryHandlers | null = null;
  private cookiesHandlers: CookiesHandlers | null = null;
  private i18nHandlers: I18nHandlers | null = null;
  private webNavigationHandlers: WebNavigationHandlers | null = null;
  public actionHandlers: ActionHandlers | null = null;

  private commandsHandlers: CommandsHandlers | null = null;
  private notificationsHandlers: NotificationsHandlers | null = null;
  private contextMenusHandlers: ContextMenusHandlers | null = null;
  public contextMenusRegistry: ContextMenuRegistry | null = null;
  private omniboxHandlers: OmniboxHandlers | null = null;
  public omniboxRegistry: OmniboxRegistry | null = null;
  private commandsRegistrations: Map<string, RegisteredCommandsHandle> = new Map();

  public webRequestRegistry: WebRequestRegistry | null = null;
  private webRequestHandlers: WebRequestHandlers | null = null;
  private readonly webRequestRpcCleanups: Map<string, () => void> = new Map();
  public dnrStorage: DnrStorage | null = null;
  private dnrHandlers: DnrHandlers | null = null;
  public dnrEngine: DnrEngineFacadeImpl | null = null;

  private devtoolsHandlers: DevtoolsHandlers | null = null;
  public devtoolsPageHost: DevtoolsPageHost | null = null;

  private readonly popupWindows: Map<string, Set<Window>> = new Map();

  private permissionsHandlers: PermissionsHandlers | null = null;
  private sidePanelHandlers: SidePanelHandlers | null = null;
  private downloadsHandlers: DownloadsHandlers | null = null;
  private identityHandlers: IdentityHandlers | null = null;
  private managementHandlers: ManagementHandlers | null = null;
  private idleHandlers: IdleHandlers | null = null;
  private offscreenHandlers: OffscreenHandlers | null = null;
  private debuggerHandlers: DebuggerHandlers | null = null;
  private declarativeContentHandlers: DeclarativeContentHandlers | null = null;

  private readonly eventCleanups: Array<() => void> = [];

  private readonly sessionStorage: Map<string, Record<string, unknown>> = new Map();
  private readonly managedStorageCache: Map<string, Record<string, unknown> | null> = new Map();

  private readonly iconCache: Map<string, string | null> = new Map();

  private urlOverrides: import('./extensions/urlOverrides').ExtensionUrlOverridesAPI | null = null;

  constructor(proxy: Proxy, nyxCtx: NyxHandlerContext) {
    this.proxy = proxy;
    this.nyxCtx = nyxCtx;
    for (const method of Object.keys(this.handlerImpls())) {
      if (!(method in HANDLER_PERMISSIONS)) {
        throw new Error(
          `[ExtensionManager] handler ${method} missing in HANDLER_PERMISSIONS`,
        );
      }
    }
  }

  /**
   * Install a coordinator for `chrome_url_overrides` so:
   *   - on install: if the manifest declares any overrides, the
   *     coordinator stages them as "pending" (the user confirms via UI).
   *   - on disable/uninstall: any active or pending slot owned by
   *     this extension is cleared.
   *
   * Also a way for the boot path to apply persisted active overrides
   * via `urlOverrides.applyAll(extId => manifest)`.
   *
   * Wired from src/index.ts after Protocols + ExtensionUrlOverrides
   * are both available. Always called BEFORE init() so the install/
   * remove hooks see it during initial spawn.
   */
  setUrlOverrides(
    api: import('./extensions/urlOverrides').ExtensionUrlOverridesAPI,
  ): void {
    this.urlOverrides = api;
  }

  /**
   * Read the manifest of a currently-spawned (or in-memory) extension.
   * Used by ExtensionUrlOverrides.applyAll to resolve extIds back to
   * manifests at boot.
   */
  getManifest(extId: string): import('@core/helium').ChromeManifest | import('@core/helium').FirefoxManifest | null {
    const s = this.spawned.get(extId);
    return s ? s.ctx.manifest : null;
  }

  async init(): Promise<void> {
    this.ensureContainer();
    this.contentScriptRelay = new ContentScriptRelay({
      getSpawnedContext: (extId) => {
        const s = this.spawned.get(extId);
        return s ? { ctx: s.ctx, entry: s.entry, channel: s.channel } : undefined;
      },
      runChromeHandler: (ctx, method, args) => this.runChromeHandler(ctx, method, args),
    });
    this.contentScriptRelay.install();
    this.portRouter = new PortRouter(this.contentScriptRelay, (extId) => {
      const s = this.spawned.get(extId);
      return s ? { ctx: s.ctx, entry: s.entry, channel: s.channel } : undefined;
    });
    this.scriptingHandlers = new ScriptingHandlers({
      nyxCtx: this.nyxCtx,
      relay: this.contentScriptRelay,
    });

    this.installActiveTabListeners();

    this.tabsHandlers = new TabsHandlers(this.nyxCtx);
    this.windowsHandlers = new WindowsHandlers(this.nyxCtx);
    this.alarmScheduler = new AlarmScheduler((extId, alarm) => {
      this.fireEventOn(extId, 'chrome.alarms.onAlarm', [alarm]);
    });
    this.alarmsHandlers = new AlarmsHandlers(this.alarmScheduler);
    this.runtimeHandlers = new RuntimeHandlers({
      getSpawnedById: (id) => {
        const s = this.spawned.get(id);
        return s ? { ctx: s.ctx, iframe: s.iframe } : undefined;
      },
      respawn: (id) => this.respawn(id),
      openTab: (url) => this.openTab(url),
    });
    this.extensionHandlers = new ExtensionHandlers({
      getSpawnedById: (id) => {
        const s = this.spawned.get(id);
        return s ? { ctx: s.ctx, iframe: s.iframe } : undefined;
      },
      getPopupWindows: (extId) => {
        const set = this.popupWindows.get(extId);
        if (!set) return [];
        return Array.from(set).filter((w) => {
          try { return !!w.document; } catch { return false; }
        });
      },
      getDevtoolsWindows: (extId) => {
        const host = this.devtoolsPageHost;
        if (!host) return [];
        return host.getActiveWindowsForExt(extId);
      },
    });
    this.bookmarksHandlers = new BookmarksHandlers();
    this.historyHandlers = new HistoryHandlers();
    const cookieAccessor = new CookieAccessor(this.proxy);
    this.cookiesHandlers = new CookiesHandlers(cookieAccessor);
    void import('@apis/siteData').then(({ SiteDataManager }) => {
      SiteDataManager.getInstance({ cookieAccessor }).setCookieAccessor(cookieAccessor);
    });
    this.i18nHandlers = new I18nHandlers();
    this.webNavigationHandlers = new WebNavigationHandlers(this.nyxCtx);
    this.actionHandlers = new ActionHandlers();

    this.commandsHandlers = new CommandsHandlers();
    this.notificationsHandlers = new NotificationsHandlers({
      getManager: () => {
        const w = window as {
          nightmare?: { notifications?: import('@pkgs/Nightmare/notifications').NotificationManager };
          ui?: { notifications?: import('@pkgs/Nightmare/notifications').NotificationManager };
        };
        return w.nightmare?.notifications ?? w.ui?.notifications ?? null;
      },
      fireEventOn: (extId, method, args) => this.fireEventOn(extId, method, args),
    });
    this.contextMenusRegistry = new ContextMenuRegistry();
    this.contextMenusHandlers = new ContextMenusHandlers(this.contextMenusRegistry);
    this.omniboxRegistry = new OmniboxRegistry();
    this.omniboxHandlers = new OmniboxHandlers(this.omniboxRegistry);

    this.webRequestRegistry = new WebRequestRegistry();
    this.webRequestHandlers = new WebRequestHandlers();
    this.dnrStorage = new DnrStorage();
    this.dnrEngine = new DnrEngineFacadeImpl(this.dnrStorage, {
      forEachActive: (cb) => {
        for (const s of this.spawned.values()) {
          const perms = collectPermissions(s.ctx.manifest);
          cb({
            ctx: s.ctx,
            hasDnrPermission: perms.has('declarativeNetRequest'),
          });
        }
      },
    });
    this.dnrHandlers = new DnrHandlers(this.dnrStorage, {
      getMatchedRulesFor: (extId, filter) =>
        this.dnrEngine!.getMatchedRulesFor(extId, filter),
    });
    try {
      const proxyAny = this.proxy as unknown as {
        initReady?: Promise<unknown>;
        controller?: unknown;
      };
      if (proxyAny.initReady) {
        await proxyAny.initReady;
      }
      const controller = proxyAny.controller;
      if (controller) {
        installWebRequestHook(controller, {
          registry: this.webRequestRegistry,
          dnr: this.dnrEngine,
          tabResolver: this.nyxCtx.tabResolver,
          onResponseObserver: (details) => {
            const dh = this.devtoolsHandlers;
            if (!dh) return;
            const headersToSimple = (h?: Array<{ name: string; value?: string; binaryValue?: number[] }>) =>
              h?.map((x) => ({ name: x.name, value: x.value ?? '' }));
            const onCompletedArgs: Parameters<DevtoolsHandlers['onWebRequestCompleted']>[0] = {
              url: details.url,
              method: details.method,
              tabId: details.tabId,
              type: details.type,
            };
            if (typeof details.statusCode === 'number')
              onCompletedArgs.statusCode = details.statusCode;
            if (typeof details.statusLine === 'string')
              onCompletedArgs.statusLine = details.statusLine;
            if (typeof details.timeStamp === 'number')
              onCompletedArgs.timeStamp = details.timeStamp;
            if (typeof details.ip === 'string') onCompletedArgs.ip = details.ip;
            const reqH = headersToSimple(details.requestHeaders);
            if (reqH) onCompletedArgs.requestHeaders = reqH;
            const resH = headersToSimple(details.responseHeaders);
            if (resH) onCompletedArgs.responseHeaders = resH;
            dh.onWebRequestCompleted(onCompletedArgs);
          },
        });
      } else {
        console.warn(
          '[ExtensionManager] proxy.controller missing after initReady; webRequest hook skipped',
        );
      }
    } catch (err) {
      console.warn('[ExtensionManager] webRequest hook install failed:', err);
    }

    this.devtoolsPageHost = new DevtoolsPageHost({
      proxy: this.proxy,
      tabIdToNum: (ddxId) => this.nyxCtx.tabResolver.toNum(ddxId),
    });
    this.devtoolsHandlers = new DevtoolsHandlers({
      getDevToolsManager: () => {
        const w = window as { devtools?: import('@apis/devtools').DevToolsManager };
        return w.devtools ?? null;
      },
      getProxy: () => this.proxy as unknown as {
        createFrame: (
          el: HTMLIFrameElement,
          opts: { plugins: unknown[] },
        ) => Promise<unknown>;
      },
      pageHost: this.devtoolsPageHost,
      numToDdxTabId: (n) => this.nyxCtx.tabResolver.toDdxId(n),
      reloadTab: async (ddxTabId, bypassCache) => {
        const tabsH = this.tabsHandlers;
        if (!tabsH) return;
        const n = this.nyxCtx.tabResolver.toNum(ddxTabId);
        await tabsH.reload(
          { id: '', manifestVersion: 3, manifest: {} as unknown as never, origin: '' },
          [n, { bypassCache }],
        );
      },
      fireOnShown: (extId, panelId) => {
        this.fireEventOn(extId, 'chrome.devtools.panels.ExtensionPanel.onShown', [
          { panelId },
        ]);
      },
      fireOnHidden: (extId, panelId) => {
        this.fireEventOn(extId, 'chrome.devtools.panels.ExtensionPanel.onHidden', [
          { panelId },
        ]);
      },
      fireRequestFinished: (extId, entry) => {
        this.fireEventOn(extId, 'chrome.devtools.network.onRequestFinished', [entry]);
      },
      fireNavigated: (extId, url) => {
        this.fireEventOn(extId, 'chrome.devtools.network.onNavigated', [url]);
      },
    });
    this.eventCleanups.push(this.installDevtoolsLifecycleHooks());

    // NOTE(helium-t1-3): the host handlers constructed below
    this.permissionsHandlers = new PermissionsHandlers({
      getPrompt: () => {
        const w = window as {
          nightmare?: { permissionPrompt?: import('@pkgs/Nightmare/permissionPrompt').PermissionPrompt };
          ui?: { permissionPrompt?: import('@pkgs/Nightmare/permissionPrompt').PermissionPrompt };
        };
        return w.nightmare?.permissionPrompt ?? w.ui?.permissionPrompt ?? null;
      },
      fireEventOn: (extId, method, args) => this.fireEventOn(extId, method, args),
    });
    this.sidePanelHandlers = new SidePanelHandlers();
    this.downloadsHandlers = new DownloadsHandlers();
    this.identityHandlers = new IdentityHandlers();
    this.managementHandlers = new ManagementHandlers({
      setEnabled: (id, enabled) => this.setEnabled(id, enabled),
      uninstall: (id) => this.uninstall(id),
    });
    this.idleHandlers = new IdleHandlers({
      fanoutEvent: (method, args, perm) => this.fanoutEvent(method, args, perm),
    });
    this.idleHandlers.install();
    this.offscreenHandlers = new OffscreenHandlers({
      proxy: this.proxy as unknown as { createFrame: (el: HTMLIFrameElement, opts: { plugins: unknown[] }) => Promise<{ go: (url: string) => void }> },
      createExtensionPlugin: (extId) => this.createExtensionPlugin(extId),
      wireAuxiliaryViewChannel: (ctx, iframe, opts) => this.wireAuxiliaryViewChannel(ctx, iframe, opts ?? { isBackground: false }),
    });
    {
      const cdp = (this.nyxCtx as unknown as { cdp?: import('./nyxBridge/cdp').CdpHelper }).cdp;
      if (cdp) {
        this.debuggerHandlers = new DebuggerHandlers({
          cdp,
          fanoutToExt: (extId, eventName, args) => this.fireEventOn(extId, eventName, args),
        });
        this.eventCleanups.push(
          cdp.onCdpEvent((tabId, method, params) => {
            this.debuggerHandlers?.onCdpEvent(tabId, method, params);
          }),
        );
        const onTabClosed = (e: Event): void => {
          const detail = (e as CustomEvent).detail as { tabId?: string } | undefined;
          if (!detail?.tabId) return;
          try {
            const n = this.nyxCtx.tabResolver.toNum(detail.tabId);
            this.debuggerHandlers?.onTabClosed(n);
            this.declarativeContentHandlers?.onTabClosed(n);
          } catch { /* swallow */ }
        };
        document.addEventListener('tabClosed', onTabClosed);
        this.eventCleanups.push(() =>
          document.removeEventListener('tabClosed', onTabClosed),
        );
      }
    }

    this.declarativeContentHandlers = new DeclarativeContentHandlers({
      pageActionShow: (extId, tabId) => {
        const ah = this.actionHandlers;
        if (!ah) return;
        const ctx = this.spawned.get(extId)?.ctx;
        if (!ctx) return;
        void ah.pageActionShow(ctx, [tabId]);
      },
      pageActionHide: (extId, tabId) => {
        const ah = this.actionHandlers;
        if (!ah) return;
        const ctx = this.spawned.get(extId)?.ctx;
        if (!ctx) return;
        void ah.pageActionHide(ctx, [tabId]);
      },
      setActionIcon: (extId, tabId, imageData) => {
        const ah = this.actionHandlers;
        if (!ah) return;
        const ctx = this.spawned.get(extId)?.ctx;
        if (!ctx) return;
        void ah.setIcon(ctx, [{ tabId, imageData }]);
      },
      probeCss: async (tabId, selectors) => {
        try {
          const tabResolver = this.nyxCtx.tabResolver;
          const iframe = tabResolver.resolveIframe(tabId);
          const win = iframe?.contentWindow as Window | null;
          if (!win) return false;
          const expr = `[${selectors.map((s) => JSON.stringify(s)).join(',')}].some(function(s){try{return document.querySelector(s)!=null}catch{return false}})`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return Boolean((win as any).eval(expr));
        } catch {
          return false;
        }
      },
    });

    {
      const reeval = (e: Event): void => {
        const detail = (e as CustomEvent).detail as { tabId?: string; phase?: string } | undefined;
        if (!detail?.tabId) return;
        if (detail.phase && detail.phase !== 'committed' && detail.phase !== 'completed') return;
        try {
          const num = this.nyxCtx.tabResolver.toNum(detail.tabId);
          const info = this.nyxCtx.tabResolver.info(num);
          const url = typeof info.url === 'string' ? info.url : '';
          if (!url) return;
          void this.declarativeContentHandlers?.evaluateForTab(num, url);
        } catch { /* swallow */ }
      };
      document.addEventListener('tabNavigated', reeval);
      document.addEventListener('tabSelected', reeval);
      this.eventCleanups.push(() => {
        document.removeEventListener('tabNavigated', reeval);
        document.removeEventListener('tabSelected', reeval);
      });
    }
    this.eventCleanups.push(
      installManagementEventListeners({
        on: (event, listener) => this.on(event, listener),
        off: (event, listener) => this.off(event, listener),
        fanoutEvent: (method, args, perm) => this.fanoutEvent(method, args, perm),
      }),
    );

    this.eventCleanups.push(
      installTabEventListeners({
        extMgr: this,
        tabResolver: this.nyxCtx.tabResolver,
      }),
    );
    this.eventCleanups.push(installWindowEventListeners(this));
    this.eventCleanups.push(installBookmarkEventListeners(this));
    this.eventCleanups.push(installHistoryEventListeners(this));
    this.eventCleanups.push(installCookieEventListeners(this));
    this.eventCleanups.push(installReadingListEventListeners(this));
    this.eventCleanups.push(installDownloadsEventListeners(this));
    this.eventCleanups.push(
      installWebNavigationEventListeners(this, this.nyxCtx.tabResolver),
    );

    console.log('[helium/extfs/dbg] [ExtensionManager.init] calling loadExtensionsAtBoot()...');
    const loaded = await loadExtensionsAtBoot();
    console.log(`[helium/extfs/dbg] [ExtensionManager.init] loadExtensionsAtBoot returned ${loaded.length} extension(s):`, loaded.map(l => ({ id: l.entry.id, name: l.entry.name, enabled: l.entry.enabled })));
    for (const ext of loaded) {
      console.log(`[helium/extfs/dbg] [ExtensionManager.init] spawning ${ext.entry.id} (${ext.entry.name})...`);
      try {
        await this.spawn(ext);
        console.log(`[helium/extfs/dbg] [ExtensionManager.init] spawned ${ext.entry.id} OK`);
      } catch (err) {
        console.warn(
          `[ExtensionManager] failed to spawn ${ext.entry.id}:`,
          err,
        );
      }
    }
    console.log(`[helium/extfs/dbg] [ExtensionManager.init] after spawn loop: ${this.spawned.size} extension(s) running`);
    for (const id of this.spawned.keys()) {
      try {
        await this.alarmScheduler.restoreForExt(id);
      } catch (err) {
        console.warn(`[ExtensionManager] alarm restore failed for ${id}:`, err);
      }
    }
  }

  async installFromBytes(bytes: Uint8Array): Promise<ExtensionIndexEntry> {
    console.log(`[helium/extfs/dbg] [ExtensionManager.installFromBytes] called with ${bytes.byteLength} bytes`);
    const unpacked = await unpackExtension(bytes);
    console.log(`[helium/extfs/dbg] [ExtensionManager.installFromBytes] unpack OK: id=${unpacked.id} format=${unpacked.format} files=${unpacked.files.size} name="${unpacked.manifest.name}"`);

    const minVer = (unpacked.manifest as { minimum_chrome_version?: string }).minimum_chrome_version;
    if (typeof minVer === 'string') {
      if (!isSupportedMinimumChromeVersion(minVer)) {
        throw new Error(
          `Extension requires Chrome ${minVer} or newer (${coverIdentity().product} baseline: ${DDX_CHROME_BASELINE}). Install rejected.`,
        );
      }
    }
    const prior = this.installLocks.get(unpacked.id);
    if (prior) {
      console.log(`[helium/extfs/dbg] [ExtensionManager.installFromBytes] chaining onto prior install for id=${unpacked.id}`);
    }
    const isTheme = (() => {
      try {
        return !!(unpacked.manifest as any).theme && typeof (unpacked.manifest as any).theme === "object";
      } catch { return false; }
    })();
    const run = async (): Promise<ExtensionIndexEntry> => {
      const entry = await installExtension(unpacked);
      console.log(`[helium/extfs/dbg] [ExtensionManager.installFromBytes] installExtension returned:`, entry);
      const ctx: ExtensionContext = {
        id: entry.id,
        manifestVersion: entry.manifestVersion,
        manifest: unpacked.manifest,
        origin: `${entry.id}.ddx`,
      };
      if (entry.enabled && !isTheme) {
        try {
          console.log(`[helium/extfs/dbg] [ExtensionManager.installFromBytes] spawning ${entry.id}...`);
          await this.spawn({ entry, manifest: unpacked.manifest, context: ctx });
          console.log(`[helium/extfs/dbg] [ExtensionManager.installFromBytes] spawn OK for ${entry.id}`);
        } catch (err) {
          console.warn(
            `[ExtensionManager] spawn after install failed for ${entry.id}:`,
            err,
          );
        }
      }
      console.log(`[helium/extfs/dbg] [ExtensionManager.installFromBytes] emitting 'installed' event for ${entry.id}`);
      this.emit('installed', entry.id);
      if (Date.now() - entry.installedAt < 1000 && entry.enabled) {
        this.fireEventOn(entry.id, 'chrome.runtime.onInstalled', [
          { reason: 'install' },
        ]);
      }
      if (this.urlOverrides) {
        try {
          await this.urlOverrides.onExtensionInstalled(entry.id, unpacked.manifest);
        } catch (err) {
          console.warn(
            `[ExtensionManager] urlOverrides.onExtensionInstalled failed for ${entry.id}:`,
            err,
          );
        }
      }
      try {
        const { chromeThemeAdapter, ChromeThemeAdapter } = await import("./extensions/chromeThemes");
        if (ChromeThemeAdapter.isThemeManifest(unpacked.manifest)) {
          await chromeThemeAdapter.onExtensionInstalled(
            entry.id,
            unpacked.manifest,
            unpacked.files,
          );
        }
      } catch (err) {
        console.warn(`[ExtensionManager] chromeTheme.install failed for ${entry.id}:`, err);
      }
      return entry;
    };

    const next: Promise<ExtensionIndexEntry> = prior
      ? prior.then(run, run)
      : run();
    this.installLocks.set(unpacked.id, next);
    try {
      return await next;
    } finally {
      if (this.installLocks.get(unpacked.id) === next) {
        this.installLocks.delete(unpacked.id);
      }
    }
  }

  /**
   * Per-extension install serialization. Concurrent calls to
   * installFromBytes for the same id queue rather than race. Without
   * this, two pasted installs of the same CRX both rmrf+rewrite the
   * tree concurrently, producing zero-byte manifest.json files.
   */
  private installLocks = new Map<string, Promise<ExtensionIndexEntry>>();

  async uninstall(id: string): Promise<void> {
    let wasTheme = false;
    try {
      const got = await getExtension(id);
      wasTheme = !!(got?.manifest as any)?.theme;
    } catch { /* ignore — best effort */ }
    try {
      await this.kill(id);
    } catch (err) {
      console.warn(`[ExtensionManager] kill(${id}) threw during uninstall:`, err);
    }
    try {
      await fsUninstall(id);
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      throw new Error(`Failed to remove extension files for ${id}: ${msg}`);
    }
    this.clearIconCache(id);
    this.emit('uninstalled', id);
    if (this.urlOverrides) {
      try {
        await this.urlOverrides.onExtensionRemoved(id);
      } catch (err) {
        console.warn(
          `[ExtensionManager] urlOverrides.onExtensionRemoved failed for ${id}:`,
          err,
        );
      }
    }
    try {
      const { chromeThemeAdapter } = await import("./extensions/chromeThemes");
      if (wasTheme) await chromeThemeAdapter.onExtensionRemoved(id);
    } catch (err) {
      console.warn(`[ExtensionManager] chromeTheme.remove failed for ${id}:`, err);
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await fsSetEnabled(id, enabled);
    if (enabled) {
      if (this.spawned.has(id)) return;
      const all = await loadExtensionsAtBoot();
      const target = all.find((e) => e.entry.id === id);
      if (target) {
        try {
          await this.spawn(target);
          this.fireEventOn(id, 'chrome.runtime.onStartup', []);
        } catch (err) {
          console.warn(
            `[ExtensionManager] spawn during setEnabled(${id}, true) failed:`,
            err,
          );
        }
      }
      this.emit('enabled', id);
    } else {
      await this.kill(id);
      this.emit('disabled', id);
      if (this.urlOverrides) {
        try {
          await this.urlOverrides.onExtensionRemoved(id);
        } catch (err) {
          console.warn(
            `[ExtensionManager] urlOverrides.onExtensionRemoved failed for ${id}:`,
            err,
          );
        }
      }
    }
    try {
      const { chromeThemeAdapter } = await import("./extensions/chromeThemes");
      if (enabled) await chromeThemeAdapter.onExtensionEnabled(id);
      else await chromeThemeAdapter.onExtensionDisabled(id);
    } catch (err) {
      console.warn(`[ExtensionManager] chromeTheme.toggle failed for ${id}:`, err);
    }
  }

  list(): ExtensionIndexEntry[] {
    return Array.from(this.spawned.values()).map((s) => s.entry);
  }

  /**
   * List ALL installed extensions (enabled + disabled). Reads from extfs
   * index, so it includes extensions whose BG iframe isn't spawned.
   * Used by the extensions management UI to show disabled extensions.
   */
  async listAll(): Promise<ExtensionIndexEntry[]> {
    return listExtensions();
  }

  /**
   * Richer version of listAll: includes the parsed manifest + origin so
   * UI code doesn't have to fetch it separately. For RUNNING extensions
   * we use the cached ctx; for DISABLED ones we read manifest.json from
   * extfs. Used by the extensions dropdown menu.
   */
  async listAllWithManifest(): Promise<Array<{
    id: string;
    name: string;
    version: string;
    manifestVersion: 2 | 3;
    enabled: boolean;
    origin: string;
    manifest: Record<string, unknown>;
  }>> {
    console.log(`[helium/extfs/dbg] [ExtensionManager.listAllWithManifest] called; spawned.size=${this.spawned.size}`);
    const entries = await listExtensions();
    console.log(`[helium/extfs/dbg] [ExtensionManager.listAllWithManifest] got ${entries.length} index entries`);
    const out: Array<{
      id: string;
      name: string;
      version: string;
      manifestVersion: 2 | 3;
      enabled: boolean;
      origin: string;
      manifest: Record<string, unknown>;
    }> = [];
    for (const entry of entries) {
      const spawned = this.spawned.get(entry.id);
      if (spawned) {
        console.log(`[helium/extfs/dbg] [ExtensionManager.listAllWithManifest] ${entry.id}: SPAWNED, using cached ctx`);
        out.push({
          id: entry.id,
          name: entry.name,
          version: entry.version,
          manifestVersion: entry.manifestVersion,
          enabled: entry.enabled,
          origin: spawned.ctx.origin,
          manifest: spawned.ctx.manifest as unknown as Record<string, unknown>,
        });
        continue;
      }
      console.log(`[helium/extfs/dbg] [ExtensionManager.listAllWithManifest] ${entry.id}: NOT spawned, reading manifest from disk...`);
      let manifest: Record<string, unknown> | null = null;
      try {
        const bytes = await readExtensionFile(entry.id, 'manifest.json');
        if (bytes) {
          manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
          console.log(`[helium/extfs/dbg] [ExtensionManager.listAllWithManifest] ${entry.id}: manifest parsed OK`);
        } else {
          console.log(`[helium/extfs/dbg] [ExtensionManager.listAllWithManifest] ${entry.id}: readExtensionFile returned null`);
        }
      } catch (err) {
        console.warn(`[ExtensionManager] failed to read manifest for ${entry.id}:`, err);
      }
      out.push({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        manifestVersion: entry.manifestVersion,
        enabled: entry.enabled,
        origin: `${entry.id}.ddx`,
        manifest: manifest ?? {
          name: entry.name,
          version: entry.version,
          manifest_version: entry.manifestVersion,
        },
      });
    }
    console.log(`[helium/extfs/dbg] [ExtensionManager.listAllWithManifest] returning ${out.length} entries:`, out.map(e => ({ id: e.id, name: e.name, enabled: e.enabled })));
    return out;
  }

  getRunning(): Array<{ id: string; ctx: ExtensionContext }> {
    return Array.from(this.spawned.values()).map((s) => ({
      id: s.id,
      ctx: s.ctx,
    }));
  }

  isRunning(id: string): boolean {
    return this.spawned.has(id);
  }

  /**
   * Read an icon (or any binary asset) out of an extension's tree and
   * return a data: URL suitable for `<img src=...>` from the host page.
   *
   * Extension assets live on the synthetic `https://<id>.ddx/` origin
   * which isn't directly reachable from host-page HTML (it's served via
   * Scramjet inside extension iframes). So the dropdown menu and the
   * extensions management page need to inline icon bytes themselves.
   *
   * Returns `null` if the file is missing or unreadable — callers
   * should fall back to a generic placeholder.
   *
   * The data: URL is cached per (extId, iconPath) for the lifetime of
   * the manager since icon assets are immutable post-install (apart
   * from chrome.action.setIcon, which uses a separate code path).
   */
  async getIconDataUrl(extId: string, iconPath: string): Promise<string | null> {
    if (!iconPath) return null;
    const rel = iconPath.replace(/^\/+/, '');
    const key = `${extId}::${rel}`;
    const cached = this.iconCache.get(key);
    if (cached !== undefined) return cached;
    let result: string | null = null;
    try {
      const bytes = await readExtensionFile(extId, rel);
      if (bytes && bytes.byteLength > 0) {
        const mime = contentTypeFromPath(rel);
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        const blob = new Blob([ab], { type: mime });
        result = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () =>
            reject(reader.error ?? new Error('FileReader failed'));
          reader.readAsDataURL(blob);
        });
      }
    } catch (err) {
      console.warn(
        `[ExtensionManager] getIconDataUrl(${extId}, ${rel}) failed:`,
        err,
      );
    }
    this.iconCache.set(key, result);
    return result;
  }

  /** Invalidate the icon cache (called on uninstall). */
  private clearIconCache(extId: string): void {
    const prefix = `${extId}::`;
    for (const k of this.iconCache.keys()) {
      if (k.startsWith(prefix)) this.iconCache.delete(k);
    }
  }

  on(
    event: 'installed' | 'uninstalled' | 'enabled' | 'disabled',
    listener: (id: string) => void,
  ): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: (id: string) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  grantActiveTab(extId: string, tabId: number): void {
    let set = this.activeTabGrants.get(extId);
    if (!set) {
      set = new Set();
      this.activeTabGrants.set(extId, set);
    }
    set.add(tabId);
  }

  clearActiveTabForTab(tabId: number): void {
    for (const set of this.activeTabGrants.values()) set.delete(tabId);
  }

  hasActiveTabGrant(extId: string, tabId: number): boolean {
    return this.activeTabGrants.get(extId)?.has(tabId) === true;
  }

  private installActiveTabListeners(): void {
    if (this.activeTabListenersInstalled) return;
    this.activeTabListenersInstalled = true;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId?: string } | undefined;
      if (!detail?.tabId) return;
      const num = this.nyxCtx.tabResolver.toNum(detail.tabId);
      this.clearActiveTabForTab(num);
    };
    document.addEventListener('tabNavigated', handler);
    document.addEventListener('tabClosed', handler);
  }

  private ensureContainer(): HTMLDivElement {
    if (this.container) return this.container;
    let el = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
    if (!el) {
      el = document.createElement('div');
      el.id = CONTAINER_ID;
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    this.container = el;
    return el;
  }

  private async spawn(loaded: LoadedExtension): Promise<void> {
    if (this.spawned.has(loaded.entry.id)) return;
    const container = this.ensureContainer();
    const ctx = loaded.context;

    const iframe = document.createElement('iframe');
    iframe.dataset.heliumExtId = ctx.id;

    const plugin = new HeliumExtensionPlugin(ctx);
    const frame = await this.proxy.createFrame(iframe, {
      plugins: [plugin],
    });

    container.appendChild(iframe);

    const channel = this.wireAuxiliaryViewChannel(ctx, iframe, { isBackground: true });

    let frameUrl: string;
    const m = loaded.manifest as { manifest_version?: 2 | 3; background?: { page?: string; scripts?: string[] } };
    if (m.manifest_version === 2) {
      if (typeof m.background?.page === 'string' && m.background.page.length > 0) {
        const page = m.background.page.replace(/^\/+/, '');
        frameUrl = `https://${ctx.origin}/${page}`;
      } else {
        frameUrl = `https://${ctx.origin}/__helium_entry__`;
      }
    } else {
      frameUrl = `https://${ctx.origin}/__helium_entry__`;
    }
    frame.go(frameUrl);

    this.spawned.set(ctx.id, {
      id: ctx.id,
      ctx,
      entry: loaded.entry,
      iframe,
      channel,
      plugin,
    });

    try {
      const w = window as {
        extDevtools?: import('@apis/devtools/extensionManager').ExtensionDevToolsManager;
      };
      if (w.extDevtools) {
        const mv = (ctx.manifest as { manifest_version?: number }).manifest_version;
        const label = mv === 3 ? 'Service worker' : 'Background page';
        w.extDevtools.targetRegistry.register({
          extId: ctx.id,
          targetId: 'background',
          kind: 'background',
          iframe,
          label,
        });
      }
    } catch (err) {
      console.warn(`[ExtensionManager] target-registry register failed for ${ctx.id}:`, err);
    }

    try {
      await installContentScripts(loaded.entry.id, loaded.context, loaded.manifest);
    } catch (err) {
      console.warn(`[ExtensionManager] content-script install failed for ${loaded.entry.id}:`, err);
    }

    if (this.dnrStorage) {
      try {
        const rulesets = parseManifestRulesets(ctx);
        await this.dnrStorage.loadForExt(ctx.id, rulesets);
        this.dnrEngine?.invalidate(ctx.id);
        this.syncDnrToSw(ctx.id);
      } catch (err) {
        console.warn(
          `[ExtensionManager] DNR load failed for ${ctx.id}:`,
          err,
        );
      }
    }

    try {
      const deps: import('@core/helium').RegisterCommandsDeps = {
        fireOnCommand: (extId, cmdName) => this.dispatchCommandOnCommand(extId, cmdName),
      };
      const w = window as {
        commands?: import('@core/helium').CommandRegistryLike;
        keybinds?: import('@core/helium').KeybindManagerLike;
        keyboards?: import('@core/helium').KeyboardManagerLike;
      };
      if (w.commands) deps.commandRegistry = w.commands;
      if (w.keybinds) deps.keybindManager = w.keybinds;
      if (w.keyboards) deps.keyboardManager = w.keyboards;
      const handle = registerCommandsForExtension(ctx.id, ctx, deps);
      this.commandsRegistrations.set(ctx.id, handle);
    } catch (err) {
      console.warn(`[ExtensionManager] commands register failed for ${ctx.id}:`, err);
    }
    try {
      this.omniboxRegistry?.registerFromManifest(ctx.id, ctx.manifest);
    } catch (err) {
      console.warn(`[ExtensionManager] omnibox register failed for ${ctx.id}:`, err);
    }
    try {
      await this.contextMenusRegistry?.restoreForExt(ctx.id);
    } catch (err) {
      console.warn(`[ExtensionManager] contextMenus restore failed for ${ctx.id}:`, err);
    }

    try {
      await this.actionHandlers?.seedFromManifest(
        ctx.id,
        ctx.manifest as Parameters<NonNullable<typeof this.actionHandlers>['seedFromManifest']>[1],
      );
    } catch (err) {
      console.warn(`[ExtensionManager] action seed failed for ${ctx.id}:`, err);
    }

    const dtManifest = ctx.manifest as { devtools_page?: string };
    if (dtManifest.devtools_page && this.devtoolsPageHost) {
      try {
        const w = window as { devtools?: import('@apis/devtools').DevToolsManager };
        const sessions = w.devtools?.listSessions() ?? [];
        for (const session of sessions) {
          try {
            await this.devtoolsPageHost.spawn(ctx, session.tabId);
          } catch (err) {
            console.warn(
              `[ExtensionManager] devtools_page spawn for ${ctx.id} on tab ${session.tabId} failed:`,
              err,
            );
          }
        }
      } catch (err) {
        console.warn(
          `[ExtensionManager] devtools_page catchup failed for ${ctx.id}:`,
          err,
        );
      }
    }
  }

  /**
   * Wire DevTools open/close + tab close into the per-extension
   * devtools_page lifecycle. Returns a disposer.
   *
   * Hooks:
   *   - `helium:devtools-opened`   detail { tabId }: spawn a devtools_page
   *     iframe for every running extension that declares one, AND replay
   *     any panels that were buffered while no devtools session was open.
   *   - `helium:devtools-closed`   detail { tabId }: despawn all devtools_page
   *     iframes for that tab.
   *   - `tabClosed`                detail { tabId }: despawn all devtools_page
   *     iframes for that tab.
   *
   * Both `helium:devtools-opened` and `helium:devtools-closed` are
   * dispatched natively by DevToolsManager.toggle() / onTabClose()
   * (see src/apis/devtools/manager.ts:75). The matching public
   * `onDevtoolsOpened(tabId)` / `onDevtoolsClosed(tabId)` methods on
   * ExtensionManager remain available as a direct-call surface for
   * future callers that need to bypass DOM events (e.g. headless test
   * harnesses), but the event listeners below are the production
   * fan-in path.
   */
  private installDevtoolsLifecycleHooks(): () => void {
    const onOpened = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { tabId?: string } | undefined;
      if (!detail?.tabId) return;
      void this.onDevtoolsOpened(detail.tabId);
      try {
        this.devtoolsHandlers?.panels.flushPending();
      } catch (err) {
        console.warn('[ExtensionManager] panels.flushPending failed:', err);
      }
    };
    const onClosed = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { tabId?: string } | undefined;
      if (!detail?.tabId) return;
      this.onDevtoolsClosed(detail.tabId);
    };
    const onTabClosed = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { tabId?: string } | undefined;
      if (!detail?.tabId) return;
      this.devtoolsPageHost?.despawnAllForTab(detail.tabId);
      const w = window as { devtools?: import('@apis/devtools').DevToolsManager };
      for (const s of this.spawned.values()) {
        try { w.devtools?.removeExtensionPanelsAll(s.id); } catch { /* ignore */ }
      }
    };
    document.addEventListener('helium:devtools-opened', onOpened);
    document.addEventListener('helium:devtools-closed', onClosed);
    document.addEventListener('tabClosed', onTabClosed);
    return () => {
      document.removeEventListener('helium:devtools-opened', onOpened);
      document.removeEventListener('helium:devtools-closed', onClosed);
      document.removeEventListener('tabClosed', onTabClosed);
    };
  }

  /**
   * Public hook: call when DevTools opens for a tab. Spawns devtools_page
   * iframes for every running extension that declares one.
   */
  public async onDevtoolsOpened(ddxTabId: string): Promise<void> {
    if (!this.devtoolsPageHost) return;
    for (const s of this.spawned.values()) {
      const m = s.ctx.manifest as { devtools_page?: string };
      if (!m.devtools_page) continue;
      try {
        await this.devtoolsPageHost.spawn(s.ctx, ddxTabId);
      } catch (err) {
        console.warn(
          `[ExtensionManager] devtools_page spawn failed for ${s.id}:`,
          err,
        );
      }
    }
  }

  /**
   * Public hook: call when DevTools closes for a tab. Despawns all
   * devtools_page iframes for that tab.
   */
  public onDevtoolsClosed(ddxTabId: string): void {
    if (!this.devtoolsPageHost) return;
    this.devtoolsPageHost.despawnAllForTab(ddxTabId);
    const w = window as { devtools?: import('@apis/devtools').DevToolsManager };
    if (w.devtools) {
      void w.devtools;
    }
  }

  /**
   * Public access to the chrome.devtools.* handlers facade. Used by
   * webRequest / webNavigation event installers to fan out request
   * data into devtools_page subscribers.
   */
  public getDevtoolsHandlers(): DevtoolsHandlers | null {
    return this.devtoolsHandlers;
  }

  /**
   * Fire chrome.commands.onCommand on the given extension with the
   * current active tab. Used by the keybind handler and palette entry.
   */
  private dispatchCommandOnCommand(extId: string, commandName: string): void {
    const w = window as {
      tabs?: { activeTabId?: string | null };
      nyx?: { tabResolver?: { toNum?: (id: string) => number; info?: (n: number) => unknown } };
    };
    const activeTabId = w.tabs?.activeTabId ?? null;
    let tabInfo: unknown = undefined;
    if (activeTabId && w.nyx?.tabResolver?.toNum && w.nyx.tabResolver.info) {
      try {
        const num = w.nyx.tabResolver.toNum(activeTabId);
        tabInfo = w.nyx.tabResolver.info(num);
        if (commandName === '_execute_action' || commandName === '_execute_browser_action' || commandName === '_execute_page_action') {
          this.grantActiveTab(extId, num);
          this.fireEventOn(extId, 'chrome.action.onClicked', [tabInfo]);
          return;
        }
        this.grantActiveTab(extId, num);
      } catch (err) {
        console.warn('[ExtensionManager] dispatchCommandOnCommand active tab resolve failed:', err);
      }
    }
    this.fireEventOn(extId, 'chrome.commands.onCommand', [commandName, tabInfo]);
  }

  private async kill(id: string): Promise<void> {
    const safe = (label: string, fn: () => unknown): void => {
      try { fn(); } catch (err) {
        console.warn(`[ExtensionManager] kill(${id}): ${label} threw:`, err);
      }
    };

    safe('portRouter.closeAllPortsForExt', () => this.portRouter?.closeAllPortsForExt(id));
    safe('uninstallContentScripts', () => uninstallContentScripts(id));
    safe('alarmScheduler.clearAllForExt', () => this.alarmScheduler?.clearAllForExt(id));
    safe('actionHandlers.clearForExt', () => this.actionHandlers?.clearForExt(id));
    safe('debuggerHandlers.clearForExt', () => this.debuggerHandlers?.clearForExt(id));
    safe('declarativeContentHandlers.clearForExt', () => this.declarativeContentHandlers?.clearForExt(id));
    safe('sessionStorage.delete', () => this.sessionStorage.delete(id));
    safe('managedStorageCache.delete', () => this.managedStorageCache.delete(id));
    safe('activeTabGrants.delete', () => this.activeTabGrants.delete(id));

    const cmdReg = this.commandsRegistrations.get(id);
    if (cmdReg) {
      safe('commands.dispose', () => cmdReg.dispose());
      this.commandsRegistrations.delete(id);
    }
    safe('omniboxRegistry.unregister', () => this.omniboxRegistry?.unregister(id));
    safe('contextMenusRegistry.clearForExt', () => this.contextMenusRegistry?.clearForExt(id));

    const webRequestDispose = this.webRequestRpcCleanups.get(id);
    if (webRequestDispose) {
      safe('webRequest RPC dispose', webRequestDispose);
      this.webRequestRpcCleanups.delete(id);
    }
    safe('webRequestRegistry.clearForExt', () => this.webRequestRegistry?.clearForExt(id));
    safe('syncDnrToSw', () => this.syncDnrToSw(id, true));
    safe('dnrStorage.clearForExt', () => this.dnrStorage?.clearForExt(id));
    safe('dnrEngine.invalidate', () => this.dnrEngine?.invalidate(id));

    safe('devtoolsPageHost.despawnAllForExt', () => this.devtoolsPageHost?.despawnAllForExt(id));
    safe('devtools.removeExtensionPanelsAll', () => {
      const w = window as { devtools?: import('@apis/devtools').DevToolsManager };
      w.devtools?.removeExtensionPanelsAll(id);
    });
    safe('extDevtools.targetRegistry.unregisterAllForExtension', () => {
      const w = window as {
        extDevtools?: import('@apis/devtools/extensionManager').ExtensionDevToolsManager;
      };
      w.extDevtools?.targetRegistry.unregisterAllForExtension(id);
    });
    safe('devtoolsHandlers.panels.clearPending', () =>
      this.devtoolsHandlers?.panels.clearPending(id),
    );
    safe('offscreenHandlers.closeForExt', () =>
      this.offscreenHandlers?.closeForExt(id),
    );

    const s = this.spawned.get(id);
    if (!s) return;
    safe('channel.close', () => s.channel.close());
    safe('iframe.remove', () => s.iframe.remove());
    this.spawned.delete(id);
  }

  /** Public lookup used by host modules (chrome.runtime handlers, etc.). */
  public getSpawnedById(id: string): { ctx: ExtensionContext; iframe: HTMLIFrameElement } | undefined {
    const s = this.spawned.get(id);
    return s ? { ctx: s.ctx, iframe: s.iframe } : undefined;
  }

  /**
   * Alias of `getSpawnedById`, used by the tab-creation path
   * (`browser/tabs/lifecycle.ts`) to look up a running extension's
   * context when wiring an extension-newtab tab's auxiliary channel.
   */
  public getRunningContext(id: string): { ctx: ExtensionContext; iframe: HTMLIFrameElement } | undefined {
    return this.getSpawnedById(id);
  }

  /**
   * Construct a fresh HeliumExtensionPlugin bound to the given extension's
   * context. Used by popup iframe spawning (action popups, devtools_page,
   * etc.) — each new iframe needs its OWN plugin instance (plugins are
   * frame-scoped in Scramjet).
   *
   * `opts.enforceHostPolicy` (default true) gates whether outbound
   * fetches from inside the frame get filtered against the extension's
   * `host_permissions`. Extension-newtab tabs pass `false` so user
   * navigation away from the newtab page isn't blocked by the
   * extension's policy.
   *
   * Returns null if the extension is not running.
   */
  public createExtensionPlugin(
    extId: string,
    opts?: { enforceHostPolicy?: boolean },
  ): HeliumExtensionPlugin | null {
    const s = this.spawned.get(extId);
    if (!s) return null;
    return new HeliumExtensionPlugin(s.ctx, opts);
  }

  /**
   * Standard wiring for ANY extension-owned iframe that needs the full
   * `chrome.*` runtime — i.e. anything where extension code will run
   * inside the iframe and call `chrome.tabs.query`, `chrome.storage.get`,
   * etc.
   *
   * This is used by:
   *   - The BG iframe at spawn time (via `spawn()`).
   *   - Popup iframes (via `popupHost.ts`).
   *   - DevTools-page iframes (via `host/devtools/page.ts`).
   *   - Future options-page iframes.
   *
   * What it does:
   *   1. Creates a `MessageChannel`; wraps host-side port as an
   *      `ExtensionBridgeChannel` for typed RPC.
   *   2. Installs ALL `chrome.*.*` RPC handlers (via `installHandlers`).
   *      Each iframe has its own channel and its own handlers map; no
   *      cross-talk.
   *   3. Installs the BG-→CS port-routing event handler (defensive: BG
   *      only emits these, but if a popup ever forwards them the
   *      handler is in place).
   *   4. Optionally (for BG only) installs the webRequest event
   *      subscription RPC.
   *   5. Hooks the iframe `load` event to invoke
   *      `iframe.contentWindow.__helium_handshake_receive__(extPort)`,
   *      handing the bootstrap its MessagePort. The bootstrap then
   *      calls `installRpcBindings` and wires `chrome.*` to the channel.
   *
   * Why not use `iframe.contentWindow.postMessage`:
   *   Scramjet patches each frame's own-property `window.postMessage`
   *   (see scramjet/packages/core/src/client/shared/postmessage.ts).
   *   The trap reads `SCRAMJETCLIENT` from the CALLER's globalThis (the
   *   host has none) and throws `Cannot read properties of undefined
   *   (reading 'url')`. `Window.prototype.postMessage` is `undefined`
   *   (postMessage is per-instance), so no prototype fallback exists.
   *   The bootstrap exposes a direct function instead — see
   *   `src/core/helium/bootstrap/client.ts:installHandshakeReceiver`.
   *
   * Returns the ExtensionBridgeChannel so callers can dispose it on
   * teardown (popupHost closes its channel when the popup is dismissed).
   */
  public wireAuxiliaryViewChannel(
    ctx: ExtensionContext,
    iframe: HTMLIFrameElement,
    opts: { isBackground: boolean } = { isBackground: false },
  ): ExtensionBridgeChannel {
    const { port1: hostPort, port2: extPort } = new MessageChannel();
    const channel = new ExtensionBridgeChannel(hostPort);
    this.installHandlers(ctx, channel);

    if (opts.isBackground && this.webRequestRegistry) {
      const dispose = installWebRequestEventRpc(
        channel,
        ctx.id,
        this.webRequestRegistry,
      );
      this.webRequestRpcCleanups.set(ctx.id, dispose);
    }

    channel.setEventHandler((method, args) => {
      if (method === 'chrome.runtime.port-msg-bg-to-cs') {
        const info = args[0] as { portId: number; message: unknown };
        // Pass `channel` as the sourceChannel so PortRouter can decide
        // which peer to route to for runtime-flavor ports (popup↔BG).
        this.portRouter?.forwardBgToCs(info.portId, info.message, channel);
        return;
      }
      if (method === 'chrome.runtime.port-close-bg-initiated') {
        const info = args[0] as { portId: number };
        this.portRouter?.closePort(info.portId, 'bg-initiated');
        return;
      }
      if (method === 'chrome.omnibox.suggestions-out') {
        const suggestions = args[0];
        try {
          this.omniboxRegistry?.applySuggestions(ctx.id, suggestions);
        } catch (err) {
          console.warn(`[ExtensionManager] omnibox suggestions apply failed for ${ctx.id}:`, err);
        }
        return;
      }
    });

    this.attachHandshakeWhenReady(ctx, iframe, extPort);

    return channel;
  }

  /**
   * Run the handshake (hand the bootstrap its MessagePort) once the
   * iframe is loaded — OR immediately if the iframe is already loaded.
   *
   * After a successful handshake, observe the iframe's document for
   * nested same-origin iframes (Chrome extensions like uBlock Origin
   * load their UI via nested `<iframe>` inside the popup), and
   * recursively wire a fresh channel for each. Without this recursion
   * the nested iframe's bootstrap loads, exposes its own
   * `__helium_handshake_receive__`, and then waits forever on a port
   * that never arrives — every `chrome.*` async call hangs and the
   * UI never renders.
   *
   * Each nested iframe gets its OWN MessageChannel (and its own
   * installHandlers binding). This matches the BG/popup/devtools-page
   * model and keeps per-realm RPC traffic isolated.
   */
  private attachHandshakeWhenReady(
    ctx: ExtensionContext,
    iframe: HTMLIFrameElement,
    extPort: MessagePort,
  ): void {
    attachExtensionHandshakeWhenReady(ctx.id, iframe, extPort, {
      onSuccess: () => {
        try {
          this.observeNestedIframes(ctx, iframe);
        } catch (err) {
          console.warn(
            `[ExtensionManager] observeNestedIframes failed for ${ctx.id}:`,
            err,
          );
        }
      },
    });
  }

  /**
   * Scan a successfully-handshaken iframe's document for nested
   * `<iframe>` elements that point at the same extension origin and
   * wire each one with its own channel. Also installs a
   * MutationObserver so iframes added later (e.g. by extension JS at
   * runtime) get wired too.
   *
   * Only same-extension-origin iframes are wired — we don't want to
   * wire a web-content iframe the extension happens to embed
   * (that's not an extension realm; injecting our bootstrap there
   * would be a CSP / context violation).
   */
  private observeNestedIframes(
    ctx: ExtensionContext,
    outerIframe: HTMLIFrameElement,
  ): void {
    const doc = outerIframe.contentDocument;
    if (!doc) return;

    const wireIfNew = (el: HTMLIFrameElement): void => {
      if (el.dataset.heliumNestedWired === '1') return;

      let srcUrl: URL;
      try {
        srcUrl = new URL(el.src || el.getAttribute('src') || '', doc.baseURI);
      } catch {
        return;
      }
      const isExtOrigin = srcUrl.host === ctx.origin;
      const isSameDocOrigin = srcUrl.origin === doc.location.origin;
      if (!isExtOrigin && !isSameDocOrigin) return;

      el.dataset.heliumNestedWired = '1';

      try {
        this.wireAuxiliaryViewChannel(ctx, el, { isBackground: false });
      } catch (err) {
        console.warn(
          `[ExtensionManager] wireAuxiliaryViewChannel (nested) failed for ${ctx.id}:`,
          err,
        );
      }
    };

    const existing = doc.querySelectorAll('iframe');
    for (let i = 0; i < existing.length; i++) {
      wireIfNew(existing[i] as HTMLIFrameElement);
    }

    try {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i];
            if (node instanceof HTMLIFrameElement) {
              wireIfNew(node);
            } else if (node instanceof Element) {
              const sub = node.querySelectorAll?.('iframe');
              if (sub) {
                for (let j = 0; j < sub.length; j++) {
                  wireIfNew(sub[j] as HTMLIFrameElement);
                }
              }
            }
          }
        }
      });
      obs.observe(doc, { childList: true, subtree: true });
      // We don't disconnect the observer explicitly — when the outer
      // iframe is destroyed (popup closed, BG killed), the document
      // goes with it and the observer is GC'd along with the closure.
    } catch (err) {
      console.warn(
        `[ExtensionManager] MutationObserver setup failed for ${ctx.id}:`,
        err,
      );
    }
  }

  /** Public: kill + re-spawn an extension. Used by chrome.runtime.reload. */
  public async respawn(id: string): Promise<void> {
    const existing = this.spawned.get(id);
    if (!existing) return;
    const loaded: LoadedExtension = {
      entry: existing.entry,
      manifest: existing.ctx.manifest,
      context: existing.ctx,
    };
    await this.kill(id);
    await this.spawn(loaded);
  }

  /** Public: open a new tab. Used by chrome.runtime.openOptionsPage. */
  public async openTab(url: string): Promise<void> {
    const tabs = this.nyxCtx.tabs as { createTab?: (url: string) => Promise<string | null> } | undefined;
    if (tabs?.createTab) await tabs.createTab(url);
  }

  /**
   * Open an extension's options page. Used by the extensions-page UI's
   * "Options" button as well as by `chrome.runtime.openOptionsPage`.
   * Resolves the options URL from manifest.options_ui.page (MV3) /
   * options_page (MV2) and opens a new tab.
   */
  public async openOptionsPage(extId: string): Promise<void> {
    const s = this.spawned.get(extId);
    if (!s) throw new Error(`Extension ${extId} is not running`);
    const m = s.ctx.manifest as { options_page?: string; options_ui?: { page?: string } };
    const opts = m.options_page ?? m.options_ui?.page;
    if (!opts) throw new Error(`Extension ${extId} has no options page`);
    const url = `https://${s.ctx.origin}/${String(opts).replace(/^\/+/, '')}`;
    await this.openTab(url);
  }

  /**
   * Programmatically open the extension's browser-action popup.
   * Backs `chrome.action.openPopup` from BG. Routes through the
   * extension menu's anchor if it exists; falls back to a synthesized
   * anchor at the screen center.
   *
   * No-ops if the extension doesn't declare a `default_popup`.
   */
  public async openActionPopup(extId: string): Promise<void> {
    const s = this.spawned.get(extId);
    if (!s) throw new Error(`Extension ${extId} is not running`);
    const m = s.ctx.manifest as {
      action?: { default_popup?: string };
      browser_action?: { default_popup?: string };
    };
    const popupPath = m.action?.default_popup ?? m.browser_action?.default_popup;
    if (!popupPath) {
      throw new Error(`Extension ${extId} declares no default_popup`);
    }
    const candidates: HTMLElement[] = [];
    try {
      const shadow = (window as { d?: ShadowRoot | Document }).d ?? document;
      const tb = shadow.querySelector(`[data-action-ext-id="${extId}"]`) as HTMLElement | null;
      if (tb) candidates.push(tb);
      const menuTrigger = shadow.querySelector('[data-component="extensions"]') as HTMLElement | null;
      if (menuTrigger) candidates.push(menuTrigger);
    } catch { /* swallow */ }
    const anchor = candidates[0] ?? document.body;

    openExtensionPopup({
      extId,
      ctx: s.ctx,
      popupPath,
      anchorEl: anchor,
    });
  }

  /**
   * Track a popup iframe's contentWindow for an extension. Called by
   * popupHost.openExtensionPopup once the popup iframe is constructed
   * and its contentWindow is available. The window is exposed through
   * chrome.extension.getViews({ type: 'popup' }).
   *
   * No-op if `win` is null (e.g. iframe failed to load).
   */
  public registerPopupWindow(extId: string, win: Window | null): void {
    if (!win) return;
    let set = this.popupWindows.get(extId);
    if (!set) {
      set = new Set();
      this.popupWindows.set(extId, set);
    }
    set.add(win);
  }

  /**
   * Stop tracking a popup window. Called from popupHost.closeExtensionPopup
   * before the iframe is removed.
   */
  public unregisterPopupWindow(extId: string, win: Window | null): void {
    if (!win) return;
    const set = this.popupWindows.get(extId);
    if (!set) return;
    set.delete(win);
    if (set.size === 0) this.popupWindows.delete(extId);
  }

  /**
   * Public: dispatch a chrome.runtime.onMessage to a target extension's BG.
   *
   * Wired via the channel's event-request path (`requestEvent`) so the
   * BG-side handler runs the full sendResponse contract (sync return
   * value wins immediately; `return true` waits for async sendResponse;
   * single-winner semantics; 30s async timeout — all implemented by
   * dispatchOnMessage in host/runtime/dispatch.ts and re-used by the
   * bootstrap's installRuntimeOnMessageHandler).
   *
   * The outer channel timeout (SEND_MESSAGE_TIMEOUT_MS) is intentionally
   * longer than the inner dispatch timeout so a slow-but-responsive BG
   * always settles via dispatchOnMessage's settle path rather than the
   * channel timing out the whole request.
   */
  public async dispatchRuntimeMessage(
    targetExtId: string,
    message: unknown,
    sender: unknown,
  ): Promise<unknown> {
    const target = this.spawned.get(targetExtId);
    if (!target) throw new Error(`Extension ${targetExtId} not running`);
    return target.channel.requestEvent(
      'chrome.runtime.onMessage',
      [message, sender],
      { timeoutMs: SEND_MESSAGE_TIMEOUT_MS },
    );
  }

  /**
   * Public dispatch: gates the method against the extension's manifest
   * permissions, then runs the corresponding impl. Used by:
   *   - The BG channel's per-handler registrations (via installHandlers)
   *   - The content-script relay (forwarding RPC from page realm)
   *
   * Throws ChromePermissionError if the method requires a permission
   * the manifest doesn't declare. Throws plain Error for unknown methods.
   */
  async runChromeHandler(
    ctx: ExtensionContext,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    const requiredPerm = HANDLER_PERMISSIONS[method];
    if (requiredPerm === undefined) {
      throw new Error(`Unknown chrome method: ${method}`);
    }
    if (requiredPerm !== null) {
      const perms = collectPermissions(ctx.manifest);
      if (!perms.has(requiredPerm)) {
        throw new ChromePermissionError(method, requiredPerm);
      }
    }
    const impls = this.handlerImpls();
    const impl = impls[method];
    if (!impl) throw new Error(`No impl for ${method}`);
    return impl.call(this, ctx, args);
  }

  private installHandlers(
    ctx: ExtensionContext,
    channel: ExtensionBridgeChannel,
  ): void {
    for (const method of Object.keys(this.handlerImpls())) {
      channel.registerHandler(method, async (req) => {
        return this.runChromeHandler(ctx, method, req.args);
      });
    }

    channel.registerHandler('__helium_bg_connect_tab__', async (req) => {
      const opts = (req.args?.[0] ?? {}) as { tabId?: number; name?: string; frameId?: number };
      if (!this.portRouter || typeof opts.tabId !== 'number') {
        return { portId: -1 };
      }
      try {
        const iframe = this.nyxCtx.tabResolver.resolveIframe(opts.tabId);
        const portId = this.portRouter.bgInitiatedConnectTab(
          ctx.id,
          channel,
          opts.tabId,
          opts.name ?? '',
          opts.frameId,
          iframe,
        );
        return { portId };
      } catch (err) {
        console.warn(`[ExtensionManager] bg_connect_tab failed for ${ctx.id}:`, err);
        return { portId: -1 };
      }
    });
    channel.registerHandler('__helium_bg_connect_runtime__', async (req) => {
      const opts = (req.args?.[0] ?? {}) as { targetExtId?: string; name?: string };
      if (!this.portRouter) return { portId: -1 };
      // Pass the initiator's channel so the router can route return
      // traffic (BG→popup, etc.) back to us rather than losing it.
      // Fixes uBlock Origin popup: its popup.js does
      // `chrome.runtime.connect(...)` then `port.postMessage({...})`
      // and awaits the BG's `callback(popupData)` — without this the
      // BG's response `port.postMessage` was dropped into the host
      // window and the popup never got its data.
      const portId = this.portRouter.bgInitiatedConnectRuntime(
        ctx.id,
        opts.targetExtId ?? ctx.id,
        opts.name ?? '',
        channel,
      );
      return { portId };
    });
  }

  private handlerImpls(): Record<
    string,
    (ctx: ExtensionContext, args: unknown[]) => Promise<unknown>
  > {
    const t = (h: TabsHandlers | null): TabsHandlers => h!;
    const w = (h: WindowsHandlers | null): WindowsHandlers => h!;
    const a = (h: AlarmsHandlers | null): AlarmsHandlers => h!;
    const r = (h: RuntimeHandlers | null): RuntimeHandlers => h!;
    const eh = (h: ExtensionHandlers | null): ExtensionHandlers => h!;
    const b = (h: BookmarksHandlers | null): BookmarksHandlers => h!;
    const hi = (h: HistoryHandlers | null): HistoryHandlers => h!;
    const c = (h: CookiesHandlers | null): CookiesHandlers => h!;
    const i = (h: I18nHandlers | null): I18nHandlers => h!;
    const wn = (h: WebNavigationHandlers | null): WebNavigationHandlers => h!;
    const ah = (h: ActionHandlers | null): ActionHandlers => h!;
    const cm = (h: CommandsHandlers | null): CommandsHandlers => h!;
    const nh = (h: NotificationsHandlers | null): NotificationsHandlers => h!;
    const cmh = (h: ContextMenusHandlers | null): ContextMenusHandlers => h!;
    const omh = (h: OmniboxHandlers | null): OmniboxHandlers => h!;
    const wrh = (h: WebRequestHandlers | null): WebRequestHandlers => h!;
    const dnh = (h: DnrHandlers | null): DnrHandlers => h!;
    const dt = (h: DevtoolsHandlers | null): DevtoolsHandlers => h!;
    const ph = (h: PermissionsHandlers | null): PermissionsHandlers => h!;
    const sph = (h: SidePanelHandlers | null): SidePanelHandlers => h!;
    const dh = (h: DownloadsHandlers | null): DownloadsHandlers => h!;
    const idh = (h: IdentityHandlers | null): IdentityHandlers => h!;
    const mh = (h: ManagementHandlers | null): ManagementHandlers => h!;
    const ih = (h: IdleHandlers | null): IdleHandlers => h!;
    const oh = (h: OffscreenHandlers | null): OffscreenHandlers => h!;
    const dgh = (h: DebuggerHandlers | null): DebuggerHandlers => {
      if (!h) {
        throw new Error('chrome.debugger is not available (CdpHelper not registered)');
      }
      return h;
    };
    return {
      'chrome.storage.local.get':    (ctx, args) => this.storageGet(ctx, args),
      'chrome.storage.local.set':    (ctx, args) => this.storageSet(ctx, args, 'local'),
      'chrome.storage.local.remove': (ctx, args) => this.storageRemove(ctx, args, 'local'),
      'chrome.storage.local.clear':  (ctx, args) => this.storageClear(ctx, args, 'local'),
      'chrome.storage.local.getBytesInUse': (ctx, args) => this.storageGetBytesInUse(ctx, args),
      'chrome.storage.local.getKeys': (ctx, args) => this.storageGetKeys(ctx, args),
      'chrome.storage.sync.get':     (ctx, args) => this.storageGet(ctx, args),
      'chrome.storage.sync.set':     (ctx, args) => this.storageSet(ctx, args, 'sync'),
      'chrome.storage.sync.remove':  (ctx, args) => this.storageRemove(ctx, args, 'sync'),
      'chrome.storage.sync.clear':   (ctx, args) => this.storageClear(ctx, args, 'sync'),
      'chrome.storage.sync.getBytesInUse': (ctx, args) => this.storageGetBytesInUse(ctx, args),
      'chrome.storage.sync.getKeys': (ctx, args) => this.storageGetKeys(ctx, args),
      'chrome.storage.session.get':         (ctx, args) => this.storageSessionGet(ctx, args),
      'chrome.storage.session.set':         (ctx, args) => this.storageSessionSet(ctx, args),
      'chrome.storage.session.remove':      (ctx, args) => this.storageSessionRemove(ctx, args),
      'chrome.storage.session.clear':       (ctx, args) => this.storageSessionClear(ctx, args),
      'chrome.storage.session.getBytesInUse': (ctx, args) => this.storageSessionGetBytesInUse(ctx, args),
      'chrome.storage.session.getKeys':       (ctx, args) => this.storageSessionGetKeys(ctx, args),
      'chrome.storage.managed.get':           (ctx, args) => this.storageManagedGet(ctx, args),
      'chrome.storage.managed.getBytesInUse': (ctx, args) => this.storageManagedGetBytesInUse(ctx, args),

      'chrome.runtime.sendMessage':  (ctx, args) => this.runtimeSendMessage(ctx, args),
      'chrome.runtime.getBackgroundPage':         (ctx, args) => r(this.runtimeHandlers).getBackgroundPage(ctx, args),
      'chrome.runtime.getPlatformInfo':           (ctx, args) => r(this.runtimeHandlers).getPlatformInfo(ctx, args),
      'chrome.runtime.getPackageDirectoryEntry':  (ctx, args) => r(this.runtimeHandlers).getPackageDirectoryEntry(ctx, args),
      'chrome.runtime.requestUpdateCheck':        (ctx, args) => r(this.runtimeHandlers).requestUpdateCheck(ctx, args),
      'chrome.runtime.reload':                    (ctx, args) => r(this.runtimeHandlers).reload(ctx, args),
      'chrome.runtime.setUninstallURL':           (ctx, args) => r(this.runtimeHandlers).setUninstallURL(ctx, args),
      'chrome.runtime.openOptionsPage':           (ctx, args) => r(this.runtimeHandlers).openOptionsPage(ctx, args),
      'chrome.runtime.connectNative':             (ctx, args) => r(this.runtimeHandlers).connectNative(ctx, args),
      'chrome.runtime.sendNativeMessage':         (ctx, args) => r(this.runtimeHandlers).sendNativeMessage(ctx, args),

      'chrome.extension.getBackgroundPage':        (ctx, args) => eh(this.extensionHandlers).getBackgroundPage(ctx, args),
      'chrome.extension.getViews':                 (ctx, args) => eh(this.extensionHandlers).getViews(ctx, args),
      'chrome.extension.getURL':                   (ctx, args) => eh(this.extensionHandlers).getURL(ctx, args),
      'chrome.extension.isAllowedIncognitoAccess': (ctx, args) => eh(this.extensionHandlers).isAllowedIncognitoAccess(ctx, args),
      'chrome.extension.isAllowedFileSchemeAccess':(ctx, args) => eh(this.extensionHandlers).isAllowedFileSchemeAccess(ctx, args),

      'chrome.scripting.executeScript':
        (ctx, args) => this.scriptingHandlers!.executeScript(ctx, args),
      'chrome.scripting.insertCSS':
        (ctx, args) => this.scriptingHandlers!.insertCSS(ctx, args),
      'chrome.scripting.removeCSS':
        (ctx, args) => this.scriptingHandlers!.removeCSS(ctx, args),
      'chrome.scripting.registerContentScripts':
        (ctx, args) => this.scriptingHandlers!.registerContentScripts(ctx, args),
      'chrome.scripting.unregisterContentScripts':
        (ctx, args) => this.scriptingHandlers!.unregisterContentScripts(ctx, args),
      'chrome.scripting.getRegisteredContentScripts':
        (ctx, args) => this.scriptingHandlers!.getRegisteredContentScripts(ctx, args),
      'chrome.scripting.updateContentScripts':
        async (ctx, args) => {
          const scripts = (args[0] ?? []) as Array<{ id: string }>;
          const ids = scripts.map((s) => s.id).filter((id) => typeof id === 'string');
          if (ids.length > 0) {
            await this.scriptingHandlers!.unregisterContentScripts(ctx, [{ ids }]);
          }
          await this.scriptingHandlers!.registerContentScripts(ctx, [scripts]);
        },

      'chrome.tabs.executeScript':
        async (ctx, args) => {
          let tabId: number | undefined;
          let details: { code?: string; file?: string; allFrames?: boolean; frameId?: number; runAt?: string };
          if (typeof args[0] === 'number') {
            tabId = args[0] as number;
            details = (args[1] ?? {}) as typeof details;
          } else {
            details = (args[0] ?? {}) as typeof details;
          }
          const mv3Target: { tabId?: number; allFrames?: boolean; frameIds?: number[] } = {};
          if (typeof tabId === 'number') mv3Target.tabId = tabId;
          if (details.allFrames === true) mv3Target.allFrames = true;
          if (typeof details.frameId === 'number') mv3Target.frameIds = [details.frameId];

          if (typeof details.file === 'string' && details.file.length > 0) {
            return this.scriptingHandlers!.executeScript(ctx, [{
              target: mv3Target,
              files: [details.file],
            }]);
          }
          if (typeof details.code === 'string' && details.code.length > 0) {
            const fnSrc = `function(){${details.code}}`;
            return this.scriptingHandlers!.executeScript(ctx, [{
              target: mv3Target,
              func: fnSrc,
            }]);
          }
          throw new Error('chrome.tabs.executeScript requires code or file');
        },
      'chrome.tabs.insertCSS':
        async (ctx, args) => {
          let tabId: number | undefined;
          let details: { code?: string; file?: string; allFrames?: boolean; frameId?: number; runAt?: string };
          if (typeof args[0] === 'number') {
            tabId = args[0] as number;
            details = (args[1] ?? {}) as typeof details;
          } else {
            details = (args[0] ?? {}) as typeof details;
          }
          const mv3Target: { tabId?: number; allFrames?: boolean; frameIds?: number[] } = {};
          if (typeof tabId === 'number') mv3Target.tabId = tabId;
          if (details.allFrames === true) mv3Target.allFrames = true;
          if (typeof details.frameId === 'number') mv3Target.frameIds = [details.frameId];

          if (typeof details.file === 'string' && details.file.length > 0) {
            return this.scriptingHandlers!.insertCSS(ctx, [{
              target: mv3Target,
              files: [details.file],
            }]);
          }
          if (typeof details.code === 'string' && details.code.length > 0) {
            return this.scriptingHandlers!.insertCSS(ctx, [{
              target: mv3Target,
              css: details.code,
            }]);
          }
          throw new Error('chrome.tabs.insertCSS requires code or file');
        },
      'chrome.tabs.removeCSS':
        async (ctx, args) => {
          let tabId: number | undefined;
          let details: { code?: string; file?: string; allFrames?: boolean; frameId?: number };
          if (typeof args[0] === 'number') {
            tabId = args[0] as number;
            details = (args[1] ?? {}) as typeof details;
          } else {
            details = (args[0] ?? {}) as typeof details;
          }
          const mv3Target: { tabId?: number; allFrames?: boolean; frameIds?: number[] } = {};
          if (typeof tabId === 'number') mv3Target.tabId = tabId;
          if (details.allFrames === true) mv3Target.allFrames = true;
          if (typeof details.frameId === 'number') mv3Target.frameIds = [details.frameId];

          if (typeof details.file === 'string' && details.file.length > 0) {
            return this.scriptingHandlers!.removeCSS(ctx, [{
              target: mv3Target,
              files: [details.file],
            }]);
          }
          if (typeof details.code === 'string' && details.code.length > 0) {
            return this.scriptingHandlers!.removeCSS(ctx, [{
              target: mv3Target,
              css: details.code,
            }]);
          }
          throw new Error('chrome.tabs.removeCSS requires code or file');
        },

      'chrome.tabs.query':           async (ctx, args) => {
        const tabs = await t(this.tabsHandlers).query(ctx, args);
        if (!Array.isArray(tabs)) return [];
        return sanitizeTabsForExtension(
          tabs,
          ctx.manifest,
          (tabId) => this.hasActiveTabGrant(ctx.id, tabId),
        );
      },
      'chrome.tabs.get':             (ctx, args) => t(this.tabsHandlers).get(ctx, args),
      'chrome.tabs.getCurrent':      (ctx, args) => t(this.tabsHandlers).getCurrent(ctx, args),
      'chrome.tabs.create':          (ctx, args) => t(this.tabsHandlers).create(ctx, args),
      'chrome.tabs.update':          (ctx, args) => t(this.tabsHandlers).update(ctx, args),
      'chrome.tabs.remove':          (ctx, args) => t(this.tabsHandlers).remove(ctx, args),
      'chrome.tabs.duplicate':       (ctx, args) => t(this.tabsHandlers).duplicate(ctx, args),
      'chrome.tabs.reload':          (ctx, args) => t(this.tabsHandlers).reload(ctx, args),
      'chrome.tabs.goBack':          (ctx, args) => t(this.tabsHandlers).goBack(ctx, args),
      'chrome.tabs.goForward':       (ctx, args) => t(this.tabsHandlers).goForward(ctx, args),
      'chrome.tabs.captureVisibleTab': (ctx, args) => t(this.tabsHandlers).captureVisibleTab(ctx, args),
      'chrome.tabs.move':            (ctx, args) => t(this.tabsHandlers).move(ctx, args),
      'chrome.tabs.group':           (ctx, args) => t(this.tabsHandlers).group(ctx, args),
      'chrome.tabs.ungroup':         (ctx, args) => t(this.tabsHandlers).ungroup(ctx, args),
      'chrome.tabs.detectLanguage':  (ctx, args) => t(this.tabsHandlers).detectLanguage(ctx, args),
      'chrome.tabs.discard':         (ctx, args) => t(this.tabsHandlers).discard(ctx, args),
      'chrome.tabs.highlight':       (ctx, args) => t(this.tabsHandlers).highlight(ctx, args),
      'chrome.tabs.getZoom':         (ctx, args) => t(this.tabsHandlers).getZoom(ctx, args),
      'chrome.tabs.setZoom':         (ctx, args) => t(this.tabsHandlers).setZoom(ctx, args),
      'chrome.tabs.getZoomSettings': (ctx, args) => t(this.tabsHandlers).getZoomSettings(ctx, args),
      'chrome.tabs.setZoomSettings': (ctx, args) => t(this.tabsHandlers).setZoomSettings(ctx, args),
      'chrome.tabs.toggleReaderMode': (ctx, args) => t(this.tabsHandlers).toggleReaderMode(ctx, args),
      'chrome.tabs.sendMessage':     (ctx, args) => t(this.tabsHandlers).sendMessage(ctx, args),

      'chrome.windows.get':            (ctx, args) => w(this.windowsHandlers).get(ctx, args),
      'chrome.windows.getCurrent':     (ctx, args) => w(this.windowsHandlers).getCurrent(ctx, args),
      'chrome.windows.getLastFocused': (ctx, args) => w(this.windowsHandlers).getLastFocused(ctx, args),
      'chrome.windows.getAll':         (ctx, args) => w(this.windowsHandlers).getAll(ctx, args),
      'chrome.windows.create':         (ctx, args) => w(this.windowsHandlers).create(ctx, args),
      'chrome.windows.update':         (ctx, args) => w(this.windowsHandlers).update(ctx, args),
      'chrome.windows.remove':         (ctx, args) => w(this.windowsHandlers).remove(ctx, args),

      'chrome.alarms.create':   (ctx, args) => a(this.alarmsHandlers).create(ctx, args),
      'chrome.alarms.get':      (ctx, args) => a(this.alarmsHandlers).get(ctx, args),
      'chrome.alarms.getAll':   (ctx, args) => a(this.alarmsHandlers).getAll(ctx, args),
      'chrome.alarms.clear':    (ctx, args) => a(this.alarmsHandlers).clear(ctx, args),
      'chrome.alarms.clearAll': (ctx, args) => a(this.alarmsHandlers).clearAll(ctx, args),

      'chrome.bookmarks.get':         (ctx, args) => b(this.bookmarksHandlers).get(ctx, args),
      'chrome.bookmarks.getChildren': (ctx, args) => b(this.bookmarksHandlers).getChildren(ctx, args),
      'chrome.bookmarks.getRecent':   (ctx, args) => b(this.bookmarksHandlers).getRecent(ctx, args),
      'chrome.bookmarks.getTree':     (ctx, args) => b(this.bookmarksHandlers).getTree(ctx, args),
      'chrome.bookmarks.getSubTree':  (ctx, args) => b(this.bookmarksHandlers).getSubTree(ctx, args),
      'chrome.bookmarks.search':      (ctx, args) => b(this.bookmarksHandlers).search(ctx, args),
      'chrome.bookmarks.create':      (ctx, args) => b(this.bookmarksHandlers).create(ctx, args),
      'chrome.bookmarks.move':        (ctx, args) => b(this.bookmarksHandlers).move(ctx, args),
      'chrome.bookmarks.update':      (ctx, args) => b(this.bookmarksHandlers).update(ctx, args),
      'chrome.bookmarks.remove':      (ctx, args) => b(this.bookmarksHandlers).remove(ctx, args),
      'chrome.bookmarks.removeTree':  (ctx, args) => b(this.bookmarksHandlers).removeTree(ctx, args),

      'chrome.history.search':      (ctx, args) => hi(this.historyHandlers).search(ctx, args),
      'chrome.history.getVisits':   (ctx, args) => hi(this.historyHandlers).getVisits(ctx, args),
      'chrome.history.addUrl':      (ctx, args) => hi(this.historyHandlers).addUrl(ctx, args),
      'chrome.history.deleteUrl':   (ctx, args) => hi(this.historyHandlers).deleteUrl(ctx, args),
      'chrome.history.deleteRange': (ctx, args) => hi(this.historyHandlers).deleteRange(ctx, args),
      'chrome.history.deleteAll':   (ctx, args) => hi(this.historyHandlers).deleteAll(ctx, args),

      'chrome.cookies.get':                (ctx, args) => c(this.cookiesHandlers).get(ctx, args),
      'chrome.cookies.getAll':             (ctx, args) => c(this.cookiesHandlers).getAll(ctx, args),
      'chrome.cookies.set':                (ctx, args) => c(this.cookiesHandlers).set(ctx, args),
      'chrome.cookies.remove':             (ctx, args) => c(this.cookiesHandlers).remove(ctx, args),
      'chrome.cookies.getAllCookieStores': (ctx, args) => c(this.cookiesHandlers).getAllCookieStores(ctx, args),

      'chrome.i18n.getMessage':         (ctx, args) => i(this.i18nHandlers).getMessage(ctx, args),
      'chrome.i18n.getUILanguage':      (ctx, args) => i(this.i18nHandlers).getUILanguage(ctx, args),
      'chrome.i18n.getAcceptLanguages': (ctx, args) => i(this.i18nHandlers).getAcceptLanguages(ctx, args),
      'chrome.i18n.detectLanguage':     (ctx, args) => i(this.i18nHandlers).detectLanguage(ctx, args),

      'chrome.webNavigation.getFrame':     (ctx, args) => wn(this.webNavigationHandlers).getFrame(ctx, args),
      'chrome.webNavigation.getAllFrames': (ctx, args) => wn(this.webNavigationHandlers).getAllFrames(ctx, args),

      'chrome.action.setTitle':                (ctx, args) => ah(this.actionHandlers).setTitle(ctx, args),
      'chrome.action.getTitle':                (ctx, args) => ah(this.actionHandlers).getTitle(ctx, args),
      'chrome.action.setPopup':                (ctx, args) => ah(this.actionHandlers).setPopup(ctx, args),
      'chrome.action.getPopup':                (ctx, args) => ah(this.actionHandlers).getPopup(ctx, args),
      'chrome.action.setBadgeText':            (ctx, args) => ah(this.actionHandlers).setBadgeText(ctx, args),
      'chrome.action.getBadgeText':            (ctx, args) => ah(this.actionHandlers).getBadgeText(ctx, args),
      'chrome.action.setBadgeBackgroundColor': (ctx, args) => ah(this.actionHandlers).setBadgeBackgroundColor(ctx, args),
      'chrome.action.getBadgeBackgroundColor': (ctx, args) => ah(this.actionHandlers).getBadgeBackgroundColor(ctx, args),
      'chrome.action.setBadgeTextColor':       (ctx, args) => ah(this.actionHandlers).setBadgeTextColor(ctx, args),
      'chrome.action.getBadgeTextColor':       (ctx, args) => ah(this.actionHandlers).getBadgeTextColor(ctx, args),
      'chrome.action.setIcon':                 (ctx, args) => ah(this.actionHandlers).setIcon(ctx, args),
      'chrome.action.enable':                  (ctx, args) => ah(this.actionHandlers).enable(ctx, args),
      'chrome.action.disable':                 (ctx, args) => ah(this.actionHandlers).disable(ctx, args),
      'chrome.action.isEnabled':               (ctx, args) => ah(this.actionHandlers).isEnabled(ctx, args),
      'chrome.action.openPopup':               (ctx, args) => ah(this.actionHandlers).openPopup(ctx, args),
      'chrome.action.getUserSettings':         (ctx, args) => ah(this.actionHandlers).getUserSettings(ctx, args),
      'chrome.browserAction.setTitle':                (ctx, args) => ah(this.actionHandlers).setTitle(ctx, args),
      'chrome.browserAction.getTitle':                (ctx, args) => ah(this.actionHandlers).getTitle(ctx, args),
      'chrome.browserAction.setPopup':                (ctx, args) => ah(this.actionHandlers).setPopup(ctx, args),
      'chrome.browserAction.getPopup':                (ctx, args) => ah(this.actionHandlers).getPopup(ctx, args),
      'chrome.browserAction.setBadgeText':            (ctx, args) => ah(this.actionHandlers).setBadgeText(ctx, args),
      'chrome.browserAction.getBadgeText':            (ctx, args) => ah(this.actionHandlers).getBadgeText(ctx, args),
      'chrome.browserAction.setBadgeBackgroundColor': (ctx, args) => ah(this.actionHandlers).setBadgeBackgroundColor(ctx, args),
      'chrome.browserAction.getBadgeBackgroundColor': (ctx, args) => ah(this.actionHandlers).getBadgeBackgroundColor(ctx, args),
      'chrome.browserAction.setBadgeTextColor':       (ctx, args) => ah(this.actionHandlers).setBadgeTextColor(ctx, args),
      'chrome.browserAction.getBadgeTextColor':       (ctx, args) => ah(this.actionHandlers).getBadgeTextColor(ctx, args),
      'chrome.browserAction.setIcon':                 (ctx, args) => ah(this.actionHandlers).setIcon(ctx, args),
      'chrome.browserAction.enable':                  (ctx, args) => ah(this.actionHandlers).enable(ctx, args),
      'chrome.browserAction.disable':                 (ctx, args) => ah(this.actionHandlers).disable(ctx, args),
      'chrome.browserAction.isEnabled':               (ctx, args) => ah(this.actionHandlers).isEnabled(ctx, args),
      'chrome.browserAction.openPopup':               (ctx, args) => ah(this.actionHandlers).openPopup(ctx, args),
      'chrome.browserAction.getUserSettings':         (ctx, args) => ah(this.actionHandlers).getUserSettings(ctx, args),
      'chrome.pageAction.show':     (ctx, args) => ah(this.actionHandlers).pageActionShow(ctx, args),
      'chrome.pageAction.hide':     (ctx, args) => ah(this.actionHandlers).pageActionHide(ctx, args),
      'chrome.pageAction.setTitle': (ctx, args) => ah(this.actionHandlers).setTitle(ctx, args),
      'chrome.pageAction.getTitle': (ctx, args) => ah(this.actionHandlers).getTitle(ctx, args),
      'chrome.pageAction.setPopup': (ctx, args) => ah(this.actionHandlers).setPopup(ctx, args),
      'chrome.pageAction.getPopup': (ctx, args) => ah(this.actionHandlers).getPopup(ctx, args),
      'chrome.pageAction.setIcon':  (ctx, args) => ah(this.actionHandlers).setIcon(ctx, args),

      'chrome.commands.getAll': (ctx, args) => cm(this.commandsHandlers).getAll(ctx, args),

      'chrome.notifications.create':             (ctx, args) => nh(this.notificationsHandlers).create(ctx, args),
      'chrome.notifications.update':             (ctx, args) => nh(this.notificationsHandlers).update(ctx, args),
      'chrome.notifications.clear':              (ctx, args) => nh(this.notificationsHandlers).clear(ctx, args),
      'chrome.notifications.getAll':             (ctx, args) => nh(this.notificationsHandlers).getAll(ctx, args),
      'chrome.notifications.getPermissionLevel': (ctx, args) => nh(this.notificationsHandlers).getPermissionLevel(ctx, args),

      'chrome.contextMenus.create':    (ctx, args) => cmh(this.contextMenusHandlers).create(ctx, args),
      'chrome.contextMenus.update':    (ctx, args) => cmh(this.contextMenusHandlers).update(ctx, args),
      'chrome.contextMenus.remove':    (ctx, args) => cmh(this.contextMenusHandlers).remove(ctx, args),
      'chrome.contextMenus.removeAll': (ctx, args) => cmh(this.contextMenusHandlers).removeAll(ctx, args),
      'chrome.menus.create':    (ctx, args) => cmh(this.contextMenusHandlers).create(ctx, args),
      'chrome.menus.update':    (ctx, args) => cmh(this.contextMenusHandlers).update(ctx, args),
      'chrome.menus.remove':    (ctx, args) => cmh(this.contextMenusHandlers).remove(ctx, args),
      'chrome.menus.removeAll': (ctx, args) => cmh(this.contextMenusHandlers).removeAll(ctx, args),

      'chrome.omnibox.setDefaultSuggestion': (ctx, args) => omh(this.omniboxHandlers).setDefaultSuggestion(ctx, args),

      'chrome.webRequest.handlerBehaviorChanged': (ctx, args) =>
        wrh(this.webRequestHandlers).handlerBehaviorChanged(ctx, args),

      'chrome.declarativeNetRequest.updateDynamicRules': async (ctx, args) => {
        const r = await dnh(this.dnrHandlers).updateDynamicRules(ctx, args);
        this.dnrEngine?.invalidate(ctx.id);
        this.syncDnrToSw(ctx.id);
        return r;
      },
      'chrome.declarativeNetRequest.getDynamicRules': (ctx, args) =>
        dnh(this.dnrHandlers).getDynamicRules(ctx, args),
      'chrome.declarativeNetRequest.updateSessionRules': async (ctx, args) => {
        const r = await dnh(this.dnrHandlers).updateSessionRules(ctx, args);
        this.dnrEngine?.invalidate(ctx.id);
        this.syncDnrToSw(ctx.id);
        return r;
      },
      'chrome.declarativeNetRequest.getSessionRules': (ctx, args) =>
        dnh(this.dnrHandlers).getSessionRules(ctx, args),
      'chrome.declarativeNetRequest.updateEnabledRulesets': async (ctx, args) => {
        const r = await dnh(this.dnrHandlers).updateEnabledRulesets(ctx, args);
        this.dnrEngine?.invalidate(ctx.id);
        this.syncDnrToSw(ctx.id);
        return r;
      },
      'chrome.declarativeNetRequest.getEnabledRulesets': (ctx, args) =>
        dnh(this.dnrHandlers).getEnabledRulesets(ctx, args),
      'chrome.declarativeNetRequest.getAvailableStaticRules': (ctx, args) =>
        dnh(this.dnrHandlers).getAvailableStaticRules(ctx, args),
      'chrome.declarativeNetRequest.getAvailableStaticRuleCount': (ctx, args) =>
        dnh(this.dnrHandlers).getAvailableStaticRuleCount(ctx, args),
      'chrome.declarativeNetRequest.getDisabledRuleIds': (ctx, args) =>
        dnh(this.dnrHandlers).getDisabledRuleIds(ctx, args),
      'chrome.declarativeNetRequest.updateStaticRules': (ctx, args) =>
        dnh(this.dnrHandlers).updateStaticRules(ctx, args),
      'chrome.declarativeNetRequest.setExtensionActionOptions': (ctx, args) =>
        dnh(this.dnrHandlers).setExtensionActionOptions(ctx, args),
      'chrome.declarativeNetRequest.getMatchedRules': (ctx, args) =>
        dnh(this.dnrHandlers).getMatchedRules(ctx, args),
      'chrome.declarativeNetRequest.isRegexSupported': (ctx, args) =>
        dnh(this.dnrHandlers).isRegexSupported(ctx, args),
      'chrome.declarativeNetRequest.testMatchOutcome': (ctx, args) =>
        dnh(this.dnrHandlers).testMatchOutcome(ctx, args),

      'chrome.devtools.panels.create':
        (ctx, args) => dt(this.devtoolsHandlers).panelsCreate(ctx, args),
      'chrome.devtools.panels.elements.createSidebarPane':
        (ctx, args) => dt(this.devtoolsHandlers).panelsElementsCreateSidebarPane(ctx, args),
      'chrome.devtools.panels.sources.createSidebarPane':
        (ctx, args) => dt(this.devtoolsHandlers).panelsSourcesCreateSidebarPane(ctx, args),
      'chrome.devtools.panels.setOpenResourceHandler':
        (ctx, args) => dt(this.devtoolsHandlers).panelsSetOpenResourceHandler(ctx, args),
      'chrome.devtools.inspectedWindow.tabId':
        (ctx, args) => dt(this.devtoolsHandlers).inspectedWindowGetTabId(ctx, args),
      'chrome.devtools.inspectedWindow.eval':
        (ctx, args) => dt(this.devtoolsHandlers).inspectedWindowEval(ctx, args),
      'chrome.devtools.inspectedWindow.reload':
        (ctx, args) => dt(this.devtoolsHandlers).inspectedWindowReload(ctx, args),
      'chrome.devtools.inspectedWindow.getResources':
        (ctx, args) => dt(this.devtoolsHandlers).inspectedWindowGetResources(ctx, args),
      'chrome.devtools.network.getHAR':
        (ctx, args) => dt(this.devtoolsHandlers).networkGetHAR(ctx, args),

      'chrome.permissions.getAll':   (ctx, args) => ph(this.permissionsHandlers).getAll(ctx, args),
      'chrome.permissions.contains': (ctx, args) => ph(this.permissionsHandlers).contains(ctx, args),
      'chrome.permissions.request':  (ctx, args) => ph(this.permissionsHandlers).request(ctx, args),
      'chrome.permissions.remove':   (ctx, args) => ph(this.permissionsHandlers).remove(ctx, args),

      'chrome.sidePanel.setOptions':       (ctx, args) => sph(this.sidePanelHandlers).setOptions(ctx, args),
      'chrome.sidePanel.getOptions':       (ctx, args) => sph(this.sidePanelHandlers).getOptions(ctx, args),
      'chrome.sidePanel.setPanelBehavior': (ctx, args) => sph(this.sidePanelHandlers).setPanelBehavior(ctx, args),
      'chrome.sidePanel.getPanelBehavior': (ctx, args) => sph(this.sidePanelHandlers).getPanelBehavior(ctx, args),
      'chrome.sidePanel.open':             (ctx, args) => sph(this.sidePanelHandlers).open(ctx, args),

      'chrome.downloads.download':          (ctx, args) => dh(this.downloadsHandlers).download(ctx, args),
      'chrome.downloads.search':            (ctx, args) => dh(this.downloadsHandlers).search(ctx, args),
      'chrome.downloads.pause':             (ctx, args) => dh(this.downloadsHandlers).pause(ctx, args),
      'chrome.downloads.resume':            (ctx, args) => dh(this.downloadsHandlers).resume(ctx, args),
      'chrome.downloads.cancel':            (ctx, args) => dh(this.downloadsHandlers).cancel(ctx, args),
      'chrome.downloads.remove':            (ctx, args) => dh(this.downloadsHandlers).remove(ctx, args),
      'chrome.downloads.erase':             (ctx, args) => dh(this.downloadsHandlers).erase(ctx, args),
      'chrome.downloads.open':              (ctx, args) => dh(this.downloadsHandlers).open(ctx, args),
      'chrome.downloads.show':              (ctx, args) => dh(this.downloadsHandlers).show(ctx, args),
      'chrome.downloads.showDefaultFolder': (ctx, args) => dh(this.downloadsHandlers).showDefaultFolder(ctx, args),
      'chrome.downloads.acceptDanger':      (ctx, args) => dh(this.downloadsHandlers).acceptDanger(ctx, args),
      'chrome.downloads.setShelfEnabled':   (ctx, args) => dh(this.downloadsHandlers).setShelfEnabled(ctx, args),

      'chrome.identity.getAuthToken':             (ctx, args) => idh(this.identityHandlers).getAuthToken(ctx, args),
      'chrome.identity.getProfileUserInfo':       (ctx, args) => idh(this.identityHandlers).getProfileUserInfo(ctx, args),
      'chrome.identity.launchWebAuthFlow':        (ctx, args) => idh(this.identityHandlers).launchWebAuthFlow(ctx, args),
      'chrome.identity.removeCachedAuthToken':    (ctx, args) => idh(this.identityHandlers).removeCachedAuthToken(ctx, args),
      'chrome.identity.clearAllCachedAuthTokens': (ctx, args) => idh(this.identityHandlers).clearAllCachedAuthTokens(ctx, args),
      'chrome.identity.getAccounts':              (ctx, args) => idh(this.identityHandlers).getAccounts(ctx, args),
      'chrome.identity.getRedirectURL':           (ctx, args) => idh(this.identityHandlers).getRedirectURL(ctx, args),

      'chrome.management.getAll':                          (ctx, args) => mh(this.managementHandlers).getAll(ctx, args),
      'chrome.management.get':                             (ctx, args) => mh(this.managementHandlers).get(ctx, args),
      'chrome.management.getSelf':                         (ctx, args) => mh(this.managementHandlers).getSelf(ctx, args),
      'chrome.management.setEnabled':                      (ctx, args) => mh(this.managementHandlers).setEnabled(ctx, args),
      'chrome.management.uninstall':                       (ctx, args) => mh(this.managementHandlers).uninstall(ctx, args),

      'chrome.idle.queryState':           (ctx, args) => ih(this.idleHandlers).queryState(ctx, args),
      'chrome.idle.setDetectionInterval': (ctx, args) => ih(this.idleHandlers).setDetectionInterval(ctx, args),

      'chrome.offscreen.createDocument':  (ctx, args) => oh(this.offscreenHandlers).createDocument(ctx, args),
      'chrome.offscreen.closeDocument':   (ctx, args) => oh(this.offscreenHandlers).closeDocument(ctx, args),
      'chrome.offscreen.hasDocument':     (ctx, args) => oh(this.offscreenHandlers).hasDocument(ctx, args),

      'chrome.runtime.getContexts': async (ctx, args) => {
        const filter = (args[0] ?? {}) as {
          contextTypes?: string[];
          documentUrls?: string[];
          documentOrigins?: string[];
          incognito?: boolean;
          tabIds?: number[];
          windowIds?: number[];
          frameIds?: number[];
        };
        const types = filter.contextTypes;
        const wantType = (t: string): boolean => !types || types.includes(t);
        const matchesUrl = (url?: string): boolean => {
          if (!filter.documentUrls || filter.documentUrls.length === 0) return true;
          if (!url) return false;
          return filter.documentUrls.includes(url);
        };
        const matchesOrigin = (origin?: string): boolean => {
          if (!filter.documentOrigins || filter.documentOrigins.length === 0) return true;
          if (!origin) return false;
          return filter.documentOrigins.includes(origin);
        };
        const matchesTab = (tabId?: number): boolean => {
          if (!filter.tabIds || filter.tabIds.length === 0) return true;
          if (tabId === undefined) return false;
          return filter.tabIds.includes(tabId);
        };
        if (filter.incognito === true) return [];
        const out: Array<{
          contextType: string;
          contextId: string;
          tabId?: number;
          windowId?: number;
          documentId?: string;
          frameId?: number;
          documentUrl?: string;
          documentOrigin?: string;
          incognito: boolean;
        }> = [];
        const extOrigin = `https://${ctx.origin}`;
        const spawn = this.spawned.get(ctx.id);
        if (spawn) {
          const bgType = ctx.manifestVersion === 3 ? 'SERVICE_WORKER' : 'BACKGROUND';
          if (wantType(bgType) && matchesOrigin(extOrigin)) {
            out.push({
              contextType: bgType,
              contextId: `bg:${ctx.id}`,
              tabId: -1,
              windowId: -1,
              frameId: 0,
              documentOrigin: extOrigin,
              incognito: false,
            });
          }
        }
        if (wantType('POPUP')) {
          const popups = this.popupWindows.get(ctx.id);
          if (popups) {
            let i = 0;
            for (const _ of popups) {
              if (matchesOrigin(extOrigin)) {
                out.push({
                  contextType: 'POPUP',
                  contextId: `popup:${ctx.id}:${i}`,
                  tabId: -1,
                  windowId: 1,
                  frameId: 0,
                  documentOrigin: extOrigin,
                  incognito: false,
                });
              }
              i++;
            }
          }
        }
        if (wantType('OFFSCREEN_DOCUMENT') && this.offscreenHandlers) {
          const has = await this.offscreenHandlers.hasDocument(ctx, []);
          if (has && matchesOrigin(extOrigin)) {
            out.push({
              contextType: 'OFFSCREEN_DOCUMENT',
              contextId: `offscreen:${ctx.id}`,
              tabId: -1,
              windowId: -1,
              frameId: 0,
              documentOrigin: extOrigin,
              incognito: false,
            });
          }
        }
        if (wantType('TAB')) {
          try {
            const tabResolver = this.nyxCtx?.tabResolver;
            const tabsApi = (window as { tabs?: { getTabsInOrder?: () => Array<{ id: string }> } }).tabs;
            if (tabResolver && tabsApi?.getTabsInOrder) {
              for (const t of tabsApi.getTabsInOrder()) {
                let info: { id: number; url: string } | null = null;
                try {
                  const n = tabResolver.toNum(t.id);
                  const i = tabResolver.info(n);
                  info = { id: n, url: typeof i.url === 'string' ? i.url : '' };
                } catch { /* skip */ }
                if (!info) continue;
                let origin: string | undefined;
                try { origin = info.url ? new URL(info.url).origin : undefined; } catch { /* skip */ }
                if (!matchesUrl(info.url)) continue;
                if (!matchesOrigin(origin)) continue;
                if (!matchesTab(info.id)) continue;
                out.push({
                  contextType: 'TAB',
                  contextId: `tab:${info.id}`,
                  tabId: info.id,
                  windowId: 1,
                  frameId: 0,
                  documentUrl: info.url || undefined,
                  documentOrigin: origin,
                  incognito: false,
                });
              }
            }
          } catch (err) {
            console.warn('[chrome.runtime.getContexts] TAB enumeration failed:', err);
          }
        }
        if (wantType('CONTENT_SCRIPT') && this.contentScriptRelay) {
          try {
            const windows = this.contentScriptRelay.windowsForExt(ctx.id);
            for (const win of windows) {
              let tabId: number | undefined;
              let docUrl: string | undefined;
              let origin: string | undefined;
              try {
                const frame = (win as Window & { frameElement?: Element | null }).frameElement;
                const tabIdStr = frame?.getAttribute?.('data-tab-id') ?? null;
                if (tabIdStr && this.nyxCtx?.tabResolver) {
                  tabId = this.nyxCtx.tabResolver.toNum(tabIdStr);
                  const info = this.nyxCtx.tabResolver.info(tabId);
                  docUrl = typeof info.url === 'string' ? info.url : undefined;
                  origin = docUrl ? new URL(docUrl).origin : undefined;
                }
              } catch { /* swallow */ }
              if (!matchesUrl(docUrl)) continue;
              if (!matchesOrigin(origin)) continue;
              if (!matchesTab(tabId)) continue;
              out.push({
                contextType: 'CONTENT_SCRIPT',
                contextId: `cs:${ctx.id}:${tabId ?? 'unknown'}`,
                tabId,
                windowId: 1,
                frameId: 0,
                documentUrl: docUrl,
                documentOrigin: origin,
                incognito: false,
              });
            }
          } catch (err) {
            console.warn('[chrome.runtime.getContexts] CONTENT_SCRIPT enumeration failed:', err);
          }
        }
        return out;
      },

      'chrome.search.query': async (_ctx, args) => {
        const opts = (args[0] ?? {}) as { text?: string; disposition?: string; tabId?: number };
        if (typeof opts.text !== 'string' || !opts.text) {
          throw new Error('chrome.search.query requires text');
        }
        const tmpl = (window as { searchEngines?: { getDefault(): { urlTemplate: string } } })
          .searchEngines?.getDefault().urlTemplate
          ?? 'https://duckduckgo.com/?q=%s';
        const url = expandSearchTemplate(tmpl, opts.text);
        await this.openTab(url);
      },

      'chrome.sessions.getDevices': async () => [],
      'chrome.sessions.getRecentlyClosed': async (_ctx, args) => {
        const opts = (args[0] ?? {}) as { maxResults?: number };
        const max = typeof opts.maxResults === 'number'
          ? Math.max(1, Math.min(opts.maxResults, 25))
          : 25;
        const tabsMod = (window as { tabs?: TabsInterface }).tabs;
        const stack = tabsMod?.closedTabStack;
        if (!stack || typeof stack.list !== 'function') return [];
        const records = stack.list().slice(0, max);
        return records.map((t) => ({
          lastModified: Math.floor(t.closedAt / 1000),
          tab: {
            id: -Math.abs(t.closedAt | 0) - 1,
            url: t.url,
            title: t.title,
            favIconUrl: t.favicon ?? '',
            index: 0,
            windowId: 1,
            active: false,
            pinned: t.wasPinned === true,
            highlighted: false,
            discarded: false,
            incognito: false,
            sessionId: String(t.closedAt),
          },
        }));
      },
      'chrome.sessions.restore': async (_ctx, args) => {
        const sessionId = typeof args[0] === 'string' ? args[0] : undefined;
        const tabsMod = (window as { tabs?: TabsInterface }).tabs;
        if (!tabsMod?.closedTabStack || typeof tabsMod.createTab !== 'function') {
          return null;
        }
        const stack = tabsMod.closedTabStack;
        let target: { url: string; title: string; favicon: string | null; closedAt: number } | undefined;
        if (sessionId !== undefined) {
          const closedAt = Number(sessionId);
          if (!Number.isFinite(closedAt)) return null;
          target = stack.list().find((r) => r.closedAt === closedAt);
          if (!target) return null;
          stack.removeByTimestamp(closedAt);
        } else {
          target = stack.popMostRecent();
        }
        if (!target?.url) return null;
        try {
          await tabsMod.createTab(target.url);
        } catch (err) {
          console.warn('[chrome.sessions.restore] createTab failed:', err);
        }
        return {
          lastModified: Math.floor(target.closedAt / 1000),
          tab: {
            id: -Math.abs(target.closedAt | 0) - 1,
            url: target.url,
            title: target.title,
            favIconUrl: target.favicon ?? '',
            index: 0,
            windowId: 1,
            active: true,
            pinned: false,
            highlighted: false,
            discarded: false,
            incognito: false,
            sessionId: String(target.closedAt),
          },
        };
      },

      'chrome.topSites.get': async () => {
        try {
          const { HistoryManager } = await import('@apis/history');
          const hm = HistoryManager.getInstance();
          const entries = hm.getEntries();
          if (entries.length === 0) return [];
          const bestByHost = new Map<string, { url: string; title: string; visits: number; lastVisit: number }>();
          for (const e of entries) {
            let host: string;
            try {
              host = new URL(e.url).hostname;
            } catch {
              continue;
            }
            if (!host) continue;
            const lastVisitTs = e.visitedAt instanceof Date ? e.visitedAt.getTime() : Date.now();
            const cur = bestByHost.get(host);
            if (
              !cur ||
              e.visitCount > cur.visits ||
              (e.visitCount === cur.visits && lastVisitTs > cur.lastVisit)
            ) {
              bestByHost.set(host, {
                url: e.url,
                title: e.title || host,
                visits: e.visitCount,
                lastVisit: lastVisitTs,
              });
            }
          }
          return [...bestByHost.values()]
            .sort((a, b) => b.visits - a.visits || b.lastVisit - a.lastVisit)
            .slice(0, 20)
            .map((s) => ({ url: s.url, title: s.title }));
        } catch (err) {
          console.warn('[chrome.topSites] history read failed:', err);
          return [];
        }
      },

      'chrome.readingList.addEntry': async (_ctx, args) => {
        const opts = (args[0] ?? {}) as { url?: string; title?: string; hasBeenRead?: boolean };
        if (typeof opts.url !== 'string' || !opts.url) {
          throw new Error('chrome.readingList.addEntry requires url');
        }
        const rm = ReadingListManager.getInstance();
        return rm.addEntry({
          url: opts.url,
          title: opts.title ?? opts.url,
          hasBeenRead: opts.hasBeenRead === true,
        });
      },
      'chrome.readingList.query': async (_ctx, args) => {
        const filter = (args[0] ?? {}) as { url?: string; title?: string; hasBeenRead?: boolean };
        const rm = ReadingListManager.getInstance();
        return rm.query(filter);
      },
      'chrome.readingList.removeEntry': async (_ctx, args) => {
        const opts = (args[0] ?? {}) as { url?: string };
        if (typeof opts.url !== 'string' || !opts.url) {
          throw new Error('chrome.readingList.removeEntry requires url');
        }
        const rm = ReadingListManager.getInstance();
        await rm.removeEntry({ url: opts.url });
        return undefined;
      },
      'chrome.readingList.updateEntry': async (_ctx, args) => {
        const opts = (args[0] ?? {}) as {
          url?: string;
          title?: string;
          hasBeenRead?: boolean;
        };
        if (typeof opts.url !== 'string' || !opts.url) {
          throw new Error('chrome.readingList.updateEntry requires url');
        }
        const rm = ReadingListManager.getInstance();
        return rm.updateEntry({
          url: opts.url,
          ...(typeof opts.title === 'string' ? { title: opts.title } : {}),
          ...(typeof opts.hasBeenRead === 'boolean' ? { hasBeenRead: opts.hasBeenRead } : {}),
        });
      },

      'chrome.dns.resolve': async (_ctx, args) => {
        const hostname = args[0];
        if (typeof hostname !== 'string' || !hostname) {
          throw new Error('chrome.dns.resolve requires a hostname');
        }
        const { getDnsResolver } = await import('@apis/network/dns');
        return getDnsResolver().resolve(hostname);
      },

      'chrome.debugger.attach': async (ctx, args) => {
        const target = (args[0] ?? {}) as { tabId?: number };
        const requiredVersion = typeof args[1] === 'string' ? args[1] : undefined;
        dgh(this.debuggerHandlers).attach(ctx.id, target, requiredVersion);
        return undefined;
      },
      'chrome.debugger.detach': async (ctx, args) => {
        const target = (args[0] ?? {}) as { tabId?: number };
        dgh(this.debuggerHandlers).detach(ctx.id, target);
        return undefined;
      },
      'chrome.debugger.sendCommand': async (ctx, args) => {
        const target = (args[0] ?? {}) as { tabId?: number };
        const method = String(args[1] ?? '');
        const params = (args[2] ?? {}) as object;
        return dgh(this.debuggerHandlers).sendCommand(ctx.id, target, method, params);
      },
      'chrome.declarativeContent.addRules': async (ctx, args) => {
        const rules = (args[0] ?? []) as Array<{
          id?: string;
          conditions?: unknown[];
          actions?: unknown[];
          priority?: number;
        }>;
        if (!this.declarativeContentHandlers) return [];
        this.declarativeContentHandlers.addRules(
          ctx.id,
          rules as Parameters<DeclarativeContentHandlers['addRules']>[1],
        );
        return rules;
      },
      'chrome.declarativeContent.removeRules': async (ctx, args) => {
        const ids = Array.isArray(args[0]) ? (args[0] as string[]) : undefined;
        this.declarativeContentHandlers?.removeRules(ctx.id, ids);
        return undefined;
      },
      'chrome.declarativeContent.getRules': async (ctx, args) => {
        const ids = Array.isArray(args[0]) ? (args[0] as string[]) : undefined;
        return this.declarativeContentHandlers?.getRules(ctx.id, ids) ?? [];
      },

      'chrome.debugger.getTargets': async () => {
        return dgh(this.debuggerHandlers).getTargets({
          listTabs: () => {
            const out: Array<{ tabId: number; title: string; url: string }> = [];
            try {
              const tabsApi = (window as { tabs?: { getTabsInOrder?: () => Array<{ id: string }> } }).tabs;
              const tr = this.nyxCtx.tabResolver;
              if (tabsApi?.getTabsInOrder) {
                for (const t of tabsApi.getTabsInOrder()) {
                  try {
                    const n = tr.toNum(t.id);
                    const info = tr.info(n);
                    out.push({
                      tabId: n,
                      title: typeof info.title === 'string' ? info.title : '',
                      url: typeof info.url === 'string' ? info.url : '',
                    });
                  } catch { /* skip */ }
                }
              }
            } catch { /* swallow */ }
            return out;
          },
        });
      },

      'chrome.browsingData.remove': async (_ctx, args) => {
        const [options, dataToRemove] = args as [
          { origins?: string[] } | undefined,
          Record<string, boolean> | undefined,
        ];
        if (!dataToRemove) return;
        const { SiteDataManager } = await import('@apis/siteData');
        const sdm = SiteDataManager.getInstance();
        const origins = options?.origins;
        if (dataToRemove.history) {
          const { HistoryManager } = await import('@apis/history');
          await HistoryManager.getInstance().clearAll();
        }
        if (dataToRemove.cookies) {
          if (origins && origins.length > 0) {
            for (const o of origins) await sdm.clearCookies(o);
          } else {
            await sdm.clearAllSites().then((r) => r.cookies);
          }
        }
        if (dataToRemove.cache || dataToRemove.cacheStorage) {
          if (origins) for (const o of origins) await sdm.clearCache(o);
        }
        if (dataToRemove.localStorage || dataToRemove.indexedDB || dataToRemove.fileSystems) {
          if (origins) {
            for (const o of origins) await sdm.clearStorage(o);
          } else {
            await sdm.clearAllSites();
          }
        }
        if (dataToRemove.downloads) {
          try {
            const { DownloadsManager } = await import('@apis/downloads');
            await DownloadsManager.getInstance().clearAll();
          } catch { /* manager not yet available */ }
        }
      },
      'chrome.browsingData.removeAppcache': async () => { /* obsolete API; no-op */ },
      'chrome.browsingData.removeCache': async (_ctx, args) => {
        const opts = args[0] as { origins?: string[] } | undefined;
        const { SiteDataManager } = await import('@apis/siteData');
        const sdm = SiteDataManager.getInstance();
        if (opts?.origins) {
          for (const o of opts.origins) await sdm.clearCache(o);
        }
      },
      'chrome.browsingData.removeCacheStorage': async (_ctx, args) => {
        const opts = args[0] as { origins?: string[] } | undefined;
        const { SiteDataManager } = await import('@apis/siteData');
        const sdm = SiteDataManager.getInstance();
        if (opts?.origins) {
          for (const o of opts.origins) await sdm.clearCache(o);
        }
      },
      'chrome.browsingData.removeCookies': async (_ctx, args) => {
        const opts = args[0] as { origins?: string[] } | undefined;
        const { SiteDataManager } = await import('@apis/siteData');
        const sdm = SiteDataManager.getInstance();
        if (opts?.origins) {
          for (const o of opts.origins) await sdm.clearCookies(o);
        } else {
          await sdm.clearAllSites();
        }
      },
      'chrome.browsingData.removeDownloads': async () => {
        try {
          const { DownloadsManager } = await import('@apis/downloads');
          await DownloadsManager.getInstance().clearAll();
        } catch { /* manager not yet available */ }
      },
      'chrome.browsingData.removeFileSystems': async (_ctx, args) => {
        const opts = args[0] as { origins?: string[] } | undefined;
        const { SiteDataManager } = await import('@apis/siteData');
        const sdm = SiteDataManager.getInstance();
        if (opts?.origins) {
          for (const o of opts.origins) await sdm.clearStorage(o);
        }
      },
      'chrome.browsingData.removeFormData': async () => { /* no DDX form-data store */ },
      'chrome.browsingData.removeHistory': async (_ctx, args) => {
        const opts = args[0] as { origins?: string[] } | undefined;
        const { HistoryManager } = await import('@apis/history');
        const hm = HistoryManager.getInstance();
        if (opts?.origins && opts.origins.length > 0) {
          for (const origin of opts.origins) {
            try {
              const host = new URL(origin).hostname;
              hm.deleteEntriesByDomain(host);
            } catch { /* invalid origin — skip */ }
          }
        } else {
          await hm.clearAll();
        }
      },
      'chrome.browsingData.removeIndexedDB': async (_ctx, args) => {
        const opts = args[0] as { origins?: string[] } | undefined;
        if (opts?.origins && opts.origins.length > 0) {
          console.warn(
            '[browsingData.removeIndexedDB] per-origin clear unsupported; IDB is shared with host. Ignoring.',
          );
        }
      },
      'chrome.browsingData.removeLocalStorage': async (_ctx, args) => {
        const opts = args[0] as { origins?: string[] } | undefined;
        const { SiteDataManager } = await import('@apis/siteData');
        const sdm = SiteDataManager.getInstance();
        if (opts?.origins) {
          for (const o of opts.origins) await sdm.clearStorage(o);
        } else {
          await sdm.clearAllSites();
        }
      },
      'chrome.browsingData.removePasswords': async () => { /* no DDX password store */ },
      'chrome.browsingData.removePluginData': async () => { /* obsolete (Flash) */ },
      'chrome.browsingData.removeServiceWorkers': async () => {
        // Service workers in DDX are owned by Scramjet's controller —
        // there's no per-origin worker registration to clear.
      },
      'chrome.browsingData.removeWebSQL': async () => { /* obsolete */ },
      'chrome.browsingData.settings': async () => ({
        options: { since: 0, originTypes: { unprotectedWeb: true, protectedWeb: false, extension: false } },
        dataToRemove: {
          cookies: true,
          history: true,
          cache: true,
          localStorage: true,
          downloads: true,
        },
        dataRemovalPermitted: {
          cookies: true,
          history: true,
          cache: true,
          localStorage: true,
          downloads: true,
          fileSystems: true,
          formData: false,
          indexedDB: false,
          passwords: false,
          serviceWorkers: false,
          webSQL: false,
        },
      }),

      'chrome.tabGroups.get': async (_ctx, args) => {
        const groupId = typeof args[0] === 'number' ? args[0] : -1;
        const gm = (window as { tabs?: TabsInterface }).tabs?.groupManager;
        const ddxId = getDdxGroupId(groupId);
        if (!ddxId || !gm) {
          throw new Error(`No tab group with id ${groupId}`);
        }
        const g = gm.getGroupById(ddxId);
        if (!g) throw new Error(`No tab group with id ${groupId}`);
        return {
          id: groupId,
          collapsed: g.isCollapsed,
          color: g.color || 'grey',
          title: g.name || '',
          windowId: 1,
        };
      },
      'chrome.tabGroups.query': async (_ctx, args) => {
        const opts = (args[0] ?? {}) as {
          collapsed?: boolean;
          color?: string;
          title?: string;
          windowId?: number;
        };
        const gm = (window as { tabs?: TabsInterface }).tabs?.groupManager;
        const all = gm?.listGroups() ?? [];
        return all
          .filter((g) => opts.collapsed === undefined || g.isCollapsed === opts.collapsed)
          .filter((g) => opts.color === undefined || g.color === opts.color)
          .filter((g) => opts.title === undefined || g.name === opts.title)
          .map((g) => ({
            id: hashGroupId(g.id),
            collapsed: g.isCollapsed,
            color: g.color || 'grey',
            title: g.name || '',
            windowId: 1,
          }));
      },
      'chrome.tabGroups.update': async (_ctx, args) => {
        const groupId = typeof args[0] === 'number' ? args[0] : -1;
        const updateProps = (args[1] ?? {}) as {
          collapsed?: boolean;
          color?: string;
          title?: string;
        };
        const ddxId = getDdxGroupId(groupId);
        const gm = (window as { tabs?: TabsInterface }).tabs?.groupManager;
        if (!ddxId || !gm) {
          throw new Error(`No tab group with id ${groupId}`);
        }
        const g = gm.updateGroup(ddxId, updateProps);
        if (!g) throw new Error(`No tab group with id ${groupId}`);
        return {
          id: groupId,
          collapsed: g.isCollapsed,
          color: g.color || 'grey',
          title: g.name || '',
          windowId: 1,
        };
      },
      'chrome.tabGroups.move': async (_ctx, args) => {
        const groupId = typeof args[0] === 'number' ? args[0] : -1;
        const moveProps = (args[1] ?? {}) as { index?: number; windowId?: number };
        const targetIndex = typeof moveProps.index === 'number' ? moveProps.index : 0;
        const ddxId = getDdxGroupId(groupId);
        const gm = (window as { tabs?: TabsInterface }).tabs?.groupManager;
        if (!ddxId || !gm) {
          throw new Error(`No tab group with id ${groupId}`);
        }
        const g = gm.moveGroup(ddxId, targetIndex);
        if (!g) throw new Error(`No tab group with id ${groupId}`);
        return {
          id: groupId,
          collapsed: g.isCollapsed,
          color: g.color || 'grey',
          title: g.name || '',
          windowId: 1,
        };
      },
      'chrome.management.uninstallSelf':                   (ctx, args) => mh(this.managementHandlers).uninstallSelf(ctx, args),
      'chrome.management.getPermissionWarningsById':       (ctx, args) => mh(this.managementHandlers).getPermissionWarningsById(ctx, args),
      'chrome.management.getPermissionWarningsByManifest': (ctx, args) => mh(this.managementHandlers).getPermissionWarningsByManifest(ctx, args),
      'chrome.management.launchApp':                       (ctx, args) => mh(this.managementHandlers).launchApp(ctx, args),
      'chrome.management.createAppShortcut':               (ctx, args) => mh(this.managementHandlers).createAppShortcut(ctx, args),
      'chrome.management.setLaunchType':                   (ctx, args) => mh(this.managementHandlers).setLaunchType(ctx, args),
      'chrome.management.generateAppForLink':              (ctx, args) => mh(this.managementHandlers).generateAppForLink(ctx, args),
    };
  }

  private async storageGet(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<unknown> {
    const data = await this.readStorage(ctx.id);
    const keys = args[0];
    if (keys == null) return { ...data };
    if (typeof keys === 'string') {
      return keys in data ? { [keys]: data[keys] } : {};
    }
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (typeof k === 'string' && k in data) out[k] = data[k];
      }
      return out;
    }
    if (typeof keys === 'object') {
      const defaults = keys as Record<string, unknown>;
      const out: Record<string, unknown> = { ...defaults };
      for (const k of Object.keys(defaults)) {
        if (k in data) out[k] = data[k];
      }
      return out;
    }
    return {};
  }

  /**
   * `chrome.storage.<area>.getKeys()` — Chrome 132+ API. Returns the
   * full set of stored keys without paying the cost of fetching values.
   * Without this RPC handler, the bootstrap's StorageArea.getKeys()
   * stub reads its own (never-populated) in-class cache and lies about
   * storage being empty.
   */
  private async storageGetKeys(
    ctx: ExtensionContext,
    _args: unknown[],
  ): Promise<string[]> {
    const data = await this.readStorage(ctx.id);
    return Object.keys(data);
  }

  private async storageSessionGetKeys(
    ctx: ExtensionContext,
    _args: unknown[],
  ): Promise<string[]> {
    const data = this.sessionStorage.get(ctx.id) ?? {};
    return Object.keys(data);
  }

  private async storageSet(
    ctx: ExtensionContext,
    args: unknown[],
    area: 'local' | 'sync' = 'local',
  ): Promise<void> {
    const items = args[0] as Record<string, unknown> | null | undefined;
    if (!items || typeof items !== 'object') return;
    const data = await this.readStorage(ctx.id);
    const changes: Record<
      string,
      { oldValue?: unknown; newValue?: unknown }
    > = {};
    for (const [k, newValue] of Object.entries(items)) {
      if (data[k] !== newValue) {
        changes[k] = { oldValue: data[k], newValue };
      }
      data[k] = newValue;
    }
    await this.writeStorage(ctx.id, data);
    this.fireStorageChanged(ctx.id, changes, area);
  }

  /**
   * Fire BOTH the namespace-level `chrome.storage.onChanged` AND the
   * per-area `chrome.storage.<area>.onChanged` events. MV3 docs
   * specifically recommend the per-area form, and many modern
   * extensions use ONLY that listener. Firing both keeps old code
   * working too.
   */
  private fireStorageChanged(
    extId: string,
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: 'local' | 'sync' | 'session' | 'managed',
  ): void {
    if (Object.keys(changes).length === 0) return;
    this.fireEventOn(extId, 'chrome.storage.onChanged', [changes, area]);
    this.fireEventOn(extId, `chrome.storage.${area}.onChanged`, [changes]);
  }

  private async storageRemove(
    ctx: ExtensionContext,
    args: unknown[],
    area: 'local' | 'sync' = 'local',
  ): Promise<void> {
    const keys = args[0];
    const list =
      typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
    const data = await this.readStorage(ctx.id);
    const changes: Record<
      string,
      { oldValue?: unknown; newValue?: unknown }
    > = {};
    for (const k of list) {
      if (typeof k === 'string' && k in data) {
        changes[k] = { oldValue: data[k], newValue: undefined };
        delete data[k];
      }
    }
    await this.writeStorage(ctx.id, data);
    this.fireStorageChanged(ctx.id, changes, area);
  }

  private async storageClear(
    ctx: ExtensionContext,
    _args: unknown[],
    area: 'local' | 'sync' = 'local',
  ): Promise<void> {
    const data = await this.readStorage(ctx.id);
    const changes: Record<
      string,
      { oldValue?: unknown; newValue?: unknown }
    > = {};
    for (const k of Object.keys(data)) {
      changes[k] = { oldValue: data[k], newValue: undefined };
    }
    await this.writeStorage(ctx.id, {});
    this.fireStorageChanged(ctx.id, changes, area);
  }

  private async storageGetBytesInUse(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<number> {
    const data = await this.readStorage(ctx.id);
    const subset = this.filterByKeys(data, args[0]);
    return new Blob([JSON.stringify(subset)]).size;
  }

  private async storageSessionGet(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<Record<string, unknown>> {
    const data = this.sessionStorage.get(ctx.id) ?? {};
    return this.filterByKeys(data, args[0]);
  }

  private async storageSessionSet(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<void> {
    const items = args[0] as Record<string, unknown> | null | undefined;
    if (!items || typeof items !== 'object') return;
    let data = this.sessionStorage.get(ctx.id);
    if (!data) { data = {}; this.sessionStorage.set(ctx.id, data); }
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: data[k], newValue: v };
      data[k] = v;
    }
    this.fireStorageChanged(ctx.id, changes, 'session');
  }

  private async storageSessionRemove(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<void> {
    const keys = args[0];
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
    const data = this.sessionStorage.get(ctx.id);
    if (!data) return;
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const k of list) {
      if (typeof k === 'string' && k in data) {
        changes[k] = { oldValue: data[k], newValue: undefined };
        delete data[k];
      }
    }
    this.fireStorageChanged(ctx.id, changes, 'session');
  }

  private async storageSessionClear(
    ctx: ExtensionContext,
    _args: unknown[],
  ): Promise<void> {
    const data = this.sessionStorage.get(ctx.id);
    if (!data) return;
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const k of Object.keys(data)) {
      changes[k] = { oldValue: data[k], newValue: undefined };
    }
    this.sessionStorage.delete(ctx.id);
    this.fireStorageChanged(ctx.id, changes, 'session');
  }

  private async storageSessionGetBytesInUse(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<number> {
    const data = this.sessionStorage.get(ctx.id) ?? {};
    const subset = this.filterByKeys(data, args[0]);
    return new Blob([JSON.stringify(subset)]).size;
  }

  private async storageManagedGet(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<Record<string, unknown>> {
    let data = this.managedStorageCache.get(ctx.id);
    if (data === undefined) {
      try {
        const bytes = await readExtensionFile(ctx.id, '__helium_managed__.json');
        data = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>) : null;
      } catch { data = null; }
      this.managedStorageCache.set(ctx.id, data);
    }
    if (!data) return {};
    return this.filterByKeys(data, args[0]);
  }

  private async storageManagedGetBytesInUse(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<number> {
    const data = await this.storageManagedGet(ctx, args);
    return new Blob([JSON.stringify(data)]).size;
  }

  private filterByKeys(
    data: Record<string, unknown>,
    keys: unknown,
  ): Record<string, unknown> {
    if (keys === null || keys === undefined) return { ...data };
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (typeof k === 'string' && k in data) out[k] = data[k];
      return out;
    }
    if (typeof keys === 'string') {
      return keys in data ? { [keys]: data[keys] } : {};
    }
    if (typeof keys === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, defaultVal] of Object.entries(keys as Record<string, unknown>)) {
        out[k] = k in data ? data[k] : defaultVal;
      }
      return out;
    }
    return {};
  }

  private async readStorage(id: string): Promise<Record<string, unknown>> {
    const bytes = await readExtensionFile(id, '__helium_storage__.json');
    if (!bytes) return {};
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (
        parsed?.version === 1 &&
        parsed?.data &&
        typeof parsed.data === 'object'
      ) {
        return parsed.data;
      }
    } catch (err) {
      console.warn(
        `[ExtensionManager] storage read failed for ${id}:`,
        err,
      );
    }
    return {};
  }

  private async writeStorage(
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const json = JSON.stringify({ version: 1, data });
    await writeExtensionFile(
      id,
      '__helium_storage__.json',
      new TextEncoder().encode(json),
    );
  }

  private async runtimeSendMessage(
    ctx: ExtensionContext,
    args: unknown[],
  ): Promise<unknown> {
    let targetId: string;
    let message: unknown;
    if (typeof args[0] === 'string' && args.length >= 2) {
      targetId = args[0];
      message = args[1];
    } else {
      targetId = ctx.id;
      message = args[0];
    }

    const target = this.spawned.get(targetId);
    if (!target) {
      throw new Error(
        `Could not establish connection. Receiving end does not exist.`,
      );
    }

    if (targetId !== ctx.id) {
      const ec = (target.ctx.manifest as any).externally_connectable;
      const ids = ec?.ids;
      if (
        !Array.isArray(ids) ||
        (!ids.includes('*') && !ids.includes(ctx.id))
      ) {
        throw new Error(
          `Could not establish connection. Receiving end does not exist.`,
        );
      }
    }

    const sender = { id: ctx.id, origin: `https://${ctx.origin}` };
    const eventName = targetId !== ctx.id
      ? 'chrome.runtime.onMessageExternal'
      : 'chrome.runtime.onMessage';
    return target.channel.requestEvent(
      eventName,
      [message, sender],
      { timeoutMs: SEND_MESSAGE_TIMEOUT_MS },
    );
  }

  /**
   * Phase 3 helper: broadcast the current DNR rule set for an extension
   * to the SW so the SW-level fallback (Task 30) can evaluate the rules
   * locally for requests that bypass Scramjet.
   */
  private syncDnrToSw(extId: string, removed = false): void {
    if (!this.dnrStorage) return;
    const s = this.spawned.get(extId);
    if (!s && !removed) return;
    const hasPerm = removed
      ? false
      : collectPermissions(s!.ctx.manifest).has('declarativeNetRequest');
    try {
      const rules = removed ? [] : this.dnrStorage.getAllActiveRules(extId);
      const extOrigin = removed ? '' : s!.ctx.origin;
      pushRulesToSw(buildSwDnrUpdate(extId, extOrigin, rules, hasPerm));
    } catch (err) {
      console.warn(`[ExtensionManager] syncDnrToSw failed for ${extId}:`, err);
    }
  }

  public fireEventOn(id: string, method: string, args: unknown[]): void {
    const s = this.spawned.get(id);
    if (!s) return;
    s.channel.sendEvent(method, args);
    this.contentScriptRelay?.fanoutToContentScripts(id, method, args);
  }

  /**
   * Fan out an event to every spawned extension whose manifest declares
   * `requiredPerm` (or to all spawned extensions when `requiredPerm` is
   * omitted). Each recipient receives the event in both the BG channel
   * and any of their content scripts via the relay.
   */
  public fanoutEvent(method: string, args: unknown[], requiredPerm?: string): void {
    for (const [id, s] of this.spawned) {
      if (requiredPerm) {
        const perms = collectPermissions(s.ctx.manifest);
        if (!perms.has(requiredPerm)) continue;
      }
      this.fireEventOn(id, method, args);
    }
  }

  private emit(event: string, id: string): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(id);
      } catch (err) {
        console.error('[ExtensionManager] listener threw:', err);
      }
    }
  }
}
