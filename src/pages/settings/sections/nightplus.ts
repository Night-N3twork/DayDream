import { createIcons, icons } from "lucide";
import { createRow } from "../components/row";
import { createToggle } from "../components/toggle";
import { openModal } from "../components/modal";
import { showInlineNotice } from "../components/notice";
import { openSwitcherDropdown } from "../components/profileSwitcher";
import { getEventsAPI, getProxy, getSettingsAPI, getHost } from "../data/host";
import { coverIdentity } from "@core/shared/build-runtime";
import type { SectionContext } from "./types";

interface NightPlusState {
  authed: boolean;
  email: string | null;
  memberSince: string | null;
  expiresAt: string | null;
}

interface MullvadRelay {
  hostname: string;
  country: string;
  city: string;
}

let mounted: HTMLElement | null = null;
let renderGen = 0;
let ctxRef: SectionContext | undefined;
let mullvadGen = 0;
let mullvadCache: { ts: number; data: MullvadRelay[] } | null = null;

export async function render(container: HTMLElement, ctx: SectionContext): Promise<void> {
  mounted = container;
  ctxRef = ctx;
  const gen = ++renderGen;
  container.innerHTML = `<div class="ddx-loading-skeleton">Loading Night+ status…</div>`;

  const state = await fetchState();
  if (gen !== renderGen) return;

  container.innerHTML = "";
  if (state.authed) renderSignedIn(container, state);
  else renderSignedOut(container);

  void (async () => {
    try {
      const npMod = await import("../../../apis/nightplus");
      await npMod.dumpNightPlusData();
      const fresh = await fetchState();
      if (gen !== renderGen) return;
      container.innerHTML = "";
      if (fresh.authed) renderSignedIn(container, fresh);
      else renderSignedOut(container);
    } catch (err) {
      console.warn("[nightplus] refresh failed:", err);
    }
  })();

  createIcons({ icons });
}

export function unmount(): void {
  renderGen++;
  mullvadGen++;
  mounted = null;
}

async function fetchState(): Promise<NightPlusState> {
  try {
    const mod = await import("../../../apis/nightplus");
    const authed = await mod.checkNightPlusStatus();
    if (!authed) return { authed: false, email: null, memberSince: null, expiresAt: null };

    const cached = await mod.getCachedNightPlusData();
    const status = (cached as any)?.status;
    const profileRaw = await mod.nightPlusStore.getItem("profile");
    const profile = profileRaw && typeof profileRaw === "object" ? (profileRaw as any) : null;

    return {
      authed: true,
      email: profile?.email ?? null,
      memberSince: status?.member_length ?? null,
      expiresAt: status?.expires_at ?? null,
    };
  } catch (err) {
    console.warn("[nightplus] state read failed:", err);
    return { authed: false, email: null, memberSince: null, expiresAt: null };
  }
}

