import { createIcons, icons } from "lucide";
import { createRow } from "../components/row";
import { createSubpage } from "../components/subpage";
import { createToggle } from "../components/toggle";
import { showInlineNotice } from "../components/notice";
import { openSwitcherDropdown } from "../components/profileSwitcher";
import { openModal } from "../components/modal";
import { getEventsAPI, getProxy, getSettingsAPI, getHost } from "../data/host";
import type { SectionContext } from "./types";

export async function render(container: HTMLElement, ctx: SectionContext): Promise<void> {
  container.innerHTML = "";
  if (ctx.subpage === "delete-browsing-data") return renderDeleteBrowsingData(container);
  if (ctx.subpage === "site-settings") return renderSiteSettings(container);
  if (ctx.subpage === "network") return renderNetwork(container);
  if (ctx.subpage === "cloaking") return renderCloaking(container);
  if (ctx.subpage === "cloaking-editor") return renderCloakingEditor(container);
  if (ctx.subpage === "panic") return renderPanicConfig(container);
  return renderMain(container);
}

function renderMain(container: HTMLElement) {
  const section = document.createElement("div");
  section.className = "settings-section";
  section.dataset.sectionId = "privacy";

  const h2 = document.createElement("h2");
  h2.className = "settings-section-title";
  h2.textContent = "Privacy and security";
  section.appendChild(h2);

  section.appendChild(createRow({
    icon: "trash-2",
    label: "Delete browsing data",
    description: "Delete history, cookies, cache, and more",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#privacy?subpage=delete-browsing-data"; },
    searchUnit: { id: "privacy/clear", label: "Delete browsing data", sectionId: "privacy", keywords: ["clear", "history", "cookies", "cache"] },
  }));
  section.appendChild(createRow({
    icon: "circle-dot-dashed",
    label: "Site settings",
    description: "Manage site permissions and content settings",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#privacy?subpage=site-settings"; },
    searchUnit: { id: "privacy/sites", label: "Site settings", sectionId: "privacy", keywords: ["permissions", "location", "camera", "microphone", "notifications"] },
  }));
  section.appendChild(createRow({
    icon: "globe",
    label: "Network",
    description: "Transport, WISP server, remote proxy",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#privacy?subpage=network"; },
    searchUnit: { id: "privacy/network", label: "Network", sectionId: "privacy", keywords: ["transport", "wisp", "proxy", "libcurl", "pulsar"] },
  }));
  section.appendChild(createRow({
    icon: "eye-off",
    label: "Cloaking",
    description: "Tab cloak, URL cloak, custom title and favicon, panic button",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#privacy?subpage=cloaking"; },
    searchUnit: { id: "privacy/cloaking", label: "Cloaking", sectionId: "privacy", keywords: ["about:blank", "url cloak", "tab cloak", "panic", "favicon", "title"] },
  }));

  container.appendChild(section);
}

function renderDeleteBrowsingData(container: HTMLElement) {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Privacy and security",
    title: "Delete browsing data",
    parentSectionId: "privacy",
    render: (body) => {
      const timeSelect = document.createElement("select");
      timeSelect.className = "privacy-time-range";
      const ranges = [
        { v: "hour", label: "Last hour", sinceMs: 60 * 60 * 1000 },
        { v: "day", label: "Last 24 hours", sinceMs: 24 * 60 * 60 * 1000 },
        { v: "week", label: "Last 7 days", sinceMs: 7 * 24 * 60 * 60 * 1000 },
        { v: "month", label: "Last 4 weeks", sinceMs: 28 * 24 * 60 * 60 * 1000 },
        { v: "all", label: "All time", sinceMs: 0 },
      ];
      for (const r of ranges) {
        const opt = document.createElement("option");
        opt.value = r.v;
        opt.textContent = r.label;
        timeSelect.appendChild(opt);
      }
      timeSelect.value = "hour";
      body.appendChild(timeSelect);

      const checks: Array<{ key: string; label: string; default: boolean }> = [
        { key: "history", label: "Browsing history", default: true },
        { key: "cookies", label: "Cookies and site data", default: true },
        { key: "cache", label: "Cached images and files", default: true },
        { key: "downloads", label: "Download history", default: false },
        { key: "permissions", label: "Site permissions", default: false },
      ];
      const list = document.createElement("div");
      list.className = "privacy-checkbox-list";
      const state: Record<string, boolean> = {};
      for (const c of checks) {
        state[c.key] = c.default;
        const row = document.createElement("label");
        row.className = "privacy-checkbox-row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = c.default;
        input.addEventListener("change", () => { state[c.key] = input.checked; });
        row.appendChild(input);
        const lab = document.createElement("span");
        lab.textContent = c.label;
        row.appendChild(lab);
        list.appendChild(row);
      }
      body.appendChild(list);

      const btn = document.createElement("button");
      btn.className = "settings-button danger";
      btn.textContent = "Clear data";
      btn.addEventListener("click", async () => {
        const sel = ranges.find((r) => r.v === timeSelect.value)!;
        const since = sel.sinceMs === 0 ? 0 : Date.now() - sel.sinceMs;
        const dataTypes: Record<string, boolean> = {};
        if (state.history) dataTypes.history = true;
        if (state.cookies) {
          dataTypes.cookies = true;
          dataTypes.localStorage = true;
          dataTypes.indexedDB = true;
        }
        if (state.cache) dataTypes.cache = true;
        if (state.downloads) dataTypes.downloads = true;
        if (state.permissions) {
          const sps = (window as any).sitePermissionsStore;
          if (sps?.clearAll) {
            try {
              await sps.clearAll();
            } catch (e) {
              console.warn("[settings/privacy] clearAll permissions failed:", e);
            }
          }
        }
        try {
          await new Promise<void>((resolve) => {
            const cb = (window as any).chrome?.browsingData?.remove;
            if (typeof cb === "function") {
              cb({ since }, dataTypes, () => resolve());
              setTimeout(resolve, 5000);
            } else {
              resolve();
            }
          });
          alert("Browsing data cleared.");
        } catch (e) {
          console.error("[settings/privacy] clear browsing data failed", e);
        }
      });
      body.appendChild(btn);
    },
  });
  container.appendChild(sub);
}

