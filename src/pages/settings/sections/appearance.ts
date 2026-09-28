
import { createIcons, icons } from "lucide";
import iro from "@jaames/iro";
import { createRow } from "../components/row";
import { createSubpage } from "../components/subpage";
import { createToggle } from "../components/toggle";
import { openModal } from "../components/modal";
import { showInlineNotice } from "../components/notice";
import { getEventsAPI, getHost, getSettingsAPI, getTheming } from "../data/host";
import { themeManager } from "@utils/themeManager";
import { normalizeCustomHomePage } from "@utils/homePage";
import type { SectionContext } from "./types";

let pendingCleanups: Array<() => void> = [];

function registerCleanup(fn: () => void) {
  pendingCleanups.push(fn);
}

export function unmount(): void {
  const list = pendingCleanups;
  pendingCleanups = [];
  for (const fn of list) {
    try { fn(); } catch { /* ignore */ }
  }
}

export async function render(container: HTMLElement, ctx: SectionContext): Promise<void> {
  unmount();
  container.innerHTML = "";
  if (ctx.subpage === "theme") return renderTheme(container);
  if (ctx.subpage === "background") return renderBackground(container);
  if (ctx.subpage === "new-tab-page" || ctx.subpage === "newtab") return renderNewTabPage(container);
  return renderMain(container);
}

function renderMain(container: HTMLElement): void {
  const section = document.createElement("div");
  section.className = "settings-section";
  section.dataset.sectionId = "appearance";

  const h2 = document.createElement("h2");
  h2.className = "settings-section-title";
  h2.textContent = "Appearance and behavior";
  section.appendChild(h2);

  section.appendChild(createRow({
    icon: "palette",
    label: "Theme",
    description: "Pick a color theme or customize colors",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#appearance?subpage=theme"; },
    searchUnit: {
      id: "appearance/theme",
      label: "Theme",
      sectionId: "appearance",
      keywords: ["color", "dark", "light", "mocha", "presets", "accent"],
    },
  }));

  section.appendChild(createRow({
    icon: "image",
    label: "Background",
    description: "Upload a background image or use the theme's",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#appearance?subpage=background"; },
    searchUnit: {
      id: "appearance/background",
      label: "Background",
      sectionId: "appearance",
      keywords: ["wallpaper", "image", "upload"],
    },
  }));

  section.appendChild(
    createToggle({
      icon: "image-down",
      label: "Use theme's background image",
      description: "Apply the active theme's bundled wallpaper when no custom image is set.",
      settingKey: "theme:useThemeBackground",
      defaultValue: true,
      onChange: () => { emitBackgroundChanged(); },
      searchUnit: {
        id: "appearance/use-theme-background",
        label: "Use theme's background image",
        sectionId: "appearance",
        keywords: ["theme background", "wallpaper", "preset"],
      },
    }).element,
  );

  section.appendChild(createRow({
    icon: "layout-grid",
    label: "New tab page",
    description: "Customize the new-tab page",
    right: { kind: "chevron" },
    onClick: () => { location.hash = "#appearance?subpage=newtab"; },
    searchUnit: {
      id: "appearance/newtab",
      label: "New tab page",
      sectionId: "appearance",
      keywords: ["start page", "shortcuts", "greeting", "search"],
    },
  }));

  section.appendChild(createRow({
    icon: "book-marked",
    label: "Bookmarks bar",
    description: "Choose when the bookmarks bar is visible.",
    right: { kind: "custom", element: makeBookmarksBarVisibilitySelect() },
    noHover: true,
    searchUnit: {
      id: "appearance/bookmarks-bar",
      label: "Bookmarks bar",
      sectionId: "appearance",
      keywords: ["bookmarks", "bookmarks bar", "new tab", "show", "hide", "visibility"],
    },
  }));

  section.appendChild(createRow({
    icon: "home",
    label: "Home page",
    description: "URL opened by the home button",
    right: { kind: "custom", element: makeHomePageInput() },
    noHover: true,
    searchUnit: {
      id: "appearance/home",
      label: "Home page",
      sectionId: "appearance",
      keywords: ["url", "homepage"],
    },
  }));

  container.appendChild(section);
  createIcons({ icons });
}