function renderSignedIn(container: HTMLElement, state: NightPlusState): void {
  const section = document.createElement("div");
  section.className = "settings-section";
  section.dataset.sectionId = "nightplus";

  const h2 = document.createElement("h2");
  h2.className = "settings-section-title";
  h2.textContent = "Night+";
  section.appendChild(h2);

  const status = document.createElement("div");
  status.className = "ddx-status-card";
  const icon = document.createElement("div");
  icon.className = "ddx-status-card-icon";
  const iconI = document.createElement("i");
  iconI.setAttribute("data-lucide", "check-circle");
  icon.appendChild(iconI);
  status.appendChild(icon);
  const body = document.createElement("div");
  body.className = "ddx-status-card-body";
  const title = document.createElement("div");
  title.className = "ddx-status-card-title";
  title.textContent = "Night+ Member";
  body.appendChild(title);
  if (state.email) {
    const emailEl = document.createElement("div");
    emailEl.className = "ddx-status-card-meta";
    emailEl.textContent = state.email;
    body.appendChild(emailEl);
  }
  const meta = document.createElement("div");
  meta.className = "ddx-status-card-meta";
  const parts: string[] = [];
  if (state.memberSince) parts.push(`Member since ${state.memberSince}`);
  if (state.expiresAt) parts.push(`Renews ${state.expiresAt}`);
  meta.textContent = parts.join("  ·  ") || "Active";
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "ddx-status-card-actions";
  const signOutBtn = document.createElement("button");
  signOutBtn.className = "settings-button ghost";
  signOutBtn.textContent = "Sign out";
  signOutBtn.addEventListener("click", () => openSignOut());
  actions.appendChild(signOutBtn);
  body.appendChild(actions);
  status.appendChild(body);
  section.appendChild(status);

  section.appendChild(renderFeaturesUnlocked());

  section.appendChild(
    createRow({
      icon: "server",
      label: "Premium WISP server",
      description: "Pick a WISP relay from the Night+ curated server list.",
      right: {
        kind: "custom",
        element: buildPickerButton("Pick server ▾", (anchor) =>
          openPremiumWispPicker(anchor),
        ),
      },
      searchUnit: {
        id: "nightplus/wisp",
        label: "Premium WISP server",
        sectionId: "nightplus",
        keywords: ["wisp", "relay"],
      },
    }),
  );

  section.appendChild(
    createRow({
      icon: "globe",
      label: "Mullvad VPN exit node",
      description: "Route traffic through a Mullvad relay (writes to remote proxy URL).",
      right: {
        kind: "custom",
        element: buildPickerButton("Pick relay ▾", (anchor) =>
          openMullvadPicker(anchor),
        ),
      },
      searchUnit: {
        id: "nightplus/mullvad",
        label: "Mullvad VPN exit node",
        sectionId: "nightplus",
        keywords: ["mullvad", "vpn", "proxy"],
      },
    }),
  );

  section.appendChild(
    createToggle({
      icon: "shield",
      label: "Premium proxy routing",
      description: "Route requests through Night+ optimized proxy network.",
      settingKey: "nightplus.premiumProxyRouting",
      defaultValue: false,
      searchUnit: {
        id: "nightplus/premium-proxy",
        label: "Premium proxy routing",
        sectionId: "nightplus",
        keywords: ["proxy"],
      },
    }).element,
  );

  section.appendChild(
    createToggle({
      icon: "lock-keyhole",
      label: "Auto-solve Cloudflare Turnstile",
      description:
        "Automatically solve Turnstile challenges. (Persistence-only first pass — runtime solver coming later.)",
      settingKey: "nightplus.turnstileAutoSolve",
      defaultValue: false,
      searchUnit: {
        id: "nightplus/turnstile",
        label: "Auto-solve Cloudflare Turnstile",
        sectionId: "nightplus",
        keywords: ["captcha", "challenge"],
      },
    }).element,
  );

  section.appendChild(
    createRow({
      icon: "sparkles",
      label: "Open NyxAI",
      description: "Launch the Night+ AI assistant.",
      right: { kind: "chevron" },
      onClick: () => {
        try {
          (getHost() as any).tabs?.createTab?.("https://nyxai.nightnetwork.app/");
        } catch { /* ignore */ }
      },
      searchUnit: {
        id: "nightplus/nyxai",
        label: "Open NyxAI",
        sectionId: "nightplus",
        keywords: ["ai", "assistant"],
      },
    }),
  );

  container.appendChild(section);
}