function renderSiteSettings(container: HTMLElement) {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Privacy and security",
    title: "Site settings",
    parentSectionId: "privacy",
    render: async (body) => {
      const controls = document.createElement("div");
      controls.className = "sp-controls";
      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.id = "sp-search";
      searchInput.placeholder = "Search sites";
      controls.appendChild(searchInput);
      const clearAllBtn = document.createElement("button");
      clearAllBtn.id = "sp-clear-all";
      clearAllBtn.className = "settings-button danger";
      clearAllBtn.textContent = "Clear all";
      controls.appendChild(clearAllBtn);
      body.appendChild(controls);

      const empty = document.createElement("div");
      empty.id = "sp-empty";
      empty.className = "settings-empty-state";
      empty.style.display = "none";
      const emptyIcon = document.createElement("i");
      emptyIcon.setAttribute("data-lucide", "shield-check");
      emptyIcon.className = "empty-icon";
      empty.appendChild(emptyIcon);
      const emptyTitle = document.createElement("div");
      emptyTitle.className = "empty-title";
      emptyTitle.textContent = "No site permissions set";
      empty.appendChild(emptyTitle);
      body.appendChild(empty);

      const list = document.createElement("div");
      list.id = "sp-sites-list";
      body.appendChild(list);

      createIcons({ icons });

      const sps: any = (window as any).sitePermissionsStore;
      if (!sps) {
        empty.style.display = "flex";
        emptyTitle.textContent = "Site permissions unavailable";
        return;
      }
      await renderSitePermissionsList(list, empty, searchInput, clearAllBtn, sps);
    },
  });
  container.appendChild(sub);
}

interface PermissionGrant { origin: string; name: string; state: string; }

async function renderSitePermissionsList(
  listEl: HTMLElement,
  emptyEl: HTMLElement,
  searchEl: HTMLInputElement,
  clearEl: HTMLButtonElement,
  sps: any,
): Promise<void> {
  async function refresh() {
    const all: PermissionGrant[] = (await sps.listAll()) ?? [];
    const byOrigin = new Map<string, PermissionGrant[]>();
    for (const g of all) {
      const arr = byOrigin.get(g.origin) ?? [];
      arr.push(g);
      byOrigin.set(g.origin, arr);
    }
    const q = searchEl.value.trim().toLowerCase();
    const origins = [...byOrigin.keys()].filter((o) => !q || o.toLowerCase().includes(q)).sort();

    listEl.innerHTML = "";
    if (origins.length === 0) {
      emptyEl.style.display = "flex";
      return;
    }
    emptyEl.style.display = "none";
    for (const origin of origins) {
      const grants = byOrigin.get(origin)!;
      const card = document.createElement("div");
      card.className = "sp-site-card";

      const header = document.createElement("div");
      header.className = "sp-site-header";
      const originEl = document.createElement("strong");
      originEl.textContent = origin;
      header.appendChild(originEl);
      const resetBtn = document.createElement("button");
      resetBtn.className = "settings-button ghost";
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", async () => {
        try {
          await sps.clearForOrigin(origin);
          await refresh();
        } catch (e) {
          console.warn("[settings/privacy] clearForOrigin failed:", e);
        }
      });
      header.appendChild(resetBtn);
      card.appendChild(header);

      const grantsEl = document.createElement("div");
      grantsEl.className = "sp-grants";
      for (const g of grants) {
        const grantEl = document.createElement("div");
        grantEl.className = "sp-grant";
        grantEl.textContent = `${g.name}: ${g.state}`;
        grantsEl.appendChild(grantEl);
      }
      card.appendChild(grantsEl);
      listEl.appendChild(card);
    }
  }

  searchEl.addEventListener("input", () => { void refresh(); });
  clearEl.addEventListener("click", async () => {
    if (confirm("Clear all site permissions? This cannot be undone.")) {
      try {
        await sps.clearAll();
        await refresh();
      } catch (e) {
        console.warn("[settings/privacy] clearAll failed:", e);
      }
    }
  });
  if (typeof sps.addChangeListener === "function") {
    sps.addChangeListener(() => { void refresh(); });
  }
  await refresh();
}

