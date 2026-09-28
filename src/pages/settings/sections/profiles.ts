import { createIcons, icons } from "lucide";
import { settingsSearch } from "../components/settingsSearch";
import { createRow } from "../components/row";
import { openModal } from "../components/modal";
import { createProfileHero, computeStats } from "../components/profileHero";
import { openSwitcherDropdown, type SwitcherEntry } from "../components/profileSwitcher";
import { createAvatar, AVATAR_COLOR_PRESETS, AVATAR_ICON_PRESETS, resolveAppearance } from "../data/profileAppearance";
import { createSubpage } from "../components/subpage";
import { getProfiles, getSitePermissions, getHost } from "../data/host";
import { coverIdentity } from "@core/shared/build-runtime";
import type { ProfilesAPI } from "@apis/profiles/ProfilesAPI";
import type { SectionContext } from "./types";
import type { ProfileData, ProfileAppearance } from "../../../apis/profiles/types";

let offChange: (() => void) | undefined;
let renderGen = 0;

function renderLoadingSkeleton(container: HTMLElement): void {
  container.innerHTML = "";
  const section = document.createElement("div");
  section.className = "settings-section";
  const skel = document.createElement("div");
  skel.className = "settings-empty-state";
  const title = document.createElement("div");
  title.className = "empty-title";
  title.textContent = "Loading profiles…";
  skel.appendChild(title);
  section.appendChild(skel);
  container.appendChild(section);
}

function renderHostUnavailable(container: HTMLElement, ctx: SectionContext, err: unknown): void {
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "settings-empty-state";
  const title = document.createElement("div");
  title.className = "empty-title";
  title.textContent = "Profiles unavailable";
  empty.appendChild(title);
  const sub = document.createElement("div");
  sub.className = "empty-sub";
  sub.textContent = err instanceof Error ? err.message : "Host profiles API is not available.";
  empty.appendChild(sub);
  const retry = document.createElement("button");
  retry.className = "settings-button";
  retry.textContent = "Retry";
  retry.style.marginTop = "12px";
  retry.addEventListener("click", () => { void render(container, ctx); });
  empty.appendChild(retry);
  container.appendChild(empty);
}

export async function render(container: HTMLElement, ctx: SectionContext): Promise<void> {
  const gen = ++renderGen;
  renderLoadingSkeleton(container);

  let profiles: ProfilesAPI;
  try {
    profiles = await getProfiles();
  } catch (err) {
    if (gen !== renderGen) return;
    renderHostUnavailable(container, ctx, err);
    return;
  }
  if (gen !== renderGen) return;
  container.innerHTML = "";

  if (ctx.subpage === "import") return renderImportSubpage(container);
  if (ctx.subpage && ctx.subpage.startsWith("profile-")) {
    let targetId: string;
    try {
      targetId = decodeURIComponent(ctx.subpage.slice("profile-".length));
    } catch {
      container.innerHTML = '';
      const empty = document.createElement("div");
      empty.className = "settings-empty-state";
      const title = document.createElement("div");
      title.className = "empty-title";
      title.textContent = "Invalid profile link";
      empty.appendChild(title);
      container.appendChild(empty);
      return;
    }
    return renderProfileDetailSubpage(container, targetId, profiles);
  }

  await renderMain(container, profiles);
  if (gen !== renderGen) return;

  if (offChange) offChange();
  offChange = profiles.onChange(() => {
    void render(container, ctx);
  });
}

export function unmount(): void {
  settingsSearch.scope(null);
  if (offChange) { offChange(); offChange = undefined; }
}