function makeBookmarksBarVisibilitySelect(): HTMLElement {
  const select = document.createElement("select");
  select.name = "bookmarksBarVisibility";
  select.setAttribute("aria-label", "Bookmarks bar visibility");
  select.className = "modal-input";
  const options = [
    { value: "newtab", label: "New tab only" },
    { value: "always", label: "Always show" },
    { value: "hidden", label: "Hidden" },
  ];
  for (const { value, label } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  const api = getSettingsAPI();
  let value = "always";
  select.disabled = true;
  void (async () => {
    try {
      const stored = await api.getItem<string>("bookmarksBarVisibility");
      if (options.some((option) => option.value === stored)) value = stored!;
      select.value = value;
    } catch (err) {
      console.warn("[settings/appearance] bookmarks bar visibility load failed", err);
    } finally {
      select.disabled = false;
    }
  })();

  select.addEventListener("change", async () => {
    const nextValue = select.value;
    select.disabled = true;
    try {
      await api.setItem("bookmarksBarVisibility", nextValue);
      value = nextValue;
      getEventsAPI().emit("bookmarks-bar:visibility-change", { visibility: value, persisted: true });
    } catch (err) {
      console.warn("[settings/appearance] bookmarks bar visibility save failed", err);
      select.value = value;
      showInlineNotice("Failed to save bookmarks bar visibility.", { kind: "error" });
    } finally {
      select.disabled = false;
    }
  });

  return select;
}

function makeHomePageInput(): HTMLElement {
  const input = document.createElement("input");
  input.type = "url";
  input.className = "modal-input";
  input.style.width = "300px";
  input.placeholder = "https://example.com";

  const api = getSettingsAPI();

  void (async () => {
    try {
      const stored = await api.getItem<string>("homePage");
      input.value = stored ?? "";
    } catch {
      input.value = "";
    }
  })();

  const commit = async () => {
    const rawValue = input.value.trim();
    const value = rawValue ? normalizeCustomHomePage(rawValue) : "";
    if (value === null) return;
    if (value) input.value = value;
    try {
      await api.setItem("homePage", value);
      await (getHost() as { protocols?: { updateHomeProtocol(url: string): Promise<void> | void } })
        .protocols?.updateHomeProtocol(value);
    } catch (err) {
      console.warn("[settings/appearance] home page save failed", err);
      showInlineNotice("Failed to save home page URL.", { kind: "error" });
    }
  };
  input.addEventListener("change", () => { void commit(); });
  input.addEventListener("blur", () => { void commit(); });

  return input;
}

function emitBackgroundChanged(): void {
  try { getEventsAPI().emit("theme:background-change", null); } catch { /* ignore */ }
}

const COLOR_TARGETS: Record<string, { property: string; aliases?: string[] }> = {
  accent: { property: "main-color", aliases: ["main"] },
  background: { property: "background-color", aliases: ["bg-2"] },
  panel: { property: "input-background-color", aliases: ["bg-1"] },
  text: { property: "text-color", aliases: ["text"] },
  border: { property: "border-color" },
};

function renderTheme(container: HTMLElement): void {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Appearance and behavior",
    title: "Theme",
    parentSectionId: "appearance",
    render: async (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";
      body.appendChild(stack);

      const loading = document.createElement("div");
      loading.className = "row-sub";
      loading.style.padding = "12px 4px";
      loading.textContent = "Loading themes…";
      stack.appendChild(loading);

      let theming: Awaited<ReturnType<typeof getTheming>> | null = null;
      try {
        theming = await getTheming();
      } catch (err) {
        loading.textContent = "Theme controls unavailable: host theming did not initialize.";
        console.warn("[settings/appearance/theme] getTheming() failed", err);
        return;
      }

      let themes: Record<string, any> = {};
      try {
        themes = await themeManager.loadThemes();
      } catch (err) {
        console.warn("[settings/appearance/theme] themeManager.loadThemes failed", err);
      }
      loading.remove();

      const settingsApi = getSettingsAPI();
      const events = (() => {
        try { return getEventsAPI(); } catch { return null; }
      })();

      let currentTheme: string =
        (await settingsApi.getItem<string>("currentTheme")) || theming.currentTheme || "daydreamer";
      if (!themes[currentTheme]) {
        const fallback = Object.keys(themes)[0] ?? "daydreamer";
        console.warn(`[appearance/theme] Theme '${currentTheme}' not loaded, falling back to '${fallback}'`);
        currentTheme = fallback;
      }
      themeManager.setCurrentTheme(currentTheme);

      const presetsCard = document.createElement("div");
      presetsCard.className = "appearance-card";
      const presetsTitle = document.createElement("h3");
      presetsTitle.className = "appearance-card-title";
      presetsTitle.textContent = "Theme Presets";
      presetsCard.appendChild(presetsTitle);

      const presetsHeading = document.createElement("h4");
      presetsHeading.className = "appearance-card-subheading";
      presetsHeading.textContent = "Choose a Theme";
      presetsCard.appendChild(presetsHeading);

      const themePresetGrid = document.createElement("div");
      themePresetGrid.id = "themePresetGrid";
      themePresetGrid.className = "theme-preset-grid";
      presetsCard.appendChild(themePresetGrid);

      const customSection = document.createElement("div");
      customSection.className = "appearance-card-section";
      const customTitle = document.createElement("h4");
      customTitle.className = "appearance-card-subheading";
      customTitle.textContent = "Customize Colors";
      customSection.appendChild(customTitle);

      const colorTargetTabs = document.createElement("div");
      colorTargetTabs.className = "color-target-tabs";
      let activeColorTarget = "accent";
      for (const [key, label] of [
        ["accent", "Accent"],
        ["background", "Background"],
        ["panel", "Panel"],
        ["text", "Text"],
        ["border", "Border"],
      ] as const) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "color-target-tab" + (key === "accent" ? " active" : "");
        btn.dataset.target = key;
        btn.textContent = label;
        colorTargetTabs.appendChild(btn);
      }
      customSection.appendChild(colorTargetTabs);

      const customizeRow = document.createElement("div");
      customizeRow.className = "customize-colors-row";

      const colorPickerEl = document.createElement("div");
      colorPickerEl.className = "colorPicker";
      customizeRow.appendChild(colorPickerEl);

      const customizeRight = document.createElement("div");
      customizeRight.className = "customize-colors-right";

      const accentPalette = document.createElement("div");
      accentPalette.id = "accentColorPalette";
      const palHeading = document.createElement("h5");
      palHeading.className = "appearance-palette-heading";
      palHeading.textContent = "Accents";
      accentPalette.appendChild(palHeading);
      const accentColorGrid = document.createElement("div");
      accentColorGrid.className = "accent-color-grid";
      accentPalette.appendChild(accentColorGrid);
      customizeRight.appendChild(accentPalette);

      const colorInputs = document.createElement("div");
      colorInputs.className = "color-inputs";
      const hexInput = document.createElement("input");
      hexInput.placeholder = "#7c3aed";
      const rgbInput = document.createElement("input");
      rgbInput.placeholder = "rgb(124, 58, 237)";
      const hslInput = document.createElement("input");
      hslInput.placeholder = "hsl(263, 84%, 58%)";
      colorInputs.appendChild(hexInput);
      colorInputs.appendChild(rgbInput);
      colorInputs.appendChild(hslInput);
      customizeRight.appendChild(colorInputs);

      customizeRow.appendChild(customizeRight);
      customSection.appendChild(customizeRow);
      presetsCard.appendChild(customSection);

      stack.appendChild(presetsCard);

      stack.appendChild(
        createRow({
          icon: "rotate-ccw",
          label: "Reset theme to defaults",
          description: "Clear custom accent and color overrides, restore Daydreamer.",
          right: {
            kind: "button",
            text: "Reset",
            variant: "danger",
            onClick: () => openResetModal(theming!),
          },
          searchUnit: {
            id: "appearance/theme/reset",
            label: "Reset theme to defaults",
            sectionId: "appearance",
            keywords: ["reset", "defaults", "restore"],
          },
        }),
      );

      const buildPresetGrid = () => {
        themePresetGrid.innerHTML = "";
        const entries = Object.entries(themes);
        if (entries.length === 0) {
          const err = document.createElement("div");
          err.className = "row-sub";
          err.textContent = "No themes could be loaded.";
          themePresetGrid.appendChild(err);
          return;
        }
        for (const [themeKey, theme] of entries) {
          let button: HTMLElement;
          try {
            button = themeManager.generateThemePreview(theme);
          } catch (err) {
            console.warn(`[appearance/theme] generateThemePreview failed for ${themeKey}`, err);
            continue;
          }
          if (themeKey === currentTheme) button.classList.add("active");
          button.addEventListener("click", async () => {
            currentTheme = themeKey;
            try { await settingsApi.setItem("currentTheme", themeKey); } catch { /* ignore */ }
            themeManager.setCurrentTheme(themeKey);
            try { events?.emit("theme:preset-change", { theme: themeKey }); } catch { /* ignore */ }
            updateActiveButton();
            updateCustomColorVisibility();
            renderAccentArea();
            resetColorTargetTabs();
            document.documentElement.classList.add("theme-preview-animation");
            setTimeout(() => document.documentElement.classList.remove("theme-preview-animation"), 400);
          });
          themePresetGrid.appendChild(button);
        }
      };

      const updateActiveButton = () => {
        const keys = Object.keys(themes);
        const buttons = Array.from(themePresetGrid.querySelectorAll(".theme-preset-button"));
        buttons.forEach((btn, i) => {
          btn.classList.toggle("active", keys[i] === currentTheme);
        });
      };

      const updateCustomColorVisibility = () => {
        const customizable = themeManager.isThemeCustomizable(currentTheme);
        customSection.style.display = customizable ? "" : "none";
      };

      const initialColor = (await settingsApi.getItem<string>("themeColor")) || "rgba(141, 1, 255, 1)";
      const colorPicker = new (iro as any).ColorPicker(colorPickerEl, {
        width: 240,
        color: initialColor,
        borderWidth: 1,
        borderColor: "#fff",
        layout: [
          { component: (iro as any).ui.Box },
          { component: (iro as any).ui.Slider, options: { id: "hue-slider", sliderType: "hue" } },
        ],
      });

      colorPicker.on(["color:init", "color:change"], (color: any) => {
        hexInput.value = color.hexString;
        rgbInput.value = color.rgbString;
        hslInput.value = color.hslString;
      });

      const emitColorForTarget = (color: string) => {
        if (!events) return;
        if (activeColorTarget === "accent") {
          events.emit("theme:color-change", { color });
        } else {
          const targetInfo = COLOR_TARGETS[activeColorTarget];
          if (!targetInfo) return;
          events.emit("theme:property-change", {
            property: targetInfo.property,
            aliases: targetInfo.aliases,
            color,
            target: activeColorTarget,
          });
        }
      };

      colorPicker.on("input:end", (color: any) => emitColorForTarget(color.rgbaString));

      hexInput.addEventListener("change", () => {
        try { colorPicker.color.hexString = hexInput.value; } catch { return; }
        rgbInput.value = colorPicker.color.rgbString;
        hslInput.value = colorPicker.color.hslString;
        emitColorForTarget(colorPicker.color.rgbaString);
      });
      rgbInput.addEventListener("change", () => {
        try { colorPicker.color.rgbString = rgbInput.value; } catch { return; }
        hexInput.value = colorPicker.color.hexString;
        hslInput.value = colorPicker.color.hslString;
        emitColorForTarget(colorPicker.color.rgbaString);
      });
      hslInput.addEventListener("change", () => {
        try { colorPicker.color.hslString = hslInput.value; } catch { return; }
        hexInput.value = colorPicker.color.hexString;
        rgbInput.value = colorPicker.color.rgbString;
        emitColorForTarget(colorPicker.color.rgbaString);
      });

      colorTargetTabs.querySelectorAll(".color-target-tab").forEach((tab) => {
        tab.addEventListener("click", async () => {
          const target = (tab as HTMLElement).dataset.target;
          if (!target || target === activeColorTarget) return;
          activeColorTarget = target;
          colorTargetTabs.querySelectorAll(".color-target-tab").forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");
          accentPalette.style.display = target === "accent" ? "" : "none";

          const currentColor = await getColorForTarget(target);
          if (currentColor) {
            try { colorPicker.color.set(currentColor); } catch (e) {
              console.warn("[appearance/theme] could not set picker color:", e);
            }
          }
        });
      });

      const resetColorTargetTabs = () => {
        activeColorTarget = "accent";
        colorTargetTabs.querySelectorAll(".color-target-tab").forEach((t) => t.classList.remove("active"));
        const accentTab = colorTargetTabs.querySelector('[data-target="accent"]');
        if (accentTab) accentTab.classList.add("active");
        accentPalette.style.display = "";
      };

      const renderAccentArea = () => {
        accentColorGrid.innerHTML = "";
        const colorRoles = themeManager.getThemeColorRoles(currentTheme);
        if (Object.keys(colorRoles).length > 0) {
          for (const [roleName, color] of Object.entries(colorRoles)) {
            const button = document.createElement("button");
            button.className = "accent-color-button";
            button.style.backgroundColor = color;
            button.setAttribute("data-color", color);
            button.setAttribute("data-role", roleName);
            const label = document.createElement("span");
            label.className = "accent-color-label";
            label.textContent = roleName;
            label.style.color = getContrastTextColor(color);
            button.appendChild(label);
            button.addEventListener("click", () => {
              accentColorGrid.querySelectorAll(".accent-color-button").forEach((b) => b.classList.remove("selected"));
              button.classList.add("selected");
              try { events?.emit("theme:color-role-change", { roleName, color }); } catch { /* ignore */ }
            });
            accentColorGrid.appendChild(button);
          }
        } else {
          const accentColors = themeManager.getThemeAccentColors(currentTheme);
          for (const color of accentColors) {
            const button = themeManager.generateAccentColorButton(color);
            button.addEventListener("click", () => {
              accentColorGrid.querySelectorAll(".accent-color-button").forEach((b) => b.classList.remove("selected"));
              button.classList.add("selected");
              try { events?.emit("theme:accent-change", { color }); } catch { /* ignore */ }
            });
            accentColorGrid.appendChild(button);
          }
        }
      };

      const getColorForTarget = async (target: string): Promise<string | null> => {
        const info = COLOR_TARGETS[target];
        if (!info) return null;
        try {
          const stored = await settingsApi.getItem<string>("customThemeColors");
          const customColors = stored ? JSON.parse(stored) : {};
          if (customColors[info.property]) return customColors[info.property];
        } catch { /* ignore */ }
        const value = getComputedStyle(document.documentElement).getPropertyValue(`--${info.property}`).trim();
        return value || null;
      };

      if (events) {
        const onGlobalUpdate = (event: any) => {
          if (!event.detail) return;
          const { type, theme, color, colorRole } = event.detail;
          if (type === "preset" && theme && theme !== currentTheme) {
            currentTheme = theme;
            themeManager.setCurrentTheme(theme);
            updateActiveButton();
            updateCustomColorVisibility();
            renderAccentArea();
            resetColorTargetTabs();
          }
          if ((type === "color" || type === "accent") && color) {
            try { colorPicker.color.set(color); } catch { /* ignore */ }
          }
          if (type === "colorRole" && colorRole) {
            accentColorGrid.querySelectorAll(".accent-color-button").forEach((b) => {
              b.classList.toggle("selected", b.getAttribute("data-role") === colorRole);
            });
          }
          if (type === "property" && color && event.detail.target === activeColorTarget) {
            try { colorPicker.color.set(color); } catch { /* ignore */ }
          }
        };
        events.addEventListener("theme:global-update", onGlobalUpdate as EventListener);
        registerCleanup(() => {
          events.removeEventListener("theme:global-update", onGlobalUpdate as EventListener);
        });
      }

      buildPresetGrid();
      updateCustomColorVisibility();
      renderAccentArea();
      createIcons({ icons });
    },
  });
  container.appendChild(sub);
}