type TransportId = "libcurl" | "pulsar";
const TRANSPORTS: Array<{ id: TransportId; label: string }> = [
  { id: "libcurl", label: "Libcurl" },
  { id: "pulsar", label: "Pulsar" },
];

function getDefaultWispUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/wisp/`;
}

function generateRandomNightWisp(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const length = 16 + Math.floor(Math.random() * 17);
  let subdomain = "";
  for (let i = 0; i < length; i++) {
    subdomain += chars[Math.floor(Math.random() * chars.length)];
  }
  return `wss://${subdomain}.nightwisp.me.cdn.cloudflare.net/wisp/`;
}

function isGeneratedWispUrl(url: string): boolean {
  // Match on the protected "nightwisp" token (survives the byte-scrub). A
  // regex embedding the escaped `\/wisp\/` would have its `wisp` scrubbed and
  // never match the (protected) real URL.
  return url.includes("nightwisp");
}

function renderNetwork(container: HTMLElement) {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Privacy and security",
    title: "Network",
    parentSectionId: "privacy",
    render: async (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";

      const transportRow = document.createElement("div");
      transportRow.className = "settings-row no-hover";
      const tStack = document.createElement("div");
      tStack.className = "row-stack";
      const tLabel = document.createElement("div");
      tLabel.className = "row-label";
      tLabel.textContent = "Transport";
      tStack.appendChild(tLabel);
      const tSub = document.createElement("div");
      tSub.className = "row-sub";
      tSub.textContent = "Network transport used for proxied connections.";
      tStack.appendChild(tSub);
      transportRow.appendChild(tStack);

      const tRight = document.createElement("div");
      tRight.className = "row-right";
      const tNameEl = document.createElement("span");
      tNameEl.style.color = "var(--proto)";
      tNameEl.style.marginRight = "4px";
      tNameEl.textContent = "Loading…";
      tRight.appendChild(tNameEl);
      const tBtn = document.createElement("button");
      tBtn.className = "settings-button ghost";
      tBtn.textContent = "Change";
      tRight.appendChild(tBtn);
      transportRow.appendChild(tRight);
      stack.appendChild(transportRow);

      const wispRow = document.createElement("div");
      wispRow.className = "settings-row no-hover";
      const wStack = document.createElement("div");
      wStack.className = "row-stack";
      const wLabel = document.createElement("div");
      wLabel.className = "row-label";
      wLabel.textContent = "WISP server";
      wStack.appendChild(wLabel);
      const wSub = document.createElement("div");
      wSub.className = "row-sub";
      wSub.textContent = "Pick a preset, enter a custom URL, or generate a Night-WISP subdomain.";
      wStack.appendChild(wSub);
      wispRow.appendChild(wStack);

      const wRight = document.createElement("div");
      wRight.className = "row-right";
      wRight.style.flexWrap = "wrap";
      wRight.style.justifyContent = "flex-end";

      const presetBtn = document.createElement("button");
      presetBtn.className = "settings-button ghost";
      presetBtn.style.maxWidth = "260px";
      presetBtn.style.overflow = "hidden";
      presetBtn.style.textOverflow = "ellipsis";
      presetBtn.style.whiteSpace = "nowrap";
      presetBtn.textContent = "Loading…";
      const generateBtn = document.createElement("button");
      generateBtn.className = "settings-button ghost";
      generateBtn.textContent = "Generate";
      generateBtn.title = "Generate a random Night-WISP server URL";

      const customInput = document.createElement("input");
      customInput.type = "text";
      customInput.className = "modal-input";
      customInput.placeholder = "wss://example.com/wisp/";
      customInput.style.width = "260px";
      customInput.style.display = "none";
      const saveBtn = document.createElement("button");
      saveBtn.className = "settings-button";
      saveBtn.textContent = "Save";
      saveBtn.style.display = "none";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "settings-button ghost";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.display = "none";

      wRight.appendChild(presetBtn);
      wRight.appendChild(generateBtn);
      wRight.appendChild(customInput);
      wRight.appendChild(saveBtn);
      wRight.appendChild(cancelBtn);
      wispRow.appendChild(wRight);
      stack.appendChild(wispRow);

      const proxyRow = document.createElement("div");
      proxyRow.className = "settings-row no-hover";
      const pStack = document.createElement("div");
      pStack.className = "row-stack";
      const pLabel = document.createElement("div");
      pLabel.className = "row-label";
      pLabel.textContent = "Remote proxy URL";
      pStack.appendChild(pLabel);
      const pSub = document.createElement("div");
      pSub.className = "row-sub";
      pSub.textContent = "Optional upstream proxy (socks5h://, socks5://, socks4://, http://, https://).";
      pStack.appendChild(pSub);
      proxyRow.appendChild(pStack);
      const pRight = document.createElement("div");
      pRight.className = "row-right";
      const proxyInput = document.createElement("input");
      proxyInput.type = "text";
      proxyInput.className = "modal-input";
      proxyInput.placeholder = "socks5h://user:pass@host:port";
      pRight.appendChild(proxyInput);
      proxyRow.appendChild(pRight);
      stack.appendChild(proxyRow);

      const hint = document.createElement("div");
      hint.className = "row-sub";
      hint.style.padding = "0 16px 8px";
      hint.textContent = "\u24D8 Remote proxy only works when transport is Libcurl.";
      stack.appendChild(hint);

      body.appendChild(stack);

      const api = getSettingsAPI();

      let currentTransport: TransportId = "libcurl";
      try {
        const raw = await api.getItem<string>("transports");
        const match = TRANSPORTS.find((t) => t.id === raw);
        currentTransport = (match?.id as TransportId) ?? "libcurl";
        tNameEl.textContent = match?.label ?? "Libcurl";
      } catch {
        tNameEl.textContent = "Libcurl";
      }

      try {
        const p = await api.getItem<string>("proxyServer");
        proxyInput.value = p ?? "";
      } catch {
        proxyInput.value = "";
      }

      type WispOption = { id: string; url: string; label: string };
      const defaultWispUrl = getDefaultWispUrl();
      const baseOptions: WispOption[] = [
        { id: "auto", url: "auto", label: "Automatic (Default)" },
        { id: "default", url: defaultWispUrl, label: "Default Server" },
      ];
      let premiumOptions: WispOption[] = [];
      try {
        const npMod = await import("../../../apis/nightplus");
        if (await npMod.isAuthenticated()) {
          const servers = await npMod.getPremiumWispServers();
          premiumOptions = (servers ?? []).map((s: any) => ({
            id: s.url,
            url: s.url,
            label: s.name || s.url,
          }));
        }
      } catch (err) {
        console.warn("[settings/privacy/network] premium WISP load failed", err);
      }

      let savedWisp = "";
      try {
        savedWisp = (await api.getItem<string>("wisp")) ?? "";
      } catch { /* ignore */ }

      const resolveLabel = (url: string): string => {
        if (!url || url === "auto") return "Automatic (Default)";
        const matched = [...baseOptions, ...premiumOptions].find((o) => o.url === url);
        if (matched) return matched.label;
        if (isGeneratedWispUrl(url)) return "Generated server";
        return "Custom server";
      };
      presetBtn.textContent = resolveLabel(savedWisp);

      const enterCustomMode = (seed?: string) => {
        presetBtn.style.display = "none";
        generateBtn.style.display = "none";
        customInput.style.display = "";
        saveBtn.style.display = "";
        cancelBtn.style.display = "";
        customInput.value = seed ?? savedWisp ?? "";
        customInput.focus();
      };
      const exitCustomMode = () => {
        customInput.style.display = "none";
        saveBtn.style.display = "none";
        cancelBtn.style.display = "none";
        presetBtn.style.display = "";
        generateBtn.style.display = "";
      };

      const commitWisp = async (raw: string, opts: { skipSwap?: boolean } = {}) => {
        const value = raw.trim();
        try {
          if (!value || value === "auto") {
            await api.removeItem("wisp");
            savedWisp = "";
          } else {
            await api.setItem("wisp", value);
            savedWisp = value;
          }
          if (!opts.skipSwap) {
            try {
              const proxy = await getProxy();
              await proxy.swapWispServer(savedWisp || undefined);
            } catch (err) {
              console.warn("[settings/privacy/network] swapWispServer failed", err);
            }
          }
          presetBtn.textContent = resolveLabel(savedWisp);
          try { getEventsAPI().emit("wisp:changed", null); } catch { /* ignore */ }
        } catch (err) {
          console.warn("[settings/privacy/network] wisp save failed", err);
          showInlineNotice("Failed to save WISP server URL.", { kind: "error" });
        }
      };

      presetBtn.addEventListener("click", () => {
        const entries: any[] = [];
        for (const opt of baseOptions) {
          entries.push({
            id: opt.id,
            label: opt.label,
            iconOnly: opt.id === "auto" ? "wand-sparkles" : "server",
            onClick: () => { void commitWisp(opt.url); },
          });
        }
        if (premiumOptions.length > 0) {
          entries.push({ id: "_h_premium", label: "Night+ premium servers", header: true });
          for (const opt of premiumOptions) {
            entries.push({
              id: opt.id,
              label: opt.label,
              iconOnly: "crown",
              onClick: () => { void commitWisp(opt.url); },
            });
          }
        }
        entries.push({ id: "_h_other", label: "Other", header: true });
        entries.push({
          id: "custom",
          iconOnly: "edit",
          label: "Custom WISP server…",
          onClick: () => enterCustomMode(savedWisp && !isGeneratedWispUrl(savedWisp) && savedWisp !== "auto" ? savedWisp : ""),
        });
        openSwitcherDropdown(presetBtn, entries);
      });

      generateBtn.addEventListener("click", async () => {
        const newWisp = generateRandomNightWisp();
        await commitWisp(newWisp);
        showInlineNotice(`Generated WISP: ${newWisp}`);
      });

      saveBtn.addEventListener("click", async () => {
        const value = customInput.value.trim();
        if (!value) {
          showInlineNotice("Enter a WISP URL or press Cancel.", { kind: "error" });
          return;
        }
        await commitWisp(value);
        exitCustomMode();
      });
      cancelBtn.addEventListener("click", () => {
        exitCustomMode();
      });
      customInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { saveBtn.click(); }
        else if (e.key === "Escape") { cancelBtn.click(); }
      });

      tBtn.addEventListener("click", () => {
        const entries = TRANSPORTS.map((t) => ({
          id: t.id,
          label: t.label,
          onClick: async () => {
            try {
              await api.setItem("transports", t.id);
              currentTransport = t.id;
              tNameEl.textContent = t.label;
              try { getEventsAPI().emit("transport:changed", null); } catch { /* ignore */ }
              showInlineNotice("Transport changed — restart may be required to fully apply");
            } catch (err) {
              console.warn("[settings/privacy/network] transport set failed", err);
              showInlineNotice("Failed to change transport.", { kind: "error" });
            }
          },
        }));
        openSwitcherDropdown(tBtn, entries);
      });
      void currentTransport;

      const proxyRegex = /^(socks5h:\/\/|socks5:\/\/|socks4:\/\/|http:\/\/|https:\/\/).+/i;
      const commitProxy = async () => {
        const value = proxyInput.value.trim();
        if (value !== "" && !proxyRegex.test(value)) {
          showInlineNotice(
            "Remote proxy URL must start with socks5h://, socks5://, socks4://, http://, or https:// (or be empty).",
            { kind: "error" },
          );
          return;
        }
        try {
          await api.setItem("proxyServer", value);
          try { getEventsAPI().emit("proxyServer:changed", null); } catch { /* ignore */ }
        } catch (err) {
          console.warn("[settings/privacy/network] proxy save failed", err);
          showInlineNotice("Failed to save remote proxy URL.", { kind: "error" });
        }
      };
      proxyInput.addEventListener("change", () => { void commitProxy(); });
      proxyInput.addEventListener("blur", () => { void commitProxy(); });

      const events = (() => {
        try { return getEventsAPI(); } catch { return null; }
      })();
      const onWispChanged = async () => {
        try {
          const w = await api.getItem<string>("wisp");
          savedWisp = w ?? "";
          if (customInput.style.display === "none") {
            presetBtn.textContent = resolveLabel(savedWisp);
          }
        } catch { /* ignore */ }
      };
      const onProxyChanged = async () => {
        try {
          const p = await api.getItem<string>("proxyServer");
          const next = p ?? "";
          if (document.activeElement !== proxyInput && proxyInput.value !== next) {
            proxyInput.value = next;
          }
        } catch { /* ignore */ }
      };
      if (events) {
        events.addEventListener("wisp:changed", onWispChanged as EventListener);
        events.addEventListener("proxyServer:changed", onProxyChanged as EventListener);
        // Best-effort cleanup: removed when the subpage container is replaced
        // on next navigation. We can't easily hook a destroy callback from
        // createSubpage, but document-level listeners on missing nodes are
        // harmless (the handlers just re-read settings and no-op).
      }

      createIcons({ icons });
    },
  });
  container.appendChild(sub);
}

