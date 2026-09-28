import type { MenuInterface } from "./types";
import { Items } from "@browser/items";
import { Nightmare as UI } from "@pkgs/Nightmare";
import { openExtensionPopup } from "@browser/extensions/popupHost";
import { SettingsAPI } from "@apis/settings";

interface ExtensionEntry {
  id: string;
  name: string;
  version: string;
  manifestVersion: 2 | 3;
  enabled: boolean;
  origin: string;
  manifest: Record<string, unknown>;
}

interface ExtensionManagerLike {
  getRunning(): Array<{
    id: string;
    ctx: {
      id: string;
      origin: string;
      manifest: Record<string, unknown>;
    };
  }>;
  listAllWithManifest?: () => Promise<ExtensionEntry[]>;
  setEnabled?: (id: string, enabled: boolean) => Promise<void>;
  uninstall?: (id: string) => Promise<void>;
  grantActiveTab?: (extId: string, tabId: number) => void;
  fireEventOn?: (extId: string, method: string, args: unknown[]) => void;
  getIconDataUrl?: (extId: string, iconPath: string) => Promise<string | null>;
  on?: (
    event: "installed" | "uninstalled" | "enabled" | "disabled",
    listener: (id: string) => void,
  ) => void;
  actionHandlers?: {
    getEffectiveSnapshot(extId: string, tabId?: number): {
      title?: string;
      popup?: string;
      badgeText?: string;
      badgeBgColor?: string;
      badgeTextColor?: string;
      enabled?: boolean;
      iconPath?: unknown;
    };
  };
}

const PIN_SETTINGS_KEY = "pinnedExtensions";
let prefsApi: SettingsAPI | null = null;
function getPrefsApi(): SettingsAPI {
  if (!prefsApi) {
    prefsApi = new SettingsAPI("/data/extension-prefs.json", "/data");
  }
  return prefsApi;
}