function getContrastTextColor(backgroundColor: string): string {
  let hex = backgroundColor;
  if (backgroundColor.startsWith("rgb")) {
    const rgbMatch = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      return brightness > 128 ? "#000000" : "#ffffff";
    }
  }
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  else if (hex.length !== 6) return "#ffffff";
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "#ffffff";
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? "#000000" : "#ffffff";
}

function openResetModal(theming: Awaited<ReturnType<typeof getTheming>>): void {
  openModal({
    title: "Reset theme?",
    description: "Removes custom accent and color-role overrides and reverts the active theme to Daydreamer.",
    secondary: { label: "Cancel", onClick: () => {}, variant: "ghost" },
    primary: {
      label: "Reset",
      variant: "danger",
      onClick: async () => {
        try {
          if (typeof (theming as any).resetToDefault === "function") {
            await (theming as any).resetToDefault();
          } else {
            const api = getSettingsAPI();
            try { await api.removeItem("themeColor"); } catch { /* ignore */ }
            try { await api.removeItem("customThemeColors"); } catch { /* ignore */ }
            try { await api.removeItem("selectedColorRole"); } catch { /* ignore */ }
            try { await api.setItem("currentTheme", "daydreamer"); } catch { /* ignore */ }
            (theming as any).customMainColor = null;
            (theming as any).customThemeColors = {};
            (theming as any).selectedColorRole = null;
            if (typeof (theming as any).applyTheme === "function") {
              await (theming as any).applyTheme("daydreamer");
            }
          }
          try { getEventsAPI().emit("theme:preset-change", { theme: "daydreamer" }); } catch { /* ignore */ }
          showInlineNotice("Theme reset to defaults.");
        } catch (err) {
          console.warn("[settings/appearance/theme] reset failed", err);
          showInlineNotice("Failed to reset theme.", { kind: "error" });
        }
      },
    },
  });
}