function emitCloakChanged(): void {
  try { getEventsAPI().emit("cloak:changed", null); } catch { /* ignore */ }
}

const cloakReadMap = (raw: unknown): boolean | undefined => {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return undefined;
};

function renderCloaking(container: HTMLElement) {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Privacy and security",
    title: "Cloaking",
    parentSectionId: "privacy",
    render: (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";

      stack.appendChild(
        createToggle({
          label: "About:blank cloak",
          description: "Open the browser inside an about:blank tab to mask its origin.",
          settingKey: "aboutBlank",
          defaultValue: false,
          readMap: cloakReadMap,
          onChange: () => { emitCloakChanged(); },
          searchUnit: {
            id: "privacy/cloaking/about-blank",
            label: "About:blank cloak",
            sectionId: "privacy",
            keywords: ["about:blank", "cloak"],
          },
        }).element,
      );

      stack.appendChild(
        createToggle({
          label: "URL cloak",
          description: "Hide the visible URL in the address bar.",
          settingKey: "urlCloak",
          defaultValue: false,
          readMap: cloakReadMap,
          onChange: () => { emitCloakChanged(); },
          searchUnit: {
            id: "privacy/cloaking/url-cloak",
            label: "URL cloak",
            sectionId: "privacy",
            keywords: ["url", "address bar"],
          },
        }).element,
      );

      stack.appendChild(
        createToggle({
          label: "Tab cloak",
          description: "Replace the tab title and favicon to disguise this browser.",
          settingKey: "autoCloak",
          defaultValue: false,
          readMap: cloakReadMap,
          writeMap: (v) => (v ? "true" : "false"),
          onChange: () => { emitCloakChanged(); },
          searchUnit: {
            id: "privacy/cloaking/tab-cloak",
            label: "Tab cloak",
            sectionId: "privacy",
            keywords: ["tab", "title", "favicon", "disguise"],
          },
        }).element,
      );

      stack.appendChild(createRow({
        label: "Custom tab title & favicon",
        description: "Edit the cloaked tab title and favicon image.",
        right: { kind: "chevron" },
        onClick: () => { location.hash = "#privacy?subpage=cloaking-editor"; },
        searchUnit: {
          id: "privacy/cloaking/editor",
          label: "Custom tab title & favicon",
          sectionId: "privacy",
          keywords: ["title", "favicon", "icon", "cloak"],
        },
      }));

      stack.appendChild(createRow({
        label: "Panic button",
        description: "Configure a hotkey that immediately swaps to a safe URL.",
        right: { kind: "chevron" },
        onClick: () => { location.hash = "#privacy?subpage=panic"; },
        searchUnit: {
          id: "privacy/cloaking/panic",
          label: "Panic button",
          sectionId: "privacy",
          keywords: ["panic", "hotkey", "escape", "safe"],
        },
      }));

      body.appendChild(stack);
    },
  });
  container.appendChild(sub);
}