async function renderMain(container: HTMLElement, profiles: ProfilesAPI) {
  const section = document.createElement("div");
  section.className = "settings-section";
  section.dataset.sectionId = "profiles";

  const h2 = document.createElement("h2");
  h2.className = "settings-section-title";
  h2.textContent = "Profiles";
  section.appendChild(h2);

  const activeId: string | null = profiles.getCurrentProfile();
  const all: string[] = await profiles.listProfiles();
  const activeData = activeId ? await profiles.getProfileData(activeId) : null;

  if (activeId) {
    const stats = await computeStats(activeId, activeData);
    let switchBtn: HTMLButtonElement | null = null;
    let manageBtn: HTMLButtonElement | null = null;
    const hero = createProfileHero(activeId, activeData, stats, {
      onSwitch: () => { if (switchBtn) openSwitchDropdown(switchBtn, all, activeId, profiles); },
      onManage: () => { if (manageBtn) openManageDropdown(manageBtn, activeId, all.length, profiles); },
    });
    section.appendChild(hero);
    const buttons = Array.from(hero.querySelectorAll<HTMLButtonElement>(".hero-actions button"));
    switchBtn = buttons[0] ?? null;
    manageBtn = buttons[1] ?? null;
  } else {
    const noProfile = document.createElement("div");
    noProfile.className = "settings-row no-hover";
    noProfile.innerHTML = '<div class="row-stack"><div class="row-label">No active profile</div><div class="row-sub">Add a profile below to get started.</div></div>';
    section.appendChild(noProfile);
  }

  if (activeId) {
    section.appendChild(createRow({
      label: "Rename this profile",
      right: { kind: "chevron" },
      onClick: () => openRenameModal(activeId, profiles),
      searchUnit: { id: "profiles/rename", label: "Rename this profile", sectionId: "profiles", keywords: ["change name"] },
    }));
    section.appendChild(createRow({
      label: "Change avatar & color",
      right: { kind: "chevron" },
      onClick: () => openAvatarModal(activeId, activeData?.appearance, profiles),
      searchUnit: { id: "profiles/avatar", label: "Change avatar and color", sectionId: "profiles", keywords: ["icon", "picture", "image"] },
    }));
    section.appendChild(createRow({
      label: "Clear data for this profile",
      right: { kind: "chevron" },
      onClick: () => openClearDataModal(activeId, activeData, profiles),
      searchUnit: { id: "profiles/clear", label: "Clear data for this profile", sectionId: "profiles", keywords: ["cookies", "storage", "delete", "reset"] },
    }));
    section.appendChild(createRow({
      label: "Export this profile",
      right: { kind: "chevron" },
      onClick: () => exportActive(activeId, profiles),
      searchUnit: { id: "profiles/export", label: "Export this profile", sectionId: "profiles", keywords: ["backup", "download", "json"] },
    }));
  }

  const allHeader = document.createElement("div");
  allHeader.className = "settings-subheader";
  allHeader.textContent = "All profiles";
  section.appendChild(allHeader);

  for (const id of all) {
    const data = await profiles.getProfileData(id);
    const isActive = id === activeId;
    const stack = document.createElement("div");
    stack.className = "profile-row-avatar";
    stack.appendChild(createAvatar(id, data?.appearance, { size: 22 }));
    const name = document.createElement("span");
    name.textContent = id;
    stack.appendChild(name);

    const row = document.createElement("div");
    row.className = "settings-row";
    row.appendChild(stack);
    const right = document.createElement("div");
    right.className = "row-right";
    if (isActive) {
      const pill = document.createElement("span");
      pill.className = "row-pill";
      pill.textContent = "Active";
      right.appendChild(pill);
    } else {
      const btn = document.createElement("button");
      btn.className = "settings-button ghost";
      btn.textContent = "Switch";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void switchTo(id, profiles);
      });
      right.appendChild(btn);
      row.addEventListener("click", () => {
        location.hash = `#profiles?subpage=profile-${encodeURIComponent(id)}`;
      });
    }
    row.appendChild(right);
    settingsSearch.register({ id: `profiles/profile-${id}`, label: id, sectionId: "profiles", keywords: ["profile"], element: row });
    section.appendChild(row);
  }

  const isNightPlus = await checkNightPlus();
  const max = 3;
  if (all.length >= max && !isNightPlus) {
    section.appendChild(createRow({
      icon: "crown",
      label: "Upgrade for unlimited profiles",
      description: `Free plan is limited to ${max} profiles.`,
      right: { kind: "chevron" },
      onClick: () => { location.hash = "#nightplus"; },
      searchUnit: { id: "profiles/upgrade", label: "Upgrade for unlimited profiles", sectionId: "profiles" },
    }));
  } else {
    const addRow = createRow({
      icon: "plus",
      label: "Add profile",
      onClick: async () => {
        try {
          const host = getHost();
          const fns = (host as any).functions;
          if (fns?.showCreateProfileDialog) {
            await fns.showCreateProfileDialog();
          } else {
            console.warn("[profiles] window.parent.functions.showCreateProfileDialog not available");
          }
        } catch (err) {
          console.warn("[profiles] create profile failed", err);
        }
      },
      searchUnit: { id: "profiles/add", label: "Add profile", sectionId: "profiles", keywords: ["create", "new"] },
    });
    addRow.classList.add("profile-add-row");
    section.appendChild(addRow);
  }

  const dataHeader = document.createElement("div");
  dataHeader.className = "settings-subheader";
  dataHeader.textContent = "Data & backup";
  section.appendChild(dataHeader);

  section.appendChild(createRow({
    label: "Import bookmarks & settings",
    description: "From Chrome, Firefox, or a profile JSON",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#profiles?subpage=import"; },
    searchUnit: { id: "profiles/import", label: "Import bookmarks and settings", sectionId: "profiles", keywords: ["chrome", "firefox", "json", "restore"] },
  }));

  container.appendChild(section);
  createIcons({ icons });
}