function renderBackground(container: HTMLElement): void {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Appearance and behavior",
    title: "Background",
    parentSectionId: "appearance",
    render: async (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";
      body.appendChild(stack);

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.style.display = "none";
      stack.appendChild(fileInput);

      const hero = document.createElement("div");
      hero.className = "settings-bg-hero";
      stack.appendChild(hero);

      const api = getSettingsAPI();

      let drawGen = 0;
      const drawHero = async () => {
        const gen = ++drawGen;

        let userBg: string | null = null;
        try {
          userBg = (await api.getItem<string>("theme:user-background-image")) ?? null;
        } catch { /* ignore */ }
        if (gen !== drawGen) return;

        let theming: Awaited<ReturnType<typeof getTheming>> | null = null;
        try { theming = await getTheming(); } catch { /* ignore */ }
        if (gen !== drawGen) return;

        const currentThemeId = theming?.currentTheme ?? "";
        const themeName = theming?.themes?.[currentThemeId]?.name ?? currentThemeId;
        const themeBg = theming?.themes?.[currentThemeId]?.["background-image"] ?? null;

        const next = document.createDocumentFragment();

        const thumb = document.createElement("div");
        thumb.className = "bg-hero-thumb";
        if (userBg) {
          thumb.style.backgroundImage = `url("${userBg}")`;
        } else if (themeBg) {
          thumb.style.backgroundImage = `url("${themeBg}")`;
        } else {
          thumb.textContent = "No background";
        }
        next.appendChild(thumb);

        const info = document.createElement("div");
        info.className = "bg-hero-info";

        const status = document.createElement("div");
        const statusTitle = document.createElement("div");
        statusTitle.className = "bg-hero-status-title";
        const statusSub = document.createElement("div");
        statusSub.className = "bg-hero-status-sub";

        if (userBg) {
          statusTitle.textContent = "Custom upload";
          statusSub.textContent = "Your uploaded image is currently shown.";
        } else if (themeBg) {
          statusTitle.textContent = `Theme: ${themeName}`;
          statusSub.textContent = "Using the active theme's bundled wallpaper.";
        } else {
          statusTitle.textContent = "None";
          statusSub.textContent = "No background image set.";
        }
        status.appendChild(statusTitle);
        status.appendChild(statusSub);
        info.appendChild(status);

        const actions = document.createElement("div");
        actions.className = "bg-hero-actions";

        const removeBtn = document.createElement("button");
        removeBtn.className = "settings-button ghost";
        removeBtn.textContent = "Remove";
        removeBtn.disabled = !userBg;
        if (!userBg) {
          removeBtn.title = "No custom upload to remove.";
        }
        removeBtn.addEventListener("click", async () => {
          if (!userBg) return;
          try {
            await api.removeItem("theme:user-background-image");
            try { getEventsAPI().emit("theme:background-change", null); } catch { /* ignore */ }
            showInlineNotice("Custom background removed.");
          } catch (err) {
            console.warn("[settings/appearance/bg] remove failed", err);
            showInlineNotice("Failed to remove background.", { kind: "error" });
          }
        });

        const replaceBtn = document.createElement("button");
        replaceBtn.className = "settings-button";
        replaceBtn.textContent = userBg ? "Replace" : "Upload";
        replaceBtn.addEventListener("click", () => fileInput.click());

        actions.appendChild(removeBtn);
        actions.appendChild(replaceBtn);
        info.appendChild(actions);

        next.appendChild(info);

        if (gen !== drawGen) return;
        hero.replaceChildren(next);
      };

      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
          showInlineNotice("Only image files are allowed.", { kind: "error" });
          return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result;
          if (typeof dataUrl !== "string") return;
          try {
            await api.setItem("theme:user-background-image", dataUrl);
            try { getEventsAPI().emit("theme:background-change", null); } catch { /* ignore */ }
            showInlineNotice("Background updated.");
          } catch (err) {
            console.warn("[settings/appearance/bg] upload failed", err);
            showInlineNotice("Failed to save background image.", { kind: "error" });
          }
        };
        reader.onerror = () => {
          showInlineNotice("Failed to read the selected file.", { kind: "error" });
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
      });

      await drawHero();

      stack.appendChild(
        createToggle({
          icon: "image-down",
          label: "Use theme's background image",
          description: "Apply the active theme's bundled wallpaper when no custom image is set.",
          settingKey: "theme:useThemeBackground",
          defaultValue: true,
          onChange: () => { emitBackgroundChanged(); },
          searchUnit: {
            id: "appearance/background/use-theme",
            label: "Use theme's background image",
            sectionId: "appearance",
            keywords: ["theme wallpaper", "preset"],
          },
        }).element,
      );

      const events = (() => {
        try { return getEventsAPI(); } catch { return null; }
      })();
      if (events) {
        const onBg = () => { void drawHero(); };
        events.addEventListener("theme:background-change", onBg as EventListener);
        events.addEventListener("theme:preset-change", onBg as EventListener);
        registerCleanup(() => {
          events.removeEventListener("theme:background-change", onBg as EventListener);
          events.removeEventListener("theme:preset-change", onBg as EventListener);
        });
      }

      createIcons({ icons });
    },
  });
  container.appendChild(sub);
}

