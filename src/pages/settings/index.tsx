import "@pages/shared/themeInit";

import { createIcons, icons } from "lucide";
import { settingsSearch } from "./components/settingsSearch";
import { openInNewTab } from "./data/host";
import { coverIdentity } from "@core/shared/build-runtime";
import type { SectionModule } from "./sections/types";

const PRODUCT_NAME = coverIdentity().product;

interface RailItem {
  id: string;
  label: string;
  icon: string;
  external?: boolean;
  href?: string;
  divider?: boolean;
}

const RAIL: RailItem[] = [
  { id: "profiles", label: "Profiles", icon: "user" },
  { id: "appearance", label: "Appearance and behavior", icon: "palette" },
  { id: "privacy", label: "Privacy and security", icon: "shield-check" },
  { id: "search-engine", label: "Search engine", icon: "search" },
  { id: "on-startup", label: "On startup", icon: "power" },
  { id: "nightplus", label: "Night+", icon: "moon-star" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "__divider1__", label: "", icon: "", divider: true },
  { id: "system", label: "System", icon: "wrench" },
  { id: "reset", label: "Reset settings", icon: "rotate-ccw" },
  { id: "__divider2__", label: "", icon: "", divider: true },
  { id: "extensions", label: "Extensions", icon: "puzzle", external: true, href: "ddx://extensions/" },
  { id: "about", label: `About ${PRODUCT_NAME}`, icon: "info" },
];

const SECTION_LOADERS: Record<string, () => Promise<SectionModule>> = {
  profiles: () => import("./sections/profiles"),
  appearance: () => import("./sections/appearance"),
  privacy: () => import("./sections/privacy"),
  "search-engine": () => import("./sections/searchEngine"),
  "on-startup": () => import("./sections/onStartup"),
  nightplus: () => import("./sections/nightplus"),
  downloads: () => import("./sections/downloads"),
  system: () => import("./sections/system"),
  about: () => import("./sections/about"),
};

const ANCHOR_REDIRECTS: Record<string, string> = {
  SitePermissions: "privacy?subpage=site-settings",
  Privacy: "privacy",
  Appearance: "appearance",
  Search: "search-engine",
  Keybinds: "system?subpage=keyboard-shortcuts",
  Advanced: "system",
  About: "about",
  FAQ: "about?subpage=faq",
  NightPlus: "nightplus",
  Network: "privacy?subpage=network",
  Cloaking: "privacy?subpage=cloaking",
};

function renderRail() {
  const nav = document.getElementById("rail-nav");
  if (!nav) return;
  nav.innerHTML = "";
  for (const item of RAIL) {
    if (item.divider) {
      const hr = document.createElement("hr");
      hr.className = "rail-divider";
      nav.appendChild(hr);
      continue;
    }
    const a = document.createElement("a");
    a.className = "rail-item";
    a.dataset.id = item.id;
    if (item.external && item.href) {
      a.href = item.href;
    } else {
      a.href = `#${item.id}`;
    }
    a.innerHTML = `
      <i data-lucide="${item.icon}" class="rail-icon"></i>
      <span>${item.label}</span>
      ${item.external ? '<i data-lucide="arrow-up-right" class="rail-ext-icon"></i>' : ""}
    `;
    if (item.id === "reset") {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        void openResetModal();
      });
    } else if (item.external && item.href) {
      const href = item.href;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        void openInNewTab(href);
      });
    }
    nav.appendChild(a);
  }
  createIcons({ icons });
}

function setActiveRail(id: string) {
  for (const el of document.querySelectorAll<HTMLAnchorElement>(".rail-item")) {
    el.classList.toggle("active", el.dataset.id === id);
  }
}

function parseHash(): { section: string; subpage: string | undefined } {
  const raw = location.hash.slice(1);
  if (!raw) return { section: "profiles", subpage: undefined };

  const [headRaw, queryRaw] = raw.split("?");

  if (ANCHOR_REDIRECTS[headRaw]) {
    const [redirSection, redirQuery] = ANCHOR_REDIRECTS[headRaw].split("?");
    const finalQuery = queryRaw ?? redirQuery;
    const params = new URLSearchParams(finalQuery ?? "");
    return { section: redirSection, subpage: params.get("subpage") ?? undefined };
  }

  const params = new URLSearchParams(queryRaw ?? "");
  return { section: headRaw, subpage: params.get("subpage") ?? undefined };
}

let currentUnmount: (() => void) | undefined;
let mountGen = 0;

async function mountSection(sectionId: string, subpage: string | undefined) {
  const gen = ++mountGen;

  if (currentUnmount) {
    try { currentUnmount(); } catch (e) { console.warn("[settings] unmount error", e); }
    currentUnmount = undefined;
  }
  settingsSearch.clearAll();
  settingsSearch.scope(null);

  const loader = SECTION_LOADERS[sectionId];
  const content = document.getElementById("settings-content");
  if (!content) return;
  if (!loader) {
    content.innerHTML = '<div class="settings-empty-state"><div class="empty-title">Unknown section</div></div>';
    return;
  }
  setActiveRail(sectionId);

  try {
    const mod = await loader();
    if (gen !== mountGen) return;
    await mod.render(content, { subpage });
    if (gen !== mountGen) {
      mod.unmount?.();
      return;
    }
    if (mod.unmount) currentUnmount = mod.unmount;
    window.scrollTo(0, 0);
  } catch (e) {
    if (gen !== mountGen) return;
    console.error("[settings] failed to load section", sectionId, e);
    content.innerHTML =
      '<div class="settings-empty-state"><div class="empty-title">Failed to load section</div><div class="empty-sub">See console for details.</div></div>';
  }
}

function wireSearch() {
  const input = document.getElementById("settings-search-input") as HTMLInputElement | null;
  if (!input) return;
  let debounce: number | undefined;
  input.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      settingsSearch.filter(input.value);
    }, 80);
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (input.value) {
        input.value = "";
        settingsSearch.filter("");
      } else {
        input.blur();
      }
    }
  });
}

async function openResetModal() {
  const { openModal } = await import("./components/modal");
  const { resetAllSettings } = await import("./data/resetSettings");
  openModal({
    title: "Reset settings to defaults",
    description:
      "This will reset: theme, search engines, keybinds, startup, site permissions, and all toggles.\n\nThis will NOT reset: profiles, bookmarks, history, downloads, extensions.",
    primary: {
      label: "Reset settings",
      variant: "danger",
      onClick: async () => {
        await resetAllSettings();
        location.reload();
      },
    },
    secondary: { label: "Cancel", onClick: () => {} },
  });
}

function onHashChange() {
  const { section, subpage } = parseHash();
  const normalized = subpage ? `${section}?subpage=${subpage}` : section;
  if (location.hash.slice(1) !== normalized) {
    history.replaceState(null, "", `#${normalized}`);
  }
  void mountSection(section, subpage);
}

function bootstrap() {
  renderRail();
  wireSearch();
  if (!location.hash || location.hash === "#") {
    history.replaceState(null, "", "#profiles");
  }
  onHashChange();
  window.addEventListener("hashchange", onHashChange);

  // Cold-load wallpaper defense lives in @pages/shared/themeInit
  // (InternalPageTheme.reassertUserBackground + watchBackgroundImageClass)
  // so every internal page is protected, not just this one. Previously
  // this page had a duplicate defense — now removed.
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