async function checkNightPlus(): Promise<boolean> {
  try {
    const mod = await import("@apis/nightplus");
    return Boolean(await mod.checkNightPlusStatus());
  } catch (err) {
    console.warn("[profiles] Night+ status check failed", err);
    return false;
  }
}

async function openSwitchDropdown(anchor: HTMLElement, all: string[], activeId: string, profiles: ProfilesAPI) {
  const filtered = all.filter(id => id !== activeId);
  const entries: SwitcherEntry[] = await Promise.all(
    filtered.map(async (id) => ({
      id,
      data: await profiles.getProfileData(id),
      onClick: () => void switchTo(id, profiles),
    } as SwitcherEntry))
  );
  if (entries.length === 0) entries.push({ id: "", iconOnly: "info", label: "No other profiles", data: null, onClick: () => {}, disabled: true });
  openSwitcherDropdown(anchor, entries);
}

function openManageDropdown(anchor: HTMLElement, activeId: string, totalCount: number, profiles: ProfilesAPI) {
  const entries: SwitcherEntry[] = [
    { id: "rename", iconOnly: "edit-2", label: "Rename", data: null, onClick: () => openRenameModal(activeId, profiles) },
    { id: "avatar", iconOnly: "image", label: "Change avatar", data: null, onClick: async () => {
        const data = await profiles.getProfileData(activeId);
        openAvatarModal(activeId, data?.appearance, profiles);
      } },
    { id: "export", iconOnly: "download", label: "Export", data: null, onClick: () => exportActive(activeId, profiles) },
    { id: "delete", iconOnly: "trash-2", label: "Delete profile", data: null, danger: true, disabled: totalCount <= 1, onClick: () => openDeleteModal(activeId, profiles) },
  ];
  openSwitcherDropdown(anchor, entries);
}

async function switchTo(id: string, profiles: ProfilesAPI) {
  try {
    await profiles.switchProfile(id);
    location.reload();
  } catch (e) {
    console.error("[settings] switch failed", e);
  }
}

function openRenameModal(currentId: string, profiles: ProfilesAPI) {
  const input = document.createElement("input");
  input.className = "modal-input";
  input.value = currentId;
  input.placeholder = "Profile name";
  const err = document.createElement("div");
  err.className = "modal-error";
  const body = document.createElement("div");
  body.appendChild(input);
  body.appendChild(err);
  const handle = openModal({
    title: "Rename profile",
    body,
    primary: {
      label: "Save",
      closeOnClick: false,
      onClick: async () => {
        const v = input.value.trim();
        if (!v) { err.textContent = "Name cannot be empty"; return; }
        if (v === currentId) { handle.close(); return; }
        const all: string[] = await profiles.listProfiles();
        if (all.includes(v)) { err.textContent = "A profile with that name already exists"; return; }
        const ok = await profiles.renameProfile(currentId, v);
        if (!ok) { err.textContent = "Rename failed"; return; }
        handle.close();
        // onChange observer triggers section re-render.
      },
    },
    secondary: { label: "Cancel", onClick: () => {} },
  });
  requestAnimationFrame(() => input.focus());
}

