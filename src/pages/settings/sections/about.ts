import { createIcons, icons } from "lucide";
import { settingsSearch } from "../components/settingsSearch";
import { createRow } from "../components/row";
import { getProfiles, openInNewTab } from "../data/host";
import { coverIdentity } from "@core/shared/build-runtime";
import type { SectionContext } from "./types";

const PRODUCT_NAME = coverIdentity().product;

type FAQItem = { q: string; body: (root: HTMLElement) => void };

function makeLink(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  a.style.color = "var(--main)";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    void openInNewTab(href);
  });
  return a;
}

const FAQ: FAQItem[] = [
  {
    q: "Where can I find links?",
    body: (root) => {
      const p = document.createElement("p");
      p.textContent = "You can find links in our Discord server. Join the community and check the pinned messages or links channel for the latest available links.";
      root.appendChild(p);
      root.appendChild(makeLink("discord.gg/algebra", "https://discord.gg/algebra"));
    },
  },
  {
    q: "Why do some sites not load or work?",
    body: (root) => {
      const p = document.createElement("p");
      p.textContent = "Web proxies have inherent limitations. Common reasons:";
      root.appendChild(p);
      const ul = document.createElement("ul");
      for (const item of [
        "Some sites use anti-proxy detection and block proxied requests.",
        "WebSockets and WebRTC may be blocked by your network.",
        "Features that web proxies can't replicate (USB, Bluetooth, native plugins) won't work.",
        "Your school/network may block the proxy transport (WISP/Mullvad).",
        "Hosted-link issues — some links go stale or get rate-limited.",
      ]) {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      }
      root.appendChild(ul);
    },
  },
  {
    q: "How can I make links? (BYOD)",
    body: (root) => {
      const p = document.createElement("p");
      p.textContent = `Bring Your Own Domain — host a redirect on a free subdomain pointing to ${PRODUCT_NAME}:`;
      root.appendChild(p);
      const ol = document.createElement("ol");
      for (const step of [
        "Sign up at freedns.afraid.org and create a free subdomain.",
        "When asked for an IP, enter 51.222.206.184",
        "Wait a few minutes for DNS to propagate.",
        `Visit https://yoursub.freeddns.org — it should land on ${PRODUCT_NAME}.`,
        "Share that URL with friends — it's yours and won't get blocked alongside the public hosts.",
      ]) {
        const li = document.createElement("li");
        li.textContent = step;
        ol.appendChild(li);
      }
      root.appendChild(ol);
    },
  },
  {
    q: "I found a bug, what now?",
    body: (root) => {
      const p1 = document.createElement("p");
      p1.textContent = "Two options:";
      root.appendChild(p1);
      const ul = document.createElement("ul");
      const li1 = document.createElement("li");
      li1.appendChild(makeLink("Open an issue on GitLab", "https://gitlab.com/nightnetwork/daydreamx/-/issues"));
      li1.appendChild(document.createTextNode(" — include steps to reproduce and the page URL."));
      ul.appendChild(li1);
      const li2 = document.createElement("li");
      li2.appendChild(makeLink("Report on Discord", "https://discord.night-x.com"));
      li2.appendChild(document.createTextNode(" in #bug-reports."));
      ul.appendChild(li2);
      root.appendChild(ul);
    },
  },
  {
    q: "Are my profiles isolated?",
    body: (root) => {
      const p = document.createElement("p");
      p.textContent = "Yes. Each profile has its own cookies, localStorage, and IndexedDB storage. Switching profiles swaps the entire browsing state.";
      root.appendChild(p);
    },
  },
  {
    q: "How do I install extensions?",
    body: (root) => {
      const p = document.createElement("p");
      p.textContent = `Open ddx://extensions/ and use the install picker. ${PRODUCT_NAME} supports a subset of the Chrome extension API (Manifest V2 and V3).`;
      root.appendChild(p);
    },
  },
];