function renderCloakingEditor(container: HTMLElement) {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Cloaking",
    title: "Custom tab title & favicon",
    parentSectionId: "privacy",
    render: async (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";

      const titleRow = document.createElement("div");
      titleRow.className = "settings-row no-hover";
      const titleStack = document.createElement("div");
      titleStack.className = "row-stack";
      const titleLabel = document.createElement("div");
      titleLabel.className = "row-label";
      titleLabel.textContent = "Custom title";
      titleStack.appendChild(titleLabel);
      const titleDesc = document.createElement("div");
      titleDesc.className = "row-sub";
      titleDesc.textContent = "Replaces the page title shown in browser tabs when tab cloak is on.";
      titleStack.appendChild(titleDesc);
      titleRow.appendChild(titleStack);
      const titleRight = document.createElement("div");
      titleRight.className = "row-right";
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "modal-input";
      titleInput.placeholder = "e.g. Google Classroom";
      titleRight.appendChild(titleInput);
      titleRow.appendChild(titleRight);
      stack.appendChild(titleRow);

      const favRow = document.createElement("div");
      favRow.className = "settings-row no-hover";
      const favStack = document.createElement("div");
      favStack.className = "row-stack";
      const favLabel = document.createElement("div");
      favLabel.className = "row-label";
      favLabel.textContent = "Custom favicon";
      favStack.appendChild(favLabel);
      const favDesc = document.createElement("div");
      favDesc.className = "row-sub";
      favDesc.textContent = "PNG, JPEG, or ICO — uploaded image is stored locally as a data URL.";
      favStack.appendChild(favDesc);
      favRow.appendChild(favStack);
      const favRight = document.createElement("div");
      favRight.className = "row-right";
      const favPreview = document.createElement("img");
      favPreview.style.width = "20px";
      favPreview.style.height = "20px";
      favPreview.style.marginRight = "8px";
      favPreview.style.display = "none";
      favPreview.style.borderRadius = "3px";
      favRight.appendChild(favPreview);
      const uploadBtn = document.createElement("button");
      uploadBtn.className = "settings-button";
      uploadBtn.textContent = "Upload";
      favRight.appendChild(uploadBtn);
      const clearBtn = document.createElement("button");
      clearBtn.className = "settings-button ghost";
      clearBtn.textContent = "Clear";
      clearBtn.style.marginLeft = "6px";
      favRight.appendChild(clearBtn);
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,image/svg+xml";
      fileInput.style.display = "none";
      favRight.appendChild(fileInput);
      favRow.appendChild(favRight);
      stack.appendChild(favRow);

      body.appendChild(stack);

      const api = getSettingsAPI();
      try {
        const t = await api.getItem<string>("customTitle");
        titleInput.value = t ?? "";
      } catch { titleInput.value = ""; }
      try {
        const f = await api.getItem<string>("customFavicon");
        if (f) {
          favPreview.src = f;
          favPreview.style.display = "inline-block";
        }
      } catch { /* ignore */ }

      const commitTitle = async () => {
        try {
          await api.setItem("customTitle", titleInput.value);
          emitCloakChanged();
        } catch (err) {
          console.warn("[settings/privacy/cloaking-editor] save title failed", err);
          showInlineNotice("Failed to save custom title.", { kind: "error" });
        }
      };
      titleInput.addEventListener("change", () => { void commitTitle(); });
      titleInput.addEventListener("blur", () => { void commitTitle(); });

      uploadBtn.addEventListener("click", () => { fileInput.click(); });
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = String(reader.result ?? "");
          if (!dataUrl) return;
          try {
            await api.setItem("customFavicon", dataUrl);
            favPreview.src = dataUrl;
            favPreview.style.display = "inline-block";
            emitCloakChanged();
            showInlineNotice("Favicon updated");
          } catch (err) {
            console.warn("[settings/privacy/cloaking-editor] save favicon failed", err);
            showInlineNotice("Failed to save favicon.", { kind: "error" });
          }
        };
        reader.onerror = () => {
          showInlineNotice("Could not read the selected file.", { kind: "error" });
        };
        reader.readAsDataURL(file);
      });

      clearBtn.addEventListener("click", async () => {
        try {
          await api.removeItem("customFavicon");
          favPreview.removeAttribute("src");
          favPreview.style.display = "none";
          fileInput.value = "";
          emitCloakChanged();
        } catch (err) {
          console.warn("[settings/privacy/cloaking-editor] clear favicon failed", err);
          showInlineNotice("Failed to clear favicon.", { kind: "error" });
        }
      });
    },
  });
  container.appendChild(sub);
}