function renderNewTabPage(container: HTMLElement): void {
  container.innerHTML = "";
  const sub = createSubpage({
    parentLabel: "Appearance and behavior",
    title: "New tab page",
    parentSectionId: "appearance",
    render: (body) => {
      const stack = document.createElement("div");
      stack.className = "subpage-stack";

      stack.appendChild(
        createToggle({
          icon: "grid-3x3",
          label: "Show shortcuts grid",
          description: "Display the 12-tile shortcut grid on the new-tab page.",
          settingKey: "newtabShowShortcuts",
          defaultValue: true,
          readMap: (raw) => {
            if (raw === true || raw === "true") return true;
            if (raw === false || raw === "false") return false;
            return undefined;
          },
          writeMap: (v) => (v ? "true" : "false"),
          searchUnit: {
            id: "appearance/newtab/shortcuts",
            label: "Show shortcuts grid",
            sectionId: "appearance",
            keywords: ["new tab", "shortcuts", "grid"],
          },
        }).element,
      );

      stack.appendChild(
        createToggle({
          icon: "sun",
          label: "Show greeting / clock",
          description: "Show a greeting and time-of-day clock on the new-tab page.",
          settingKey: "newtabShowGreeting",
          defaultValue: true,
          searchUnit: {
            id: "appearance/newtab/greeting",
            label: "Show greeting / clock",
            sectionId: "appearance",
            keywords: ["greeting", "clock", "time"],
          },
        }).element,
      );

      stack.appendChild(
        createToggle({
          icon: "search",
          label: "Show search bar",
          description: "Display the search box on the new-tab page.",
          settingKey: "newtabShowSearch",
          defaultValue: true,
          searchUnit: {
            id: "appearance/newtab/search",
            label: "Show search bar",
            sectionId: "appearance",
            keywords: ["search", "omnibox", "new tab"],
          },
        }).element,
      );

      stack.appendChild(
        createToggle({
          icon: "user",
          label: "Show Night+ login banner",
          description: "Offer Night+ sign-in on the new-tab page.",
          settingKey: "newtabShowNightPlusBanner",
          defaultValue: true,
          searchUnit: {
            id: "appearance/newtab/nightplus",
            label: "Show Night+ login banner",
            sectionId: "appearance",
            keywords: ["night+", "nightplus", "sign in", "banner"],
          },
        }).element,
      );

      body.appendChild(stack);
      createIcons({ icons });
    },
  });
  container.appendChild(sub);
}