export async function render(container: HTMLElement, ctx?: SectionContext): Promise<void> {
  container.innerHTML = "";
  const section = document.createElement("div");
  section.className = "settings-section";
  section.dataset.sectionId = "about";

  const h2 = document.createElement("h2");
  h2.className = "settings-section-title";
  h2.textContent = `About ${PRODUCT_NAME}`;
  section.appendChild(h2);

  const hero = document.createElement("div");
  hero.className = "about-hero";
  hero.style.display = "flex";
  hero.style.alignItems = "center";
  hero.style.gap = "16px";
  hero.style.marginBottom = "16px";
  const logo = document.createElement("img");
  logo.src = "/res/logo.png";
  logo.alt = "DayDream X";
  logo.width = 64;
  logo.height = 64;
  logo.style.borderRadius = "12px";
  hero.appendChild(logo);
  const heroText = document.createElement("div");
  heroText.style.display = "flex";
  heroText.style.flexDirection = "column";
  heroText.style.justifyContent = "center";
  const heroName = document.createElement("div");
  heroName.className = "about-name";
  heroName.style.fontSize = "20px";
  heroName.style.fontWeight = "600";
  heroName.textContent = "DayDream X";
  const heroVersion = document.createElement("div");
  heroVersion.style.fontSize = "13px";
  heroVersion.style.color = "var(--text-70)";
  heroVersion.textContent = `Version ${await getVersion()}`;
  heroVersion.title = "Click to copy";
  heroVersion.style.cursor = "pointer";
  heroVersion.addEventListener("click", () => {
    try {
      navigator.clipboard?.writeText(heroVersion.textContent || "");
    } catch { /* ignore */ }
  });
  heroText.appendChild(heroName);
  heroText.appendChild(heroVersion);
  hero.appendChild(heroText);
  section.appendChild(hero);

  const stats = await getStats();
  const statsCard = document.createElement("div");
  statsCard.className = "about-card";
  const statsTitle = document.createElement("strong");
  statsTitle.textContent = "Statistics";
  statsCard.appendChild(statsTitle);
  statsCard.appendChild(document.createElement("br"));
  for (const [labelText, value] of Object.entries({
    "Open tabs": stats.tabs,
    "Bookmarks": stats.bookmarks,
    "History entries": stats.history,
    "Profiles": stats.profiles,
  })) {
    statsCard.appendChild(document.createTextNode(`${labelText}: ${value}`));
    statsCard.appendChild(document.createElement("br"));
  }
  settingsSearch.register({
    id: "about/stats",
    label: "Statistics",
    sectionId: "about",
    keywords: ["tabs", "bookmarks", "history"],
    element: statsCard,
  });
  section.appendChild(statsCard);

  const credits = document.createElement("div");
  credits.className = "about-card";
  const c1 = document.createElement("div");
  c1.appendChild(document.createTextNode("Made by Night Network"));
  c1.appendChild(document.createTextNode(" · "));
  c1.appendChild(makeLink("night-x.com", "https://night-x.com"));
  credits.appendChild(c1);
  const c2 = document.createElement("div");
  c2.textContent = "Authors: Amplify, Crllect, Dust";
  credits.appendChild(c2);
  const c3 = document.createElement("div");
  c3.style.marginTop = "8px";
  c3.textContent = `Copyright ${new Date().getFullYear()} Night Network. All rights reserved.`;
  credits.appendChild(c3);
  const c4 = document.createElement("div");
  c4.textContent = "Made possible by the open source community.";
  credits.appendChild(c4);
  settingsSearch.register({
    id: "about/credits",
    label: "Credits",
    sectionId: "about",
    element: credits,
  });
  section.appendChild(credits);

  const links = [
    { icon: "message-circle", label: "Discord community", url: "https://discord.night-x.com" },
    { icon: "git-branch", label: "GitLab repository", url: "https://gitlab.com/nightnetwork/daydreamx" },
    { icon: "scroll-text", label: "Terms of service", url: "ddx://terms/" },
    { icon: "shield-check", label: "Privacy policy", url: "ddx://privacy/" },
  ];
  for (const l of links) {
    section.appendChild(createRow({
      icon: l.icon,
      label: l.label,
      right: { kind: "chevron" },
      onClick: () => { void openInNewTab(l.url); },
      searchUnit: {
        id: `about/link/${l.label}`,
        label: l.label,
        sectionId: "about",
      },
    }));
  }

  const faqHeader = document.createElement("div");
  faqHeader.className = "settings-subheader";
  faqHeader.textContent = "FAQ";
  section.appendChild(faqHeader);

  const autoOpenAll = ctx?.subpage === "faq";

  for (const item of FAQ) {
    const det = document.createElement("details");
    det.className = "faq-item";
    if (autoOpenAll) det.open = true;
    const summary = document.createElement("summary");
    summary.textContent = item.q;
    det.appendChild(summary);
    const answer = document.createElement("div");
    answer.className = "faq-answer";
    item.body(answer);
    det.appendChild(answer);
    settingsSearch.register({
      id: `about/faq/${item.q}`,
      label: item.q,
      sectionId: "about",
      keywords: ["faq", "question"],
      element: det,
    });
    section.appendChild(det);
  }

  container.appendChild(section);
  createIcons({ icons });

  if (autoOpenAll) {
    faqHeader.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function getVersion(): Promise<string> {
  try {
    const r = await fetch("/package.json");
    if (r.ok) {
      const pkg = await r.json();
      return `${pkg.version ?? "0.0.0"}`;
    }
  } catch { /* ignore */ }
  return "0.0.0";
}

interface Stats {
  tabs: number;
  bookmarks: number;
  history: number;
  profiles: number;
}

async function getStats(): Promise<Stats> {
  let tabs = 0, bookmarks = 0, history = 0, profiles = 0;
  try {
    tabs = (window.parent as any).tabs?.list?.()?.length ?? 0;
  } catch { /* ignore */ }
  try {
    const mod = await import("../../../apis/bookmarks");
    bookmarks = mod.BookmarkManager.getInstance().getBookmarks().length;
  } catch { /* ignore */ }
  try {
    const mod = await import("../../../apis/history");
    history = mod.HistoryManager.getInstance().getEntries().length;
  } catch { /* ignore */ }
  try {
    const p = await getProfiles();
    profiles = (await p.listProfiles())?.length ?? 0;
  } catch { /* ignore */ }
  return { tabs, bookmarks, history, profiles };
}