function renderSignedOut(container: HTMLElement): void {
  const section = document.createElement("div");
  section.className = "settings-section";
  section.dataset.sectionId = "nightplus";

  const h2 = document.createElement("h2");
  h2.className = "settings-section-title";
  h2.textContent = "Night+";
  section.appendChild(h2);

  const hero = document.createElement("div");
  hero.className = "ddx-status-card is-locked";
  const logo = document.createElement("img");
  logo.src = "/res/logo.png";
  logo.alt = coverIdentity().product;
  logo.width = 48;
  logo.height = 48;
  logo.style.borderRadius = "8px";
  hero.appendChild(logo);
  const body = document.createElement("div");
  body.className = "ddx-status-card-body";
  const title = document.createElement("div");
  title.className = "ddx-status-card-title";
  title.textContent = "Unlock Night+";
  body.appendChild(title);
  const meta = document.createElement("div");
  meta.className = "ddx-status-card-meta";
  meta.textContent =
    `Get more from ${coverIdentity().product} — premium WISP servers, Mullvad VPN, unlimited profiles, premium proxy routing, NyxAI, and Cloudflare Turnstile auto-solver.`;
  body.appendChild(meta);
  const actions = document.createElement("div");
  actions.className = "ddx-status-card-actions";
  const signInBtn = document.createElement("button");
  signInBtn.className = "settings-button";
  signInBtn.textContent = "Sign in to Night+";
  signInBtn.addEventListener("click", () => openSignIn());
  actions.appendChild(signInBtn);
  body.appendChild(actions);
  hero.appendChild(body);
  section.appendChild(hero);

  const locked = document.createElement("div");
  locked.className = "ddx-locked-card";
  for (const feature of [
    "Unlimited profiles",
    "Premium WISP servers",
    "Mullvad VPN routing",
    "Premium proxy routing",
    "NyxAI assistant",
    "Cloudflare Turnstile auto-solver",
  ]) {
    const row = document.createElement("div");
    row.className = "ddx-locked-row";
    const iconWrap = document.createElement("span");
    iconWrap.className = "ddx-locked-icon";
    const lockI = document.createElement("i");
    lockI.setAttribute("data-lucide", "lock");
    iconWrap.appendChild(lockI);
    row.appendChild(iconWrap);
    row.appendChild(document.createTextNode(feature));
    locked.appendChild(row);
  }
  section.appendChild(locked);

  container.appendChild(section);
}

function renderFeaturesUnlocked(): HTMLElement {
  const card = document.createElement("div");
  card.className = "ddx-features-list";

  const title = document.createElement("div");
  title.className = "ddx-features-title";
  title.textContent = "Features unlocked";
  card.appendChild(title);

  for (const feature of [
    "Unlimited profiles",
    "Premium WISP servers",
    "Mullvad VPN routing",
    "Premium proxy routing",
    "NyxAI assistant",
    "Cloudflare Turnstile auto-solver",
  ]) {
    const row = document.createElement("div");
    row.className = "ddx-feature-row";
    const iconWrap = document.createElement("span");
    iconWrap.className = "ddx-feature-icon";
    const checkI = document.createElement("i");
    checkI.setAttribute("data-lucide", "check");
    iconWrap.appendChild(checkI);
    row.appendChild(iconWrap);
    row.appendChild(document.createTextNode(feature));
    card.appendChild(row);
  }
  return card;
}

function buildPickerButton(
  label: string,
  onClick: (anchor: HTMLElement) => void,
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "settings-button";
  btn.textContent = label;
  btn.addEventListener("click", () => onClick(btn));
  return btn;
}

async function openPremiumWispPicker(anchor: HTMLElement): Promise<void> {
  try {
    const mod = await import("../../../apis/nightplus");
    const servers = await mod.getPremiumWispServers();
    if (!servers.length) {
      showInlineNotice("No premium servers available right now");
      return;
    }
    const entries = servers.map((s: any) => ({
      id: s.url,
      label: s.name || s.url,
      sublabel: s.region,
      iconOnly: "server",
      onClick: async () => {
        try {
          const proxy = await getProxy();
          await proxy.swapWispServer(s.url);
          try { getEventsAPI().emit("wisp:changed", null); } catch { /* ignore */ }
          showInlineNotice(`WISP switched to ${s.name || s.url}`);
        } catch (err) {
          showInlineNotice(
            "WISP swap failed: " + (err as Error).message,
            { kind: "error" },
          );
        }
      },
    }));
    openSwitcherDropdown(anchor, entries);
  } catch {
    showInlineNotice("Could not load premium WISP servers", { kind: "error" });
  }
}

function hostnameToSocksUrl(hostname: string): string | null {
  const parts = hostname.split("-");
  if (parts.length < 4) return null;
  const nodeNumber = parts[parts.length - 1];
  const baseHostname = parts.slice(0, -2).join("-");
  return `socks5h://${baseHostname}-socks5-${nodeNumber}.relays.mullvad.net:1080`;
}