async function loadPinned(): Promise<Set<string>> {
  try {
    const raw = await getPrefsApi().getItem<string[]>(PIN_SETTINGS_KEY);
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

async function setPinned(extId: string, pinned: boolean): Promise<void> {
  const current = await loadPinned();
  if (pinned) current.add(extId);
  else current.delete(extId);
  await getPrefsApi().setItem(PIN_SETTINGS_KEY, Array.from(current));
}

export class MenuManager implements MenuInterface {
  private items: Items;
  private ui: UI;

  private refreshContent: (() => void) | null = null;
  private extEventsBound = false;
  private menusBound = false;
  private extrasCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(items: Items, ui: UI, _nightmarePlugins: unknown = null) {
    this.items = items;
    this.ui = ui;
  }

  menus(): void {
    const menuBtn = this.items.extrasButton;
    const menuPopup = this.items.menuContent;

    if (menuBtn && menuPopup && !this.menusBound) {
      this.menusBound = true;
      menuPopup.style.transition = "opacity .18s ease, transform .18s ease";

      const openMenu = () => {
        if (this.extrasCloseTimeout !== null) {
          clearTimeout(this.extrasCloseTimeout);
          this.extrasCloseTimeout = null;
        }
        menuPopup.style.pointerEvents = "auto";
        menuPopup.style.opacity = "1";
        menuPopup.style.transform = "scale(1)";
        menuPopup.style.zIndex = "99999999";
        menuPopup.style.willChange = "opacity, transform";
      };

      const closeMenu = () => {
        if (this.extrasCloseTimeout !== null) {
          clearTimeout(this.extrasCloseTimeout);
        }
        menuPopup.style.opacity = "0";
        menuPopup.style.transform = "scale(.95)";
        this.extrasCloseTimeout = setTimeout(() => {
          menuPopup.style.pointerEvents = "none";
          this.extrasCloseTimeout = null;
        }, 180);
      };

      closeMenu();

      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = menuPopup.style.opacity === "1";
        open ? closeMenu() : openMenu();
      });

      menuPopup.querySelectorAll("li").forEach((item) => {
        item.addEventListener("click", () => {
          closeMenu();
        });
      });

      document.addEventListener("pointerdown", (e) => {
        const target = e.target;
        const rightClickMenu =
          this.ui.rightclickmenu ?? this.ui.np?.rightclickmenu;
        if (
          !(target instanceof Node) ||
          !rightClickMenu?.container?.contains(target)
        ) {
          rightClickMenu?.closeMenu();
        }

        if (
          !(target instanceof Node) ||
          (!menuPopup.contains(target) && !menuBtn.contains(target))
        )
          closeMenu();
      }, true);

      document.addEventListener("ddx:page.clicked", () => {
        const rightClickMenu =
          this.ui.rightclickmenu ?? this.ui.np?.rightclickmenu;
        rightClickMenu?.closeMenu();
        closeMenu();
      });
    }
  }

  /**
   * Edge-style Extensions dropdown.
   *
   * Implemented with a self-managed floating popover (NOT Nightmare's
   * SideMenu) because:
   *   1. SideMenu appends to document.body (outside DDX's shadow root),
   *      breaking CSS scoping
   *   2. SideMenu's `.menu-container` has no styling (no position:fixed)
   *      so anchoring to a button doesn't work
   *
   * Layout (top → bottom):
   *   ┌─────────────────────────────────┐
   *   │ Extensions                      │  ← title header
   *   │ [📦 Manage extensions]          │  ← big button (per user spec)
   *   ├─────────────────────────────────┤
   *   │ [icon] Name              📌 ⋯  │  ← row: click → run/popup
   *   │        Access status            │
   *   │  ...                            │
   *   └─────────────────────────────────┘
   */
  extensionsMenu(button: HTMLButtonElement): void {
    const extMgr = (window as { extensions?: ExtensionManagerLike }).extensions;
    if (extMgr?.on && !this.extEventsBound) {
      const rerender = () => {
        if (this.refreshContent) this.refreshContent();
      };
      extMgr.on("installed", rerender);
      extMgr.on("uninstalled", rerender);
      extMgr.on("enabled", rerender);
      extMgr.on("disabled", rerender);
      this.extEventsBound = true;
    }

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const existing = document.querySelector(".helium-ext-popover");
      if (existing) {
        existing.remove();
        this.refreshContent = null;
        return;
      }
      this.openExtensionsPopover(button);
    });
  }

  private openExtensionsPopover(button: HTMLButtonElement): void {
    const popover = document.createElement("div");
    popover.className = "helium-ext-popover";

    const rect = button.getBoundingClientRect();
    Object.assign(popover.style, {
      position: "fixed",
      left: `${rect.right + 8}px`,
      top: `${rect.top}px`,
      width: "340px",
      maxHeight: "min(560px, calc(100vh - 24px))",
      overflowY: "auto",
      background: "#1c1c1c",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "10px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      zIndex: "99999999",
      color: "#fff",
      fontSize: "13px",
      padding: "0",
      opacity: "0",
      transform: "translateY(-4px)",
      transition: "opacity .12s ease, transform .12s ease",
    } satisfies Partial<CSSStyleDeclaration>);

    requestAnimationFrame(() => {
      const popoverRect = popover.getBoundingClientRect();
      if (popoverRect.bottom > window.innerHeight - 12) {
        popover.style.top = `${Math.max(12, window.innerHeight - popoverRect.height - 12)}px`;
      }
      if (popoverRect.right > window.innerWidth - 12) {
        popover.style.left = `${Math.max(12, rect.left - popoverRect.width - 8)}px`;
      }
      popover.style.opacity = "1";
      popover.style.transform = "translateY(0)";
    });

    const titleBar = document.createElement("div");
    Object.assign(titleBar.style, {
      padding: "14px 16px 8px",
      fontSize: "14px",
      fontWeight: "600",
      color: "#fff",
    } satisfies Partial<CSSStyleDeclaration>);
    titleBar.textContent = "Extensions (Beta)";
    popover.appendChild(titleBar);

    const manageRow = document.createElement("button");
    Object.assign(manageRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      width: "100%",
      padding: "10px 16px",
      margin: "0 0 4px",
      background: "transparent",
      border: "none",
      color: "#fff",
      cursor: "pointer",
      fontSize: "13px",
      textAlign: "left",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
    } satisfies Partial<CSSStyleDeclaration>);
    manageRow.appendChild(iconSvg("settings", 16));
    const manageLabel = document.createElement("span");
    manageLabel.style.flex = "1";
    manageLabel.textContent = "Manage extensions";
    manageRow.appendChild(manageLabel);
    manageRow.appendChild(iconSvg("chevron-right", 14));
    manageRow.addEventListener("click", () => {
      (window as { tabs?: { createTab: (u: string) => unknown } }).tabs
        ?.createTab("ddx://extensions/");
      closePopover();
    });
    attachHoverBg(manageRow);
    popover.appendChild(manageRow);

    const listEl = document.createElement("div");
    listEl.style.padding = "4px 0";
    popover.appendChild(listEl);

    const closePopover = () => {
      popover.style.opacity = "0";
      popover.style.transform = "translateY(-4px)";
      setTimeout(() => popover.remove(), 120);
      document.removeEventListener("click", outsideClick);
      this.refreshContent = null;
    };

    const outsideClick = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && e.target !== button && !button.contains(e.target as Node)) {
        closePopover();
      }
    };

    const renderList = async () => {
      listEl.innerHTML = "";
      const pinned = await loadPinned();
      const entries = await this.fetchEntries();

      if (entries.length === 0) {
        const empty = document.createElement("div");
        Object.assign(empty.style, {
          padding: "24px 16px",
          textAlign: "center",
          fontSize: "12px",
          color: "rgba(255,255,255,0.55)",
        } satisfies Partial<CSSStyleDeclaration>);
        empty.textContent = "No extensions installed yet.";
        listEl.appendChild(empty);
        return;
      }

      entries.sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const closeApi = { closeMenu: closePopover };
      for (const ext of entries) {
        listEl.appendChild(
          this.buildExtensionRow(ext, pinned, closeApi, renderList),
        );
      }
    };

    this.refreshContent = () => {
      void renderList();
    };
    void renderList();

    document.body.appendChild(popover);
    setTimeout(() => {
      document.addEventListener("click", outsideClick);
    }, 0);
  }

  private async fetchEntries(): Promise<ExtensionEntry[]> {
    const extMgr = (window as { extensions?: ExtensionManagerLike }).extensions;
    if (!extMgr) return [];
    if (extMgr.listAllWithManifest) {
      try { return await extMgr.listAllWithManifest(); } catch { /* fall back */ }
    }
    return extMgr.getRunning().map((s) => ({
      id: s.id,
      name: (s.ctx.manifest.name as string | undefined) ?? s.id,
      version: (s.ctx.manifest.version as string | undefined) ?? "",
      manifestVersion: ((s.ctx.manifest.manifest_version as number | undefined) ?? 3) as 2 | 3,
      enabled: true,
      origin: s.ctx.origin,
      manifest: s.ctx.manifest,
    }));
  }

  private buildExtensionRow(
    ext: ExtensionEntry,
    pinned: Set<string>,
    sidemenu: { closeMenu: () => void },
    rerender: () => void,
  ): HTMLElement {
    const extMgr = (window as { extensions?: ExtensionManagerLike }).extensions;
    const manifest = ext.manifest as {
      name?: string;
      action?: { default_icon?: string | Record<string, string>; default_popup?: string };
      browser_action?: { default_icon?: string | Record<string, string>; default_popup?: string };
      icons?: Record<string, string>;
      host_permissions?: string[];
      permissions?: string[];
      homepage_url?: string;
    };
    const actionSnap = extMgr?.actionHandlers?.getEffectiveSnapshot(ext.id, undefined);
    const displayName = manifest.name ?? ext.name;
    const iconPath = resolveIconPath(manifest, actionSnap?.iconPath);
    const popup = actionSnap?.popup ?? manifest.action?.default_popup ?? manifest.browser_action?.default_popup ?? null;
    const badgeText = actionSnap?.badgeText ?? "";
    const badgeBg = actionSnap?.badgeBgColor ?? "#666";
    const badgeFg = actionSnap?.badgeTextColor ?? "#fff";
    const accessLabel = describeAccess(manifest);
    const isPinned = pinned.has(ext.id);
    const isEnabled = ext.enabled;

    const row = this.ui.createElement("div", {
      class: "extensions-menu-row",
      style: [
        "display:flex;align-items:center;gap:10px;",
        "padding:8px 12px 8px 16px;",
        "color:#fff;font-size:13px;",
        "position:relative;",
        isEnabled ? "" : "opacity:0.55;",
      ].join(""),
    }) as HTMLDivElement;

    const clickArea = this.ui.createElement("button", {
      class: "extensions-menu-row-main",
      style: [
        "flex:1;min-width:0;display:flex;align-items:center;gap:10px;",
        "background:transparent;border:none;color:inherit;",
        "padding:0;cursor:pointer;text-align:left;",
      ].join(""),
      title: actionSnap?.title ?? displayName,
      onclick: () =>
        this.onExtensionRowClick(ext, popup, extMgr, sidemenu, clickArea),
    }) as HTMLButtonElement;

    const iconWrap = this.ui.createElement("div", {
      style: [
        "position:relative;width:24px;height:24px;flex-shrink:0;",
        "border-radius:6px;background:rgba(255,255,255,0.05);",
        "display:flex;align-items:center;justify-content:center;overflow:hidden;",
      ].join(""),
    }) as HTMLDivElement;

    if (iconPath && extMgr?.getIconDataUrl) {
      const placeholder = fallbackIconSvg();
      iconWrap.appendChild(placeholder);
      extMgr.getIconDataUrl(ext.id, iconPath).then((dataUrl) => {
        if (!dataUrl) return;
        const img = this.ui.createElement("img", {
          style: "width:100%;height:100%;object-fit:contain;",
          alt: "",
        }) as HTMLImageElement;
        img.src = dataUrl;
        img.onerror = () => img.remove();
        placeholder.remove();
        iconWrap.appendChild(img);
      }).catch(() => { /* placeholder stays */ });
    } else {
      iconWrap.appendChild(fallbackIconSvg());
    }

    if (badgeText) {
      const badge = this.ui.createElement(
        "div",
        {
          style: [
            "position:absolute;bottom:-4px;right:-4px;",
            `background:${badgeBg};color:${badgeFg};`,
            "font-size:9px;font-weight:600;line-height:1;",
            "padding:2px 4px;border-radius:6px;",
            "min-width:14px;text-align:center;",
            "border:1.5px solid #1a1a1a;",
          ].join(""),
        },
        [badgeText],
      );
      iconWrap.appendChild(badge);
    }

    clickArea.appendChild(iconWrap);

    const textCol = this.ui.createElement("div", {
      style: "flex:1;min-width:0;",
    }) as HTMLDivElement;

    const nameEl = this.ui.createElement(
      "div",
      {
        style:
          "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;",
      },
      [displayName],
    );
    textCol.appendChild(nameEl);

    const sublabel = this.ui.createElement(
      "div",
      {
        style: [
          "font-size:11px;color:rgba(255,255,255,0.55);",
          "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;",
          "margin-top:1px;",
        ].join(""),
      },
      [isEnabled ? accessLabel : "Disabled"],
    );
    textCol.appendChild(sublabel);

    clickArea.appendChild(textCol);
    row.appendChild(clickArea);

    const pinBtn = this.ui.createElement("button", {
      class: "extensions-menu-pin",
      style: [
        "flex-shrink:0;background:transparent;border:none;",
        "padding:6px;cursor:pointer;border-radius:4px;",
        "display:flex;align-items:center;justify-content:center;",
        isPinned ? "color:#7aa9ff;" : "color:rgba(255,255,255,0.5);",
      ].join(""),
      title: isPinned ? "Unpin from toolbar" : "Pin to toolbar",
      onclick: async (e: MouseEvent) => {
        e.stopPropagation();
        try {
          await setPinned(ext.id, !isPinned);
          rerender();
        } catch (err) {
          console.warn("[menuManager] pin toggle failed:", err);
        }
      },
    }) as HTMLButtonElement;
    pinBtn.appendChild(iconSvg(isPinned ? "pin-filled" : "pin", 15));
    attachHoverBg(pinBtn);
    row.appendChild(pinBtn);
    pinBtn.addEventListener("click", () => {
      const tb = (window as { extensionToolbar?: { markPinsDirty?: () => void } }).extensionToolbar;
      tb?.markPinsDirty?.();
    });

    const moreBtn = this.ui.createElement("button", {
      class: "extensions-menu-more",
      style: [
        "flex-shrink:0;background:transparent;border:none;",
        "padding:6px;cursor:pointer;border-radius:4px;",
        "color:rgba(255,255,255,0.6);",
        "display:flex;align-items:center;justify-content:center;",
      ].join(""),
      title: "More options",
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        this.openRowMenu(ext, moreBtn, sidemenu, rerender, popup);
      },
    }) as HTMLButtonElement;
    moreBtn.appendChild(iconSvg("more", 16));
    attachHoverBg(moreBtn);
    row.appendChild(moreBtn);

    return row;
  }

  /**
   * Per-row "⋯" overflow menu — Open popup / Run / Pin / Disable /
   * Uninstall / Open homepage.
   */
  private openRowMenu(
    ext: ExtensionEntry,
    anchor: HTMLElement,
    parentMenu: { closeMenu: () => void },
    rerender: () => void,
    popup: string | null,
  ): void {
    const extMgr = (window as { extensions?: ExtensionManagerLike }).extensions;
    const manifest = ext.manifest as { homepage_url?: string };

    const existing = document.querySelector(".extensions-row-menu");
    if (existing) existing.remove();

    const menu = this.ui.createElement("div", {
      class: "extensions-row-menu",
      style: [
        "position:fixed;z-index:99999999;",
        "min-width:180px;background:#1c1c1c;",
        "border:1px solid rgba(255,255,255,0.1);",
        "border-radius:8px;padding:4px;",
        "box-shadow:0 8px 24px rgba(0,0,0,0.4);",
        "color:#fff;font-size:13px;",
      ].join(""),
    }) as HTMLDivElement;

    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 180)}px`;

    const item = (
      label: string,
      onclick: () => void,
      opts?: { destructive?: boolean; disabled?: boolean },
    ): HTMLElement => {
      const el = this.ui.createElement("button", {
        style: [
          "display:flex;align-items:center;gap:8px;width:100%;",
          "padding:6px 10px;border:none;",
          "background:transparent;color:inherit;",
          "text-align:left;font-size:13px;border-radius:4px;",
          opts?.disabled ? "opacity:0.4;cursor:not-allowed;" : "cursor:pointer;",
          opts?.destructive ? "color:#ff6b6b;" : "",
        ].join(""),
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          if (opts?.disabled) return;
          onclick();
          menu.remove();
        },
      }, [label]) as HTMLButtonElement;
      if (!opts?.disabled) attachHoverBg(el);
      return el;
    };

    const separator = (): HTMLElement =>
      this.ui.createElement("div", {
        style:
          "height:1px;background:rgba(255,255,255,0.08);margin:4px 0;",
      }) as HTMLDivElement;

    if (ext.enabled) {
      menu.appendChild(
        item(popup ? "Open popup" : "Run", () => {
          this.onExtensionRowClick(ext, popup, extMgr, parentMenu, anchor);
        }, { disabled: !ext.enabled }),
      );
    }

    if (manifest.homepage_url) {
      menu.appendChild(
        item("Open homepage", () => {
          (window as { tabs?: { createTab: (u: string) => unknown } }).tabs
            ?.createTab(manifest.homepage_url!);
          parentMenu.closeMenu();
        }),
      );
    }

    menu.appendChild(separator());

    menu.appendChild(
      item(ext.enabled ? "Disable" : "Enable", async () => {
        try {
          await extMgr?.setEnabled?.(ext.id, !ext.enabled);
          rerender();
        } catch (err) {
          console.warn("[menuManager] setEnabled failed:", err);
        }
      }),
    );

    menu.appendChild(
      item("Uninstall…", async () => {
        if (!confirm(`Uninstall "${ext.name}"?`)) return;
        try {
          await extMgr?.uninstall?.(ext.id);
          rerender();
        } catch (err) {
          console.warn("[menuManager] uninstall failed:", err);
        }
      }, { destructive: true }),
    );

    document.body.appendChild(menu);

    const dismiss = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", dismiss);
      }
    };
    setTimeout(() => document.addEventListener("click", dismiss), 0);
  }

  private onExtensionRowClick(
    ext: ExtensionEntry,
    popup: string | null,
    extMgr: ExtensionManagerLike | undefined,
    sidemenu: { closeMenu: () => void },
    rowEl: HTMLElement,
  ): void {
    if (!ext.enabled) return;
    const w = window as {
      tabs?: { activeTabId?: string | null };
      nyx?: { tabResolver?: { toNum?: (id: string) => number; info?: (n: number) => unknown } };
    };
    const activeTabId = w.tabs?.activeTabId ?? null;
    let tabIdNum: number | undefined;
    if (activeTabId && w.nyx?.tabResolver?.toNum) {
      try { tabIdNum = w.nyx.tabResolver.toNum(activeTabId); } catch { /* ignore */ }
    }
    if (tabIdNum !== undefined && extMgr?.grantActiveTab) {
      try { extMgr.grantActiveTab(ext.id, tabIdNum); } catch (err) { console.warn(err); }
    }

    if (popup) {
      try {
        openExtensionPopup({
          extId: ext.id,
          ctx: {
            id: ext.id,
            origin: ext.origin,
            manifest: ext.manifest,
          } as unknown as import('@core/helium').ExtensionContext,
          popupPath: popup,
          anchorEl: rowEl,
        });
      } catch (err) {
        console.warn("[menuManager] openExtensionPopup failed:", err);
      }
    } else {
      let tabInfo: unknown = undefined;
      if (tabIdNum !== undefined && w.nyx?.tabResolver?.info) {
        try { tabInfo = w.nyx.tabResolver.info(tabIdNum); } catch { /* ignore */ }
      }
      try {
        extMgr?.fireEventOn?.(ext.id, "chrome.action.onClicked", [tabInfo]);
      } catch (err) {
        console.warn("[menuManager] fireEventOn(onClicked) failed:", err);
      }
    }
    sidemenu.closeMenu();
  }
}

/**
 * Approximate Edge's per-extension "access" sub-label based on the
 * manifest's host_permissions / permissions. Real Edge tracks per-site
 * grants; v1 just classifies the manifest defaults.
 */
function describeAccess(manifest: {
  host_permissions?: string[];
  permissions?: string[];
}): string {
  const hosts = manifest.host_permissions ?? [];
  const perms = manifest.permissions ?? [];
  const hasAllUrls = hosts.some(
    (h) => h === "<all_urls>" || h === "*://*/*" || h === "http://*/*" || h === "https://*/*",
  );
  if (hasAllUrls) return "Allowed on all sites";
  if (hosts.length > 0) {
    if (hosts.length === 1) return `Allowed on ${friendlyHost(hosts[0]!)}`;
    return `Allowed on ${hosts.length} sites`;
  }
  if (perms.includes("activeTab")) return "Allowed only when clicked";
  return "No access needed";
}

function friendlyHost(pattern: string): string {
  const m = pattern.match(/^[*a-z]+:\/\/(?:\*\.)?([^/*]+)/i);
  return m && m[1] ? m[1] : pattern;
}

function resolveIconPath(
  manifest: {
    action?: { default_icon?: string | Record<string, string> };
    browser_action?: { default_icon?: string | Record<string, string> };
    icons?: Record<string, string>;
  },
  override: unknown,
): string | null {
  if (typeof override === "string") return override;
  if (override && typeof override === "object") {
    return pickFromIconMap(override as Record<string, string>);
  }
  const a = manifest.action?.default_icon ?? manifest.browser_action?.default_icon;
  if (typeof a === "string") return a;
  if (a && typeof a === "object") return pickFromIconMap(a);
  if (manifest.icons) return pickFromIconMap(manifest.icons);
  return null;
}

function pickFromIconMap(map: Record<string, string>): string | null {
  for (const size of ["32", "48", "16", "24", "64", "128"]) {
    const v = map[size];
    if (typeof v === "string") return v;
  }
  const first = Object.values(map).find((v) => typeof v === "string");
  return first ?? null;
}

function attachHoverBg(el: HTMLElement, color = "rgba(255,255,255,0.08)"): void {
  el.addEventListener("mouseenter", () => {
    el.style.background = color;
  });
  el.addEventListener("mouseleave", () => {
    el.style.background = "transparent";
  });
}

/**
 * Tiny inline SVG icons so we don't depend on lucide being initialized
 * inside the floating menu. Each returns an SVGElement node.
 */
function iconSvg(kind: string, size = 16): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.flexShrink = "0";

  const paths: Record<string, string[]> = {
    settings: [
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    ],
    "chevron-right": ["m9 18 6-6-6-6"],
    pin: [
      "M12 17v5",
      "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    ],
    "pin-filled": [
      "M12 17v5",
      "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    ],
    more: [
      "M12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z",
      "M5 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z",
      "M19 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z",
    ],
    puzzle: [
      "M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z",
    ],
  };

  const def = paths[kind] ?? paths.puzzle!;
  for (const d of def) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    if (kind === "pin-filled") path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
  }
  return svg;
}

function fallbackIconSvg(): SVGElement {
  const svg = iconSvg("puzzle", 14);
  svg.style.opacity = "0.6";
  return svg;
}