function renderPanicConfig(container: HTMLElement) {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Cloaking",
    title: "Panic button",
    parentSectionId: "privacy",
    render: async (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";

      const kbRow = document.createElement("div");
      kbRow.className = "settings-row no-hover";
      const kbStack = document.createElement("div");
      kbStack.className = "row-stack";
      const kbLabel = document.createElement("div");
      kbLabel.className = "row-label";
      kbLabel.textContent = "Trigger key combo";
      kbStack.appendChild(kbLabel);
      const kbDesc = document.createElement("div");
      kbDesc.className = "row-sub";
      kbDesc.textContent = "Keyboard shortcut that activates the panic action (e.g. Ctrl+Shift+`).";
      kbStack.appendChild(kbDesc);
      kbRow.appendChild(kbStack);
      const kbRight = document.createElement("div");
      kbRight.className = "row-right";
      const kbInput = document.createElement("input");
      kbInput.type = "text";
      kbInput.className = "modal-input";
      kbInput.placeholder = "Ctrl+Shift+`";
      kbRight.appendChild(kbInput);
      kbRow.appendChild(kbRight);
      stack.appendChild(kbRow);

      const urlRow = document.createElement("div");
      urlRow.className = "settings-row no-hover";
      const urlStack = document.createElement("div");
      urlStack.className = "row-stack";
      const urlLabel = document.createElement("div");
      urlLabel.className = "row-label";
      urlLabel.textContent = "Redirect URL";
      urlStack.appendChild(urlLabel);
      const urlDesc = document.createElement("div");
      urlDesc.className = "row-sub";
      urlDesc.textContent = "Location to navigate to when the panic key fires.";
      urlStack.appendChild(urlDesc);
      urlRow.appendChild(urlStack);
      const urlRight = document.createElement("div");
      urlRight.className = "row-right";
      const urlInput = document.createElement("input");
      urlInput.type = "text";
      urlInput.className = "modal-input";
      urlInput.placeholder = "https://classroom.google.com/";
      urlRight.appendChild(urlInput);
      urlRow.appendChild(urlRight);
      stack.appendChild(urlRow);

      stack.appendChild(
        createToggle({
          label: "Close all tabs first",
          description: "Close every open tab before navigating to the redirect URL.",
          settingKey: "panicCloseTabs",
          defaultValue: true,
          searchUnit: {
            id: "privacy/panic/close-tabs",
            label: "Panic close all tabs first",
            sectionId: "privacy",
            keywords: ["panic", "tabs", "close"],
          },
        }).element,
      );

      stack.appendChild(
        createToggle({
          label: "Clear session data",
          description: "Wipe cookies, localStorage, and cache when panic fires.",
          settingKey: "panicClearData",
          defaultValue: false,
          searchUnit: {
            id: "privacy/panic/clear-data",
            label: "Panic clear session data",
            sectionId: "privacy",
            keywords: ["panic", "clear", "cookies", "session"],
          },
        }).element,
      );

      const testRow = document.createElement("div");
      testRow.className = "settings-row no-hover";
      const testStack = document.createElement("div");
      testStack.className = "row-stack";
      const testLabel = document.createElement("div");
      testLabel.className = "row-label";
      testLabel.textContent = "Test panic button";
      testStack.appendChild(testLabel);
      const testDesc = document.createElement("div");
      testDesc.className = "row-sub";
      testDesc.textContent = "Fire the panic action right now to verify your configuration.";
      testStack.appendChild(testDesc);
      testRow.appendChild(testStack);
      const testRight = document.createElement("div");
      testRight.className = "row-right";
      const testBtn = document.createElement("button");
      testBtn.className = "settings-button danger";
      testBtn.textContent = "Test";
      testRight.appendChild(testBtn);
      testRow.appendChild(testRight);
      stack.appendChild(testRow);

      body.appendChild(stack);

      const api = getSettingsAPI();
      try {
        const k = await api.getItem<string>("panicKeybind");
        kbInput.value = k ?? "";
      } catch { kbInput.value = ""; }
      try {
        const u = await api.getItem<string>("panicUrl");
        urlInput.value = u ?? "";
      } catch { urlInput.value = ""; }

      const commitKb = async () => {
        try { await api.setItem("panicKeybind", kbInput.value.trim()); }
        catch (err) {
          console.warn("[settings/privacy/panic] save keybind failed", err);
          showInlineNotice("Failed to save panic keybind.", { kind: "error" });
        }
      };
      kbInput.addEventListener("change", () => { void commitKb(); });
      kbInput.addEventListener("blur", () => { void commitKb(); });

      const commitUrl = async () => {
        try { await api.setItem("panicUrl", urlInput.value.trim()); }
        catch (err) {
          console.warn("[settings/privacy/panic] save url failed", err);
          showInlineNotice("Failed to save panic URL.", { kind: "error" });
        }
      };
      urlInput.addEventListener("change", () => { void commitUrl(); });
      urlInput.addEventListener("blur", () => { void commitUrl(); });

      testBtn.addEventListener("click", () => {
        openModal({
          title: "Test panic button?",
          description:
            "This will fire the panic action now — depending on your settings it may close tabs, clear data, and navigate away.",
          primary: {
            label: "Fire panic",
            variant: "danger",
            onClick: () => {
              const fallbackUrl = urlInput.value.trim() || "about:blank";
              try {
                const host = getHost() as any;
                if (typeof host?.triggerPanic === "function") {
                  host.triggerPanic();
                  return;
                }
              } catch (err) {
                console.warn("[settings/privacy/panic] triggerPanic threw", err);
              }
              try {
                if (window.parent && window.parent.location) {
                  window.parent.location.href = fallbackUrl;
                }
              } catch (err) {
                console.warn("[settings/privacy/panic] fallback navigate failed", err);
                showInlineNotice("Could not fire panic action.", { kind: "error" });
              }
            },
          },
          secondary: {
            label: "Cancel",
            variant: "ghost",
            onClick: () => { /* close modal */ },
          },
        });
      });
    },
  });
  container.appendChild(sub);
}