async function fetchMullvadRelays(gen: number): Promise<MullvadRelay[]> {
  if (mullvadCache && Date.now() - mullvadCache.ts < 3_600_000) return mullvadCache.data;
  const proxy = await getProxy();
  const resp = await proxy.fetch("https://api.mullvad.net/public/relays/wireguard/v1/");
  if (gen !== mullvadGen) return [];
  const data = await resp.json();
  const enriched: MullvadRelay[] = [];
  for (const country of data?.countries ?? []) {
    for (const city of country?.cities ?? []) {
      for (const relay of city?.relays ?? []) {
        if (!relay?.hostname) continue;
        enriched.push({
          hostname: relay.hostname,
          country: country.name ?? "Unknown",
          city: city.name ?? "",
        });
      }
    }
  }
  mullvadCache = { ts: Date.now(), data: enriched };
  return enriched;
}

async function openMullvadPicker(anchor: HTMLElement): Promise<void> {
  const gen = ++mullvadGen;
  try {
    const relays = await fetchMullvadRelays(gen);
    if (gen !== mullvadGen) return;
    if (!relays.length) {
      showInlineNotice("No Mullvad relays available", { kind: "error" });
      return;
    }
    const grouped = new Map<string, MullvadRelay[]>();
    for (const r of relays) {
      if (!grouped.has(r.country)) grouped.set(r.country, []);
      grouped.get(r.country)!.push(r);
    }
    const entries: any[] = [];
    for (const [country, cityRelays] of grouped) {
      entries.push({ id: `_h_${country}`, label: country, header: true });
      for (const r of cityRelays.slice(0, 5)) {
        const url = hostnameToSocksUrl(r.hostname);
        if (!url) continue;
        entries.push({
          id: r.hostname,
          label: `${r.city} (${r.hostname})`,
          iconOnly: "globe",
          onClick: async () => {
            try {
              await getSettingsAPI().setItem("proxyServer", url);
              try { getEventsAPI().emit("proxyServer:changed", null); } catch { /* ignore */ }
              showInlineNotice(`Proxy → ${r.city}`);
            } catch (err) {
              showInlineNotice(
                "Failed to set proxy: " + (err as Error).message,
                { kind: "error" },
              );
            }
          },
        });
      }
    }
    openSwitcherDropdown(anchor, entries);
  } catch (err) {
    console.warn("[nightplus] Mullvad fetch failed:", err);
    showInlineNotice("Could not load Mullvad relays", { kind: "error" });
  }
}

async function openSignIn(): Promise<void> {
  try {
    const [{ default: NightLogin }, mod] = await Promise.all([
      import("@nightnetwork/night-auth"),
      import("../../../apis/nightplus"),
    ]);
    const login = new (NightLogin as any)({
      service: "DayDreamX",
      theme: "system",
      backdropBlur: "8px",
      assetUrl: "",
      onSuccess: async () => {
        let token: string | null = null;
        try {
          token = localStorage.getItem("access_token");
        } catch {
          /* private mode / disabled */
        }
        if (!token) {
          console.error("[nightplus] login fired onSuccess but no access_token in localStorage");
          return;
        }
        try {
          await mod.setAccessToken(token);
          await mod.dumpNightPlusData();
        } catch (err) {
          console.warn("[nightplus] post-login persist failed:", err);
        }
        if (mounted) await render(mounted, ctxRef ?? {});
      },
      onCancel: () => {
        /* user dismissed; no-op */
      },
    });
    login.show();
  } catch (err) {
    console.warn("[nightplus] sign-in unavailable:", err);
    showInlineNotice("Sign-in is currently unavailable. Try again later.", {
      kind: "error",
    });
  }
}

function openSignOut(): void {
  const handle = openModal({
    title: "Sign out of Night+?",
    description:
      "You'll lose access to premium WISP servers, Mullvad routing, and other Night+ features until you sign back in.",
    primary: {
      label: "Sign out",
      variant: "danger",
      onClick: async () => {
        try {
          const mod = await import("../../../apis/nightplus");
          await mod.clearAccessToken();
          await mod.clearSessionToken();
          await mod.clearNightPlusCache();
          try { getEventsAPI().emit("nightplus:signout", null); } catch { /* ignore */ }
        } catch (err) {
          console.warn("[nightplus] sign-out failed:", err);
        }
        handle.close();
        if (mounted) await render(mounted, ctxRef ?? {});
      },
    },
    secondary: { label: "Cancel", onClick: () => {} },
  });
}