function openAvatarModal(id: string, current: ProfileAppearance | undefined, profiles: ProfilesAPI) {
  const resolved = resolveAppearance(id, current);
  const chosen: ProfileAppearance = { ...resolved };

  const body = document.createElement("div");
  body.style.cssText = "display:flex; flex-direction:column; gap:14px;";

  let previewEl: HTMLElement = createAvatar(id, chosen, { size: 64 });
  previewEl.style.alignSelf = "center";
  body.appendChild(previewEl);

  function refreshPreview() {
    const updated = createAvatar(id, chosen, { size: 64 });
    updated.style.alignSelf = "center";
    previewEl.replaceWith(updated);
    previewEl = updated;
  }

  const typeRow = document.createElement("div");
  typeRow.style.cssText = "display:flex; gap:8px; justify-content:center;";
  for (const t of ["letter", "icon", "image"] as const) {
    const btn = document.createElement("button");
    btn.className = "settings-button ghost";
    btn.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    btn.addEventListener("click", () => {
      chosen.avatarType = t;
      if (t === "icon" && !chosen.avatarIcon) chosen.avatarIcon = AVATAR_ICON_PRESETS[0];
      refreshPreview();
    });
    typeRow.appendChild(btn);
  }
  body.appendChild(typeRow);

  const colorRow = document.createElement("div");
  colorRow.style.cssText = "display:flex; gap:6px; flex-wrap:wrap; justify-content:center;";
  for (const c of AVATAR_COLOR_PRESETS) {
    const sw = document.createElement("button");
    sw.style.cssText = `width:28px;height:28px;border-radius:50%;background:${c};border:2px solid var(--white-08);cursor:pointer;`;
    sw.addEventListener("click", () => { chosen.color = c; refreshPreview(); });
    colorRow.appendChild(sw);
  }
  body.appendChild(colorRow);

  const iconRow = document.createElement("div");
  iconRow.style.cssText = "display:flex; gap:6px; flex-wrap:wrap; justify-content:center;";
  for (const name of AVATAR_ICON_PRESETS) {
    const btn = document.createElement("button");
    btn.className = "settings-button ghost";
    btn.style.cssText = "padding:6px;";
    btn.innerHTML = `<i data-lucide="${name}" style="width:18px;height:18px;"></i>`;
    btn.addEventListener("click", () => {
      chosen.avatarType = "icon";
      chosen.avatarIcon = name;
      refreshPreview();
    });
    iconRow.appendChild(btn);
  }
  body.appendChild(iconRow);

  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = "image/*";
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      chosen.avatarType = "image";
      chosen.avatarImage = String(reader.result);
      refreshPreview();
    };
    reader.readAsDataURL(file);
  });
  body.appendChild(upload);

  openModal({
    title: "Change avatar & color",
    body,
    primary: {
      label: "Save",
      onClick: async () => {
        await profiles.updateProfileAppearance(id, chosen);
      },
    },
    secondary: { label: "Cancel", onClick: () => {} },
  });
  createIcons({ icons });
}

function openClearDataModal(id: string, data: ProfileData | null, profiles: ProfilesAPI) {
  const counts = {
    cookies: data ? Object.keys(data.cookies).length : 0,
    ls: data ? Object.keys(data.localStorage).length : 0,
    idb: data ? data.indexedDB.length : 0,
  };
  const desc = `This will clear ${counts.cookies} cookies, ${counts.ls} localStorage entries, and ${counts.idb} IndexedDB database(s) for profile "${id}". This cannot be undone.`;
  const handle = openModal({
    title: "Clear data for this profile",
    description: desc,
    primary: {
      label: "Clear all data",
      variant: "danger",
      closeOnClick: false,
      onClick: async () => {
        const errs: string[] = [];
        const tasks: Array<() => Promise<unknown> | unknown> = [
          () => profiles.clearCurrentProfileData(),
          async () => {
            const sp = await getSitePermissions();
            await sp.clearAll();
          },
        ];
        for (const t of tasks) {
          try { await t(); } catch (e) {
            console.error("[settings] clear data step failed", e);
            errs.push(e instanceof Error ? e.message : String(e));
          }
        }
        if (errs.length) {
          const descEl = handle.root.querySelector(".modal-desc");
          if (descEl) {
            descEl.textContent = `Some cleanup steps failed: ${errs.join("; ")}. The profile may be partially cleared.`;
          }
          return;
        }
        handle.close();
      },
    },
    secondary: { label: "Cancel", onClick: () => {} },
  });
}

function openDeleteModal(id: string, profiles: ProfilesAPI) {
  openModal({
    title: `Delete profile "${id}"`,
    description: "This will permanently remove the profile and its data. This cannot be undone.",
    primary: {
      label: "Delete profile",
      variant: "danger",
      onClick: async () => {
        await profiles.deleteProfile(id);
      },
    },
    secondary: { label: "Cancel", onClick: () => {} },
  });
}

async function exportActive(id: string, profiles: ProfilesAPI) {
  try {
    const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const date = new Date().toISOString().slice(0, 10);
    await profiles.downloadExport(`ddx-profile-${slug}-${date}.json`);
  } catch (e) {
    console.error("[settings] export failed", e);
  }
}

function renderImportSubpage(container: HTMLElement) {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Profiles",
    title: "Import bookmarks & settings",
    parentSectionId: "profiles",
    render: (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";
      stack.appendChild(createRow({
        label: "Import from profile JSON",
        description: `Load a ${coverIdentity().product} profile export file.`,
        right: { kind: "button", text: "Choose file", onClick: () => { void importJson(); }, variant: "primary" },
      }));
      stack.appendChild(createRow({
        label: "Import from Chrome",
        description: "Coming soon.",
        noHover: true,
        right: { kind: "none" },
      }));
      stack.appendChild(createRow({
        label: "Import from Firefox",
        description: "Coming soon.",
        noHover: true,
        right: { kind: "none" },
      }));
      body.appendChild(stack);
    },
  });
  container.appendChild(sub);
}

async function importJson(): Promise<void> {
  try {
    const host = getHost();
    const fns = (host as any).functions;
    if (fns?.importProfile) {
      await fns.importProfile();
    } else {
      console.warn("[profiles] window.parent.functions.importProfile not available");
    }
  } catch (err) {
    console.warn("[profiles] import profile failed", err);
  }
}

async function renderProfileDetailSubpage(container: HTMLElement, targetId: string, profiles: ProfilesAPI) {
  container.innerHTML = "";
  const data = await profiles.getProfileData(targetId);
  if (!data) {
    const empty = document.createElement("div");
    empty.className = "settings-empty-state";
    const title = document.createElement("div");
    title.className = "empty-title";
    title.textContent = "Profile not found";
    empty.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "empty-sub";
    sub.textContent = `"${targetId}" no longer exists.`;
    empty.appendChild(sub);
    container.appendChild(empty);
    return;
  }
  const sub = createSubpage({
    parentLabel: "Profiles",
    title: targetId,
    parentSectionId: "profiles",
    render: (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";

      stack.appendChild(createRow({
        label: "Switch to this profile",
        right: { kind: "chevron" },
        onClick: () => void switchTo(targetId, profiles),
      }));
      stack.appendChild(createRow({
        label: "Rename",
        right: { kind: "chevron" },
        onClick: () => openRenameModal(targetId, profiles),
      }));
      stack.appendChild(createRow({
        label: "Change avatar & color",
        right: { kind: "chevron" },
        onClick: () => openAvatarModal(targetId, data.appearance, profiles),
      }));
      stack.appendChild(createRow({
        label: "Export this profile",
        right: { kind: "chevron" },
        onClick: () => exportActive(targetId, profiles),
      }));
      stack.appendChild(createRow({
        label: "Delete profile",
        right: { kind: "button", text: "Delete", variant: "danger", onClick: () => openDeleteModal(targetId, profiles) },
        noHover: true,
      }));
      body.appendChild(stack);
    },
  });
  container.appendChild(sub);
}
