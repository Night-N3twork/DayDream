import "@css/vars.scss";
import "@css/imports.scss";
import "@css/tailwind.css";
import "@css/global.scss";
import "@css/internal.scss";
import "@pages/shared/themeInit";
import "basecoat-css/all";
import { SettingsAPI } from "@apis/settings";
import { EventSystem } from "@apis/events";
import iro from "@jaames/iro";
import { themeManager } from "@utils/themeManager";
import "@utils/global/panic";
import {
  KeybindManager,
  KEYBIND_CATEGORIES,
} from "@browser/functions/keybinds";
import { SearchEngineRegistry, type SearchEngine } from "@apis/searchEngines";
import { resolvePath } from "@utils/basepath";
import { persistHomePage } from "./homeSettings";
const settingsAPI = new SettingsAPI();
const eventsAPI = new EventSystem();
import { createIcons, icons } from "lucide";
import {
  checkNightPlusStatus,
  getPremiumWispServers,
  isAuthenticated,
} from "@apis/nightplus";
import {version} from "@../package.json";

document.addEventListener("DOMContentLoaded", () => {
  const versionElement = document.getElementById("version");
  if (versionElement) {
    versionElement.textContent = version;
  }

  const aside = document.querySelector<HTMLElement>('#aside[aside="settings"]');
  const toggleBtn = document.getElementById(
    "aside-toggle",
  ) as HTMLButtonElement | null;
  const closeBtn = document.getElementById(
    "aside-close",
  ) as HTMLButtonElement | null;

  const hide = (el?: HTMLElement | null) => el && el.classList.add("hidden");
  const show = (el?: HTMLElement | null) => el && el.classList.remove("hidden");

  const openAside = () => {
    if (!aside) return;
    hide(toggleBtn);
    show(closeBtn);
    aside.classList.remove("-translate-x-full");
    createIcons({ icons });
  };

  const closeAside = () => {
    if (!aside) return;
    const finalize = () => {
      hide(closeBtn);
      show(toggleBtn);
      aside.removeEventListener("transitionend", onEnd);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === aside && e.propertyName === "transform") finalize();
    };
    aside.addEventListener("transitionend", onEnd);
    aside.classList.add("-translate-x-full");
    window.setTimeout(finalize, 500);
  };

  toggleBtn?.addEventListener("click", openAside);
  closeBtn?.addEventListener("click", closeAside);

  createIcons({ icons });
});

const initializeSelect = async (
  selectId: string,
  settingsKey: string,
  defaultValue: string,
  onChangeCallback: Function | null = null,
) => {
  const selectElement = document.getElementById(selectId) as HTMLSelectElement;

  if (!selectElement) {
    console.error(`Select element with id "${selectId}" not found.`);
    return;
  }

  const savedValue = (await settingsAPI.getItem(settingsKey)) || defaultValue;
  selectElement.value = savedValue;

  selectElement.addEventListener("change", async () => {
    await settingsAPI.setItem(settingsKey, selectElement.value);
    if (onChangeCallback) {
      await onChangeCallback();
    }
    location.reload();
  });
};

const initSwitch = async (
  switchId: string,
  settingsKey: string,
  onChangeCallback: Function | null = null,
  defaultValue: boolean = false,
) => {
  const switchElement = document.getElementById(switchId) as HTMLInputElement;

  if (!switchElement) {
    console.error(`Switch element with id "${switchId}" not found.`);
    return;
  }

  const savedValue = await settingsAPI.getItem(settingsKey);
  if (savedValue === null || savedValue === undefined) {
    switchElement.checked = defaultValue;
    await settingsAPI.setItem(settingsKey, defaultValue.toString());
  } else {
    switchElement.checked = savedValue === "true";
  }

  switchElement.addEventListener("change", async () => {
    await settingsAPI.setItem(settingsKey, switchElement.checked.toString());
    if (onChangeCallback) {
      await onChangeCallback();
    }
  });
};

const initButton = (buttonId: string, action: () => void) => {
  const buttonElement = document.getElementById(buttonId) as HTMLButtonElement;

  if (!buttonElement) {
    console.error(`Button element with id "${buttonId}" not found.`);
    return;
  }

  buttonElement.addEventListener("click", action);
};

async function isNightPlusActive(): Promise<boolean> {
  try {
    return await checkNightPlusStatus();
  } catch (error) {
    console.error("Error checking Night+ status:", error);
    return false;
  }
}

async function initializeWispSelect() {
  const wispSelect = document.getElementById("wispSelect") as HTMLSelectElement;
  const useCustomBtn = document.getElementById(
    "useCustomWisp",
  ) as HTMLButtonElement;
  const customInput = document.getElementById("wispCustomInput") as HTMLElement;
  const customSetting = document.getElementById(
    "wispCustomSetting",
  ) as HTMLInputElement;
  const saveCustomBtn = document.getElementById(
    "saveWispSetting",
  ) as HTMLButtonElement;
  const cancelCustomBtn = document.getElementById(
    "cancelWispCustom",
  ) as HTMLButtonElement;
  const nightPlusNotice = document.getElementById(
    "nightPlusWispNotice",
  ) as HTMLElement;
  const proxyRoutingToggle = document.getElementById(
    "proxyRoutingToggle",
  ) as HTMLInputElement;
  const proxyRoutingNotice = document.getElementById(
    "proxyRoutingNotice",
  ) as HTMLElement;

  if (!wispSelect) {
    console.error("WISP select element not found");
    return;
  }

  const generateBtn = document.getElementById(
    "generateWisp",
  ) as HTMLButtonElement;

  const defaultWispUrl =
    (location.protocol === "https:" ? "wss" : "ws") +
    "://" +
    location.host +
    "/wisp/";

  const authenticated = await isAuthenticated();
  const hasNightPlus = authenticated ? await isNightPlusActive() : false;

  wispSelect.innerHTML = '<option value="auto">Automatic (Default)</option>';

  const freeServers = [{ name: "Default Server", url: defaultWispUrl }];

  freeServers.forEach((server) => {
    const option = document.createElement("option");
    option.value = server.url;
    option.textContent = server.name;
    wispSelect.appendChild(option);
  });

  if (authenticated) {
    const vpnOptgroup = document.createElement("optgroup");
    vpnOptgroup.label = "🔒 VPN Servers (Night+)";

    const vpnServers = [
      { name: "Germany (Mullvad)", path: "germany" },
      { name: "Japan (Mullvad)", path: "japan" },
      { name: "Mexico (Mullvad)", path: "mexico" },
      { name: "Switzerland (Mullvad)", path: "switzerland" },
      { name: "United Kingdom (Mullvad)", path: "uk" },
      { name: "US East", path: "useast" },
      { name: "Canada East", path: "caeast" },
      { name: "US West", path: "uswest" },
    ];

    vpnServers.forEach((server) => {
      const option = document.createElement("option");
      option.value = `wss://demoplussrv.night-x.com/api/servers/${server.path}/`;
      option.textContent = server.name;
      vpnOptgroup.appendChild(option);
    });

    wispSelect.appendChild(vpnOptgroup);
  }

  if (hasNightPlus) {
    try {
      const premiumServers = await getPremiumWispServers();

      if (premiumServers.length > 0) {
      }

      if (nightPlusNotice) {
        nightPlusNotice.classList.add("hidden");
      }

      if (proxyRoutingNotice) {
        proxyRoutingNotice.classList.add("hidden");
      }

      if (proxyRoutingToggle) {
        proxyRoutingToggle.disabled = false;
      }
    } catch (error) {
      console.error("Failed to fetch premium WISP servers:", error);
    }
    if (proxyRoutingNotice) {
      proxyRoutingNotice.classList.remove("hidden");
    }
  } else {
    if (nightPlusNotice) {
      nightPlusNotice.classList.remove("hidden");
    }
  }

  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom WISP Server";
  wispSelect.appendChild(customOption);

  const generatedOption = document.createElement("option");
  generatedOption.value = "";
  generatedOption.textContent = "Generated Server";
  generatedOption.classList.add("hidden");
  wispSelect.appendChild(generatedOption);

  const savedWisp = (await settingsAPI.getItem("wisp")) || "auto";

  const isGeneratedWisp =
    typeof savedWisp === "string" &&
    savedWisp.includes(".nightwisp.me.cdn.cloudflare.net/wisp/");
  const isCustomWisp =
    savedWisp !== "auto" &&
    !isGeneratedWisp &&
    !Array.from(wispSelect.options).some((opt) => opt.value === savedWisp);

  if (isGeneratedWisp) {
    generatedOption.value = savedWisp;
    generatedOption.classList.remove("hidden");
    wispSelect.value = savedWisp;
  } else if (isCustomWisp) {
    wispSelect.value = "custom";
    if (customSetting) {
      customSetting.value = savedWisp;
    }
  } else {
    wispSelect.value = savedWisp;
  }

  wispSelect.addEventListener("change", async () => {
    if (wispSelect.value === "custom") {
      if (customInput) {
        customInput.classList.remove("hidden");
      }
      if (useCustomBtn) {
        useCustomBtn.classList.add("hidden");
      }
      if (generateBtn) {
        generateBtn.classList.add("hidden");
      }
    } else {
      if (customInput) {
        customInput.classList.add("hidden");
      }
      if (useCustomBtn) {
        useCustomBtn.classList.remove("hidden");
      }
      if (generateBtn) {
        generateBtn.classList.remove("hidden");
      }

      if (wispSelect.value === "auto") {
        await settingsAPI.removeItem("wisp");
      } else {
        await settingsAPI.setItem("wisp", wispSelect.value);
      }
      location.reload();
    }
  });

  if (useCustomBtn) {
    useCustomBtn.addEventListener("click", () => {
      wispSelect.value = "custom";
      if (customInput) {
        customInput.classList.remove("hidden");
      }
      useCustomBtn.classList.add("hidden");
      if (generateBtn) {
        generateBtn.classList.add("hidden");
      }
    });
  }

  if (saveCustomBtn) {
    saveCustomBtn.addEventListener("click", async () => {
      if (customSetting && customSetting.value.trim()) {
        await settingsAPI.setItem("wisp", customSetting.value.trim());
        console.log("Custom WISP server saved:", customSetting.value.trim());
        location.reload();
      }
    });
  }

  if (cancelCustomBtn) {
    cancelCustomBtn.addEventListener("click", () => {
      const isCustomWisp =
        savedWisp !== "auto" &&
        !Array.from(wispSelect.options).some((opt) => opt.value === savedWisp);
      wispSelect.value = isCustomWisp ? "auto" : savedWisp;
      if (customInput) {
        customInput.classList.add("hidden");
      }
      if (useCustomBtn) {
        useCustomBtn.classList.remove("hidden");
      }
      if (generateBtn) {
        generateBtn.classList.remove("hidden");
      }
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener("click", async () => {
      const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
      const length = 16 + Math.floor(Math.random() * 17);
      let subdomain = "";
      for (let i = 0; i < length; i++) {
        subdomain += chars[Math.floor(Math.random() * chars.length)];
      }
      const newWisp = `wss://${subdomain}.nightwisp.me.cdn.cloudflare.net/wisp/`;

      await settingsAPI.setItem("wisp", newWisp);
      console.log("Generated WISP server:", newWisp);

      generatedOption.value = newWisp;
      generatedOption.classList.remove("hidden");
      wispSelect.value = newWisp;

      if (customInput) {
        customInput.classList.add("hidden");
      }
      if (useCustomBtn) {
        useCustomBtn.classList.remove("hidden");
      }

      try {
        const parentProxy = (window.parent as any).proxy;
        if (parentProxy && typeof parentProxy.swapWispServer === "function") {
          await parentProxy.swapWispServer(newWisp);
        }
      } catch (e) {
        console.error("Failed to update parent proxy transports:", e);
        location.reload();
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".settingItem").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();

      document.querySelectorAll(".settingItem").forEach((item) => {
        item.classList.remove("bg-[var(--white-05)]");
      });

      link.classList.add("bg-[var(--white-05)]");

      const href = link.getAttribute("href");
      if (href) {
        const targetId = href.replace(/^#\/?/, "");
        const element = document.getElementById(targetId);
        if (element) {
          element.scrollIntoView({
            behavior: "smooth",
            block: "start",
            inline: "nearest",
          });
        }
      }
    });
  });

  const observerOptions = {
    root: null,
    rootMargin: "-20% 0px -70% 0px",
    threshold: 0,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        document.querySelectorAll(".settingItem").forEach((item) => {
          item.classList.remove("bg-[var(--white-05)]");
        });

        const activeLink = document.querySelector(
          `.settingItem[href="#${entry.target.id}"]`,
        );
        if (activeLink) {
          activeLink.classList.add("bg-[var(--white-05)]");
        }
      }
    });
  }, observerOptions);

  document.querySelectorAll("section[id]").forEach((section) => {
    observer.observe(section);
  });

  const firstLink = document.querySelector(".settingItem");
  if (firstLink) {
    firstLink.classList.add("bg-[var(--white-05)]");
  }

  await initializeSelect("URL-cloakSelect", "URL_Cloak", "a:b");

  await initSwitch("autoCloakSwitch", "autoCloak", () => {
    eventsAPI.emit("cloaking:auto-toggle", null);
  });

  await initSwitch(
    "disableTabCloseSwitch",
    "disableTabClose",
    async () => {
      const isEnabled = await settingsAPI.getItem("disableTabClose");
      if (isEnabled === "true") {
        window.addEventListener("beforeunload", (e) => {
          e.preventDefault();
          e.returnValue = "";
        });
      }
    },
    true,
  );

  await initializeTabCloakSystem();

  await initializeSelect("UIStyleSelect", "UIStyle", "operagx", () => {
    eventsAPI.emit("UI:changeStyle", null);
    eventsAPI.emit("theme:template-change", null);
    setTimeout(() => {
      eventsAPI.emit("UI:changeStyle", null);
      eventsAPI.emit("theme:template-change", null);
    }, 100);
  });

  const colorPicker = new (iro as any).ColorPicker(".colorPicker", {
    width: 280,
    color: (await settingsAPI.getItem("themeColor")) || "rgba(141, 1, 255, 1)",
    borderWidth: 1,
    borderColor: "#fff",
    layout: [
      {
        component: iro.ui.Box,
      },
      {
        component: iro.ui.Slider,
        options: {
          id: "hue-slider",
          sliderType: "hue",
        },
      },
    ],
  });

  const COLOR_TARGETS: Record<
    string,
    { property: string; aliases?: string[] }
  > = {
    accent: { property: "main-color", aliases: ["main"] },
    background: { property: "background-color", aliases: ["bg-2"] },
    panel: { property: "input-background-color", aliases: ["bg-1"] },
    text: { property: "text-color", aliases: ["text"] },
    border: { property: "border-color" },
  };

  let activeColorTarget = "accent";

  const colorTargetTabs = document.getElementById("colorTargetTabs");
  const accentColorPalette = document.getElementById("accentColorPalette");

  if (colorTargetTabs) {
    colorTargetTabs.querySelectorAll(".color-target-tab").forEach((tab) => {
      tab.addEventListener("click", async () => {
        const target = (tab as HTMLElement).dataset.target;
        if (!target || target === activeColorTarget) return;

        activeColorTarget = target;

        colorTargetTabs
          .querySelectorAll(".color-target-tab")
          .forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        if (accentColorPalette) {
          accentColorPalette.style.display =
            target === "accent" ? "block" : "none";
        }

        const currentColor = await getColorForTarget(target);
        if (currentColor) {
          try {
            colorPicker.color.set(currentColor);
          } catch (e) {
            console.warn("Could not set picker to target color:", e);
          }
        }
      });
    });
  }

  async function getColorForTarget(target: string): Promise<string | null> {
    const targetInfo = COLOR_TARGETS[target];
    if (!targetInfo) return null;

    try {
      const stored = await settingsAPI.getItem("customThemeColors");
      const customColors = stored ? JSON.parse(stored) : {};
      if (customColors[targetInfo.property]) {
        return customColors[targetInfo.property];
      }
    } catch {}

    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(`--${targetInfo.property}`)
      .trim();
    return value || null;
  }

  const hexInput = document.getElementById("hexInput") as HTMLInputElement;
  const rgbInput = document.getElementById("rgbString") as HTMLInputElement;
  const hslInput = document.getElementById("hslString") as HTMLInputElement;

  colorPicker.on(["color:init", "color:change"], (color: any) => {
    hexInput.value = color.hexString;
    rgbInput.value = color.rgbString;
    hslInput.value = color.hslString;
  });

  hexInput.addEventListener("change", (_e: Event) => {
    colorPicker.color.hexString = hexInput.value;
    rgbInput.value = colorPicker.color.rgbString;
    hslInput.value = colorPicker.color.hslString;

    emitColorForTarget(colorPicker.color.rgbaString);
  });

  rgbInput.addEventListener("change", (_e: Event) => {
    colorPicker.color.rgbString = rgbInput.value;
    hexInput.value = colorPicker.color.hexString;
    hslInput.value = colorPicker.color.hslString;

    emitColorForTarget(colorPicker.color.rgbaString);
  });

  hslInput.addEventListener("change", (_e: Event) => {
    colorPicker.color.hslString = hslInput.value;
    hexInput.value = colorPicker.color.hexString;
    rgbInput.value = colorPicker.color.rgbString;

    emitColorForTarget(colorPicker.color.rgbaString);
  });

  colorPicker.on("input:end", (color: any) => {
    emitColorForTarget(color.rgbaString);
    console.log(
      "Custom color changed to:",
      color.rgbaString,
      "target:",
      activeColorTarget,
    );
  });

  function emitColorForTarget(color: string) {
    if (activeColorTarget === "accent") {
      eventsAPI.emit("theme:color-change", { color });
    } else {
      const targetInfo = COLOR_TARGETS[activeColorTarget];
      if (targetInfo) {
        eventsAPI.emit("theme:property-change", {
          property: targetInfo.property,
          aliases: targetInfo.aliases,
          color,
          target: activeColorTarget,
        });
      }
    }
  }

  await initializeThemeSystem();

  async function initializeTabCloakSystem() {
    try {
      console.log("Initializing tab cloak system...");

      const response = await fetch(resolvePath("json/c.json"));
      const data = await response.json();
      const presets = data.presets;

      const tabCloakSelect = document.getElementById(
        "tabCloakSelect",
      ) as HTMLSelectElement;
      const customTabCloakOptions = document.getElementById(
        "customTabCloakOptions",
      ) as HTMLElement;
      const customTabTitle = document.getElementById(
        "customTabTitle",
      ) as HTMLInputElement;
      const customTabFavicon = document.getElementById(
        "customTabFavicon",
      ) as HTMLInputElement;
      const uploadFaviconBtn = document.getElementById(
        "uploadFaviconBtn",
      ) as HTMLButtonElement;
      const faviconUpload = document.getElementById(
        "faviconUpload",
      ) as HTMLInputElement;
      const faviconPreviewImg = document.getElementById(
        "faviconPreviewImg",
      ) as HTMLImageElement;
      const titlePreview = document.getElementById(
        "titlePreview",
      ) as HTMLElement;

      if (!tabCloakSelect) {
        console.error("Tab cloak select element not found");
        return;
      }

      tabCloakSelect.innerHTML = "";
      presets.forEach((preset: any) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.name;
        tabCloakSelect.appendChild(option);
      });

      const currentTabCloak = (await settingsAPI.getItem("tabCloak")) || "off";
      tabCloakSelect.value = currentTabCloak;

      const savedCustomTitle =
        (await settingsAPI.getItem("customTabTitle")) || "";
      const savedCustomFavicon =
        (await settingsAPI.getItem("customTabFavicon")) || "";
      if (customTabTitle) customTabTitle.value = savedCustomTitle;
      if (customTabFavicon) customTabFavicon.value = savedCustomFavicon;

      const toggleCustomOptions = () => {
        if (tabCloakSelect.value === "custom") {
          customTabCloakOptions?.classList.remove("hidden");
        } else {
          customTabCloakOptions?.classList.add("hidden");
        }
      };
      toggleCustomOptions();

      const applyTabCloak = async () => {
        const selectedPreset = presets.find(
          (p: any) => p.id === tabCloakSelect.value,
        );

        if (!selectedPreset) return;

        let title = selectedPreset.title;
        let favicon = selectedPreset.favicon;

        if (tabCloakSelect.value === "custom") {
          title = customTabTitle?.value || title;
          favicon = customTabFavicon?.value || favicon;
        }

        if (title) {
          document.title = title;
        }
        if (favicon) {
          let link = document.querySelector(
            "link[rel~='icon']",
          ) as HTMLLinkElement;
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.href = favicon;
        }

        if (titlePreview) {
          titlePreview.textContent = title;
        }
        if (faviconPreviewImg && favicon) {
          faviconPreviewImg.src = favicon;
          faviconPreviewImg.classList.remove("hidden");
          faviconPreviewImg.previousElementSibling?.classList.add("hidden");
        }

        await settingsAPI.setItem("tabCloakTitle", title);
        await settingsAPI.setItem("tabCloakFavicon", favicon);
      };

      tabCloakSelect.addEventListener("change", async () => {
        await settingsAPI.setItem("tabCloak", tabCloakSelect.value);
        toggleCustomOptions();
        await applyTabCloak();
        eventsAPI.emit("tabCloak:change", null);
      });

      customTabTitle?.addEventListener("input", async () => {
        await settingsAPI.setItem("customTabTitle", customTabTitle.value);
        await applyTabCloak();
        eventsAPI.emit("tabCloak:change", null);
      });

      customTabFavicon?.addEventListener("input", async () => {
        await settingsAPI.setItem("customTabFavicon", customTabFavicon.value);
        await applyTabCloak();
        eventsAPI.emit("tabCloak:change", null);
      });

      uploadFaviconBtn?.addEventListener("click", () => {
        faviconUpload?.click();
      });

      faviconUpload?.addEventListener("change", async (event: any) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
          const dataUrl = e.target?.result as string;
          if (customTabFavicon) {
            customTabFavicon.value = dataUrl;
          }
          await settingsAPI.setItem("customTabFavicon", dataUrl);
          await applyTabCloak();
          eventsAPI.emit("tabCloak:change", null);
        };
        reader.readAsDataURL(file);
      });

      await applyTabCloak();

      console.log("Tab cloak system initialized successfully");
    } catch (error) {
      console.error("Error initializing tab cloak system:", error);
    }
  }

  async function initializeThemeSystem() {
    try {
      console.log("Initializing theme system...");

      const themes = await themeManager.loadThemes();
      console.log("Loaded themes:", Object.keys(themes));

      const themePresetGrid = document.getElementById(
        "themePresetGrid",
      ) as HTMLElement;
      const accentColorGrid = document.getElementById("accentColorGrid");
      const customColorSection = document.getElementById("customColorSection");

      if (!themePresetGrid) {
        console.error("Theme preset grid element not found");
        return;
      }

      let currentTheme =
        (await settingsAPI.getItem("currentTheme")) || "daydreamer";

      if (!themes[currentTheme]) {
        console.warn(
          `Theme '${currentTheme}' not found in loaded themes, falling back to first available theme`,
        );
        const availableThemes = Object.keys(themes);
        currentTheme =
          availableThemes.length > 0 ? availableThemes[0] : "custom";
      }

      themeManager.setCurrentTheme(currentTheme);

      if (!(await settingsAPI.getItem("currentTheme"))) {
        await settingsAPI.setItem("currentTheme", currentTheme);
        eventsAPI.emit("theme:preset-change", { theme: currentTheme });
      }

      eventsAPI.addEventListener("theme:global-update", async (event: any) => {
        if (!event.detail) {
          console.warn(
            "Received theme:global-update event without detail:",
            event,
          );
          return;
        }

        const { type, theme, color, colorRole, target } = event.detail;

        console.log(
          "Settings page received global theme update:",
          event.detail,
        );

        if (type === "preset" && theme) {
          currentTheme = theme;
          themeManager.setCurrentTheme(theme);
          await settingsAPI.setItem("currentTheme", theme);

          updateThemeButtonStates(theme);
          updateAccentColors(theme);
          updateCustomColorVisibility(theme);
          resetColorTargetTabs();
        }

        if ((type === "color" || type === "accent") && color) {
          try {
            colorPicker.color.set(color);
          } catch (e) {
            console.warn("Could not update color picker:", e);
          }
        }

        if (type === "colorRole" && colorRole) {
          updateColorRoleStates(colorRole);
        }

        if (type === "property" && color && target === activeColorTarget) {
          try {
            colorPicker.color.set(color);
          } catch (e) {
            console.warn("Could not update color picker:", e);
          }
        }
      });

      function updateThemeButtonStates(activeThemeKey: string) {
        if (themePresetGrid) {
          themePresetGrid
            .querySelectorAll(".theme-preset-button")
            .forEach((btn) => {
              btn.classList.remove("active");
            });

          const activeButton = Array.from(themePresetGrid.children).find(
            (_, index) => {
              return Object.keys(themes)[index] === activeThemeKey;
            },
          );

          if (activeButton) {
            activeButton.classList.add("active");
          }
        }
      }

      function updateColorRoleStates(selectedRole: string) {
        if (accentColorGrid) {
          accentColorGrid
            .querySelectorAll(".accent-color-button")
            .forEach((btn) => {
              btn.classList.remove("selected");
              if (btn.getAttribute("data-role") === selectedRole) {
                btn.classList.add("selected");
              }
            });
        }
      }

      if (themePresetGrid) {
        themePresetGrid.innerHTML = "";

        const themeEntries = Object.entries(themes);
        console.log(
          "Creating theme buttons for:",
          themeEntries.length,
          "themes",
        );

        if (themeEntries.length === 0) {
          console.error("No themes available to display");
          themePresetGrid.innerHTML = `
            <div class="text-red-500 text-sm p-4 border border-red-500 rounded">
              ⚠️ Error: No themes could be loaded. Please check your connection and refresh the page.
            </div>
          `;
          return;
        }

        themeEntries.forEach(([themeKey, theme]) => {
          try {
            const themeButton = themeManager.generateThemePreview(theme);

            if (currentTheme === themeKey) {
              themeButton.classList.add("active");
              console.log("Marked theme as active:", themeKey);
            }

            themeButton.addEventListener("click", async () => {
              console.log("Theme button clicked:", themeKey);
              currentTheme = themeKey;
              await settingsAPI.setItem("currentTheme", themeKey);
              themeManager.setCurrentTheme(themeKey);

              eventsAPI.emit("theme:preset-change", { theme: themeKey });

              updateThemeButtonStates(themeKey);
              updateAccentColors(themeKey);
              updateCustomColorVisibility(themeKey);
              resetColorTargetTabs();

              document.documentElement.classList.add("theme-preview-animation");
              setTimeout(() => {
                document.documentElement.classList.remove(
                  "theme-preview-animation",
                );
              }, 400);

              console.log("Theme changed to:", themeKey);
            });

            themePresetGrid.appendChild(themeButton);
          } catch (error) {
            console.error(
              `Failed to create theme button for ${themeKey}:`,
              error,
            );
          }
        });

        updateAccentColors(currentTheme);
        updateCustomColorVisibility(currentTheme);
      }

      function updateAccentColors(themeKey: string) {
        const colorRoles = themeManager.getThemeColorRoles(themeKey);

        if (accentColorGrid && Object.keys(colorRoles).length > 0) {
          accentColorGrid.innerHTML = "";

          Object.entries(colorRoles).forEach(([roleName, color]) => {
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
              accentColorGrid
                .querySelectorAll(".accent-color-button")
                .forEach((btn) => {
                  btn.classList.remove("selected");
                });
              button.classList.add("selected");

              eventsAPI.emit("theme:color-role-change", { roleName, color });

              console.log("Accent changed to:", roleName, color);
            });

            accentColorGrid.appendChild(button);
          });
        } else if (accentColorGrid) {
          const accentColors = themeManager.getThemeAccentColors(themeKey);
          accentColorGrid.innerHTML = "";

          accentColors.forEach((color) => {
            const button = themeManager.generateAccentColorButton(color);

            button.addEventListener("click", () => {
              accentColorGrid
                .querySelectorAll(".accent-color-button")
                .forEach((btn) => {
                  btn.classList.remove("selected");
                });
              button.classList.add("selected");

              eventsAPI.emit("theme:accent-change", { color });
            });

            accentColorGrid.appendChild(button);
          });
        }
      }

      function getContrastTextColor(backgroundColor: string): string {
        let hex = backgroundColor;

        if (backgroundColor.startsWith("rgb")) {
          const rgbMatch = backgroundColor.match(
            /rgba?\((\d+),\s*(\d+),\s*(\d+)/,
          );
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1]);
            const g = parseInt(rgbMatch[2]);
            const b = parseInt(rgbMatch[3]);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            return brightness > 128 ? "#000000" : "#ffffff";
          }
        }

        hex = hex.replace("#", "");

        if (hex.length === 3) {
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        } else if (hex.length !== 6) {
          return "#ffffff";
        }

        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        if (isNaN(r) || isNaN(g) || isNaN(b)) {
          return "#ffffff";
        }

        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? "#000000" : "#ffffff";
      }

      function updateCustomColorVisibility(themeKey: string) {
        if (customColorSection) {
          if (themeManager.isThemeCustomizable(themeKey)) {
            customColorSection.style.display = "block";
          } else {
            customColorSection.style.display = "none";
          }
        }
      }

      function resetColorTargetTabs() {
        activeColorTarget = "accent";
        if (colorTargetTabs) {
          colorTargetTabs
            .querySelectorAll(".color-target-tab")
            .forEach((t) => t.classList.remove("active"));
          const accentTab = colorTargetTabs.querySelector(
            '[data-target="accent"]',
          );
          if (accentTab) accentTab.classList.add("active");
        }
        if (accentColorPalette) {
          accentColorPalette.style.display = "block";
        }
      }
    } catch (error) {
      console.error("Failed to initialize theme system:", error);
    }
  }

  async function initializeNewtabSettings() {
    const newtabSelect = document.getElementById(
      "newtabSelect",
    ) as HTMLSelectElement;
    const newtabCustomInput = document.getElementById(
      "newtabCustomInput",
    ) as HTMLElement;
    const newtabCustomUrl = document.getElementById(
      "newtabCustomUrl",
    ) as HTMLInputElement;

    if (!newtabSelect) return;

    const savedPage = (await settingsAPI.getItem("newtabPage")) || "default";
    const savedUrl = (await settingsAPI.getItem("newtabCustomUrl")) || "";

    newtabSelect.value = savedPage;
    if (newtabCustomUrl) newtabCustomUrl.value = savedUrl;

    if (savedPage === "custom") {
      newtabCustomInput?.classList.remove("hidden");
    }

    newtabSelect.addEventListener("change", async () => {
      await settingsAPI.setItem("newtabPage", newtabSelect.value);

      if (newtabSelect.value === "custom") {
        newtabCustomInput?.classList.remove("hidden");
      } else {
        newtabCustomInput?.classList.add("hidden");
      }
    });

    newtabCustomUrl?.addEventListener("change", async () => {
      await settingsAPI.setItem("newtabCustomUrl", newtabCustomUrl.value);
    });
  }

  async function initializeHomeSettings() {
    const homeSelect = document.getElementById(
      "homeSelect",
    ) as HTMLSelectElement;
    const homeCustomInput = document.getElementById(
      "homeCustomInput",
    ) as HTMLElement;
    const homeCustomUrl = document.getElementById(
      "homeCustomUrl",
    ) as HTMLInputElement;

    if (!homeSelect) return;

    const savedHomePage = (await settingsAPI.getItem("homePage")) || "";
    const savedUrl = savedHomePage ? "custom" : "default";

    homeSelect.value = savedUrl;
    if (homeCustomUrl) homeCustomUrl.value = savedHomePage;

    if (savedUrl === "custom") {
      homeCustomInput?.classList.remove("hidden");
    }

    homeSelect.addEventListener("change", async () => {
      if (homeSelect.value === "custom") {
        homeCustomInput?.classList.remove("hidden");
      } else {
        homeCustomInput?.classList.add("hidden");
        await persistHomePage(
          "default",
          "",
          (homePage) => settingsAPI.setItem("homePage", homePage),
          (homePage) => window.protocols.updateHomeProtocol(homePage),
        );
      }
    });

    homeCustomUrl?.addEventListener("change", async () => {
      await persistHomePage(
        "custom",
        homeCustomUrl.value,
        (homePage) => settingsAPI.setItem("homePage", homePage),
        (homePage) => window.protocols.updateHomeProtocol(homePage),
      );
    });
  }

  async function initializeStartupSettings() {
    const startupSelect = document.getElementById(
      "startupSelect",
    ) as HTMLSelectElement;
    const startupCustomInput = document.getElementById(
      "startupCustomInput",
    ) as HTMLElement;
    const startupCustomUrl = document.getElementById(
      "startupCustomUrl",
    ) as HTMLInputElement;

    if (!startupSelect) return;

    const savedBehavior =
      (await settingsAPI.getItem("startupBehavior")) || "newtab";
    const savedUrl = (await settingsAPI.getItem("startupCustomUrl")) || "";

    startupSelect.value = savedBehavior;
    if (startupCustomUrl) startupCustomUrl.value = savedUrl;

    if (savedBehavior === "custom") {
      startupCustomInput?.classList.remove("hidden");
    }

    startupSelect.addEventListener("change", async () => {
      await settingsAPI.setItem("startupBehavior", startupSelect.value);

      if (startupSelect.value === "custom") {
        startupCustomInput?.classList.remove("hidden");
      } else {
        startupCustomInput?.classList.add("hidden");
      }
    });

    startupCustomUrl?.addEventListener("change", async () => {
      await settingsAPI.setItem("startupCustomUrl", startupCustomUrl.value);
    });
  }

  await initializeSelect("proxySelect", "proxy", "sj");
  await initializeSelect("transportSelect", "transports", "libcurl");
  await initializeSelect("devtools-select", "devtools", "chii");

  await initializeNewtabSettings();
  await initializeHomeSettings();
  await initializeStartupSettings();
  await initSwitch("searchSuggestionsToggle", "searchSuggestions", null, true);
  await initSwitch("newtabShortcutsToggle", "newtabShowShortcuts", null, true);

  await initializeWispSelect();

  async function initializeProxyServerSelect() {
    const proxyServerSelect = document.getElementById(
      "proxyServerSelect",
    ) as HTMLSelectElement;
    const useCustomBtn = document.getElementById(
      "useCustomProxyServer",
    ) as HTMLButtonElement;
    const customInput = document.getElementById(
      "proxyServerCustomInput",
    ) as HTMLElement;
    const customUrlInput = document.getElementById(
      "proxyServerCustomUrl",
    ) as HTMLInputElement;
    const saveCustomBtn = document.getElementById(
      "saveProxyServerCustom",
    ) as HTMLButtonElement;
    const cancelCustomBtn = document.getElementById(
      "cancelProxyServerCustom",
    ) as HTMLButtonElement;

    if (!proxyServerSelect) return;

    const authenticated = await isAuthenticated();

    if (authenticated) {
      try {
        const response = await window.parent.proxy.fetch(
          "https://api.mullvad.net/public/relays/wireguard/v1/",
        );
        const data = response.ok ? await response.json() : null;

        if (data.countries && Array.isArray(data.countries)) {
          const mullvadOptgroup = document.createElement("optgroup");
          mullvadOptgroup.label = "Mullvad Servers (Requires Night+ VPN)";

          data.countries.forEach((country: any) => {
            if (country.cities && Array.isArray(country.cities)) {
              country.cities.forEach((city: any) => {
                if (city.relays && Array.isArray(city.relays)) {
                  city.relays.forEach((relay: any) => {
                    const hostname = relay.hostname;
                    const parts = hostname.split("-");
                    if (parts.length >= 4) {
                      const nodeNumber = parts[parts.length - 1];
                      const baseHostname = parts.slice(0, -1).join("-");
                      const socksHostname = `${baseHostname}-socks5-${nodeNumber}`;
                      const socksUrl = `socks5h://${socksHostname}.relays.mullvad.net:1080`;

                      const option = document.createElement("option");
                      option.value = socksUrl;
                      option.textContent = `${country.name} - ${city.name} (${hostname})`;
                      mullvadOptgroup.appendChild(option);
                    }
                  });
                }
              });
            }
          });

          proxyServerSelect.appendChild(mullvadOptgroup);
        }
      } catch (error) {
        console.error("Failed to fetch Mullvad relays:", error);
      }
    }

    const savedProxyServer = (await settingsAPI.getItem("proxyServer")) || "";

    if (
      savedProxyServer &&
      !Array.from(proxyServerSelect.options).some(
        (opt) => opt.value === savedProxyServer,
      )
    ) {
      proxyServerSelect.value = "custom";
      if (customUrlInput) customUrlInput.value = savedProxyServer;
    } else {
      proxyServerSelect.value = savedProxyServer;
    }

    proxyServerSelect.addEventListener("change", async () => {
      if (proxyServerSelect.value === "custom") {
        customInput?.classList.remove("hidden");
        useCustomBtn.style.display = "none";
      } else {
        customInput?.classList.add("hidden");
        useCustomBtn.style.display = "block";
        await settingsAPI.setItem("proxyServer", proxyServerSelect.value);
        if (proxyServerSelect.value !== "") {
          location.reload();
        }
      }
    });

    useCustomBtn?.addEventListener("click", () => {
      proxyServerSelect.value = "custom";
      customInput?.classList.remove("hidden");
      useCustomBtn.style.display = "none";
    });

    saveCustomBtn?.addEventListener("click", async () => {
      const customValue = customUrlInput?.value.trim() || "";
      await settingsAPI.setItem("proxyServer", customValue);
      customInput?.classList.add("hidden");
      useCustomBtn.style.display = "block";

      const existingCustomOption = Array.from(proxyServerSelect.options).find(
        (opt) => opt.value === "custom",
      );
      if (!existingCustomOption) {
        const customOption = document.createElement("option");
        customOption.value = "custom";
        customOption.textContent = `Custom: ${customValue}`;
        proxyServerSelect.appendChild(customOption);
      }

      proxyServerSelect.value = "custom";
      location.reload();
    });

    cancelCustomBtn?.addEventListener("click", () => {
      customInput?.classList.add("hidden");
      useCustomBtn.style.display = "block";
      proxyServerSelect.value = savedProxyServer;
    });
  }

  await initializeProxyServerSelect();

  initButton("bgUpload", () => {
    const uploadBGInput = document.getElementById(
      "bgInput",
    ) as HTMLInputElement;
    uploadBGInput!.click();
  });

  initButton("bgRemove", async () => {
    await settingsAPI.removeItem("theme:user-background-image");
    eventsAPI.emit("theme:background-change", null);
  });
});

const uploadBGInput = document.getElementById("bgInput") as HTMLInputElement;

if (uploadBGInput) {
  uploadBGInput.addEventListener("change", function (event: any) {
    var file = event.target.files[0];
    var reader = new FileReader();
    reader.onload = async function (e) {
      var backgroundImage = e.target!.result;
      await settingsAPI.setItem(
        "theme:user-background-image",
        backgroundImage as string,
      );
      eventsAPI.emit("theme:background-change", null);
    };
    reader.readAsDataURL(file);
  });
}

const panicKeybindInput = document.getElementById(
  "panicKeybind",
) as HTMLInputElement;
const panicKey = panicKeybindInput?.getAttribute("data-key") || "panicKeybind";

const keybindManager = new KeybindManager(settingsAPI);
const searchEngineRegistry = new SearchEngineRegistry(settingsAPI);

document.addEventListener("DOMContentLoaded", async () => {
  if (panicKeybindInput) {
    const savedKeybind = (await settingsAPI.getItem(panicKey)) || "`";
    panicKeybindInput.value = savedKeybind;
    panicKeybindInput.addEventListener("change", async () => {
      await settingsAPI.setItem(panicKey, panicKeybindInput.value);
      console.log("Panic keybind changed to:", panicKeybindInput.value);
    });
  }

  await settingsAPI.removeItem("keybinds");
  await keybindManager.loadKeybinds();
});

export function initializeKeybindsUI() {
  const container = document.getElementById("keybinds-container");
  if (!container) return;

  KEYBIND_CATEGORIES.forEach((category) => {
    const categoryKeybinds = keybindManager.getKeybindsByCategory(
      category.name,
    );

    if (Object.keys(categoryKeybinds).length === 0) return;

    const categorySection = document.createElement("div");
    categorySection.className = "space-y-3";
    categorySection.innerHTML = `
      <h3 class="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
        <i data-lucide="${category.icon || "folder"}" class="h-4 w-4"></i>
        ${category.label}
      </h3>
      <div class="space-y-2" data-category="${category.name}"></div>
    `;

    const keybindsList = categorySection.querySelector(
      `[data-category="${category.name}"]`,
    );

    Object.entries(categoryKeybinds).forEach(([id, config]) => {
      const keybindRow = document.createElement("div");
      keybindRow.className =
        "bg-[var(--bg-1)] rounded-lg p-4 ring-1 ring-inset ring-[var(--white-08)] flex items-center justify-between gap-4";
      keybindRow.innerHTML = `
        <div class="flex-1">
          <div class="text-sm text-[var(--text)]">${config.description}</div>
        </div>
        <div class="flex items-center gap-2">
          <button
            data-keybind-id="${id}"
            class="keybind-display px-3 py-1.5 text-xs rounded-md bg-[var(--bg-2)] border border-[var(--white-10)] text-[var(--text)] hover:bg-[var(--white-05)] transition-colors font-mono"
          >
            ${keybindManager.formatKeybind(config)}
          </button>
          <button
            data-reset-keybind="${id}"
            class="p-1.5 text-xs rounded-md text-[var(--proto)] hover:text-[var(--text)] hover:bg-[var(--white-05)] transition-colors"
            title="Reset to default"
          >
            <i data-lucide="rotate-ccw" class="h-4 w-4"></i>
          </button>
        </div>
      `;

      keybindsList?.appendChild(keybindRow);
    });

    container.appendChild(categorySection);
  });

  createIcons({ icons });

  container.querySelectorAll(".keybind-display").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const keybindId = target.dataset.keybindId;
      if (keybindId) startKeybindCapture(keybindId, target);
    });
  });

  container.querySelectorAll("[data-reset-keybind]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const keybindId = target.dataset.resetKeybind;
      if (keybindId) {
        keybindManager.resetKeybind(keybindId);
        refreshKeybindsUI();
        window.opener?.postMessage({ type: "keybinds-updated" }, "*");
      }
    });
  });

  document
    .getElementById("reset-all-keybinds")
    ?.addEventListener("click", async () => {
      if (confirm("Are you sure you want to reset all keybinds to defaults?")) {
        keybindManager.resetAllKeybinds();
        refreshKeybindsUI();
        window.opener?.postMessage({ type: "keybinds-updated" }, "*");
      }
    });
}

function broadcastSearchEnginesUpdate() {
  window.opener?.postMessage({ type: "searchEngines-updated" }, "*");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validateEngineForm(
  name: string,
  bang: string,
  at: string,
  url: string,
  excludeId: string | null,
):
  | { ok: true; name: string; bang: string; at: string; url: string }
  | { ok: false; error: string } {
  const trimmedName = name.trim();
  const trimmedBang = bang.trim();
  const trimmedAt = at.trim();
  const trimmedUrl = url.trim();
  if (!trimmedName || trimmedName.length > 64) return { ok: false, error: "Name must be 1-64 characters." };
  if (!trimmedBang && !trimmedAt) return { ok: false, error: 'At least one of "bang" or "at" must be set.' };
  if (trimmedBang) {
    if (!/^[A-Za-z0-9._-]+$/.test(trimmedBang) || trimmedBang.length > 16)
      return { ok: false, error: "Bang must be 1-16 chars matching [A-Za-z0-9._-]." };
    const lowerBang = trimmedBang.toLowerCase();
    const bangClash = searchEngineRegistry.list().find((e) => e.bang.toLowerCase() === lowerBang && e.id !== excludeId);
    if (bangClash) return { ok: false, error: `Bang !${trimmedBang} is already used by "${bangClash.name}".` };
  }
  if (trimmedAt) {
    if (!/^[A-Za-z0-9._-]+$/.test(trimmedAt) || trimmedAt.length > 16)
      return { ok: false, error: "At must be 1-16 chars matching [A-Za-z0-9._-]." };
    const lowerAt = trimmedAt.toLowerCase();
    const atClash = searchEngineRegistry.list().find((e) => e.at?.toLowerCase() === lowerAt && e.id !== excludeId);
    if (atClash) return { ok: false, error: `At @${trimmedAt} is already used by "${atClash.name}".` };
  }
  const occurrences = (trimmedUrl.match(/%s/g) || []).length;
  if (occurrences !== 1) return { ok: false, error: 'URL template must contain "%s" exactly once.' };
  try {
    new URL(trimmedUrl.replace("%s", "test"));
  } catch {
    return { ok: false, error: "URL template is not a valid URL after %s substitution." };
  }
  return { ok: true, name: trimmedName, bang: trimmedBang, at: trimmedAt, url: trimmedUrl };
}

function renderSearchEnginesTable() {
  const table = document.getElementById("search-engines-table");
  if (!table) return;
  const engines = searchEngineRegistry.list();
  const defaultId = searchEngineRegistry.getDefault().id;

  table.innerHTML = engines
    .map((e) => searchEngineRowHtml(e, e.id === defaultId))
    .join("");

  table.querySelectorAll<HTMLInputElement>('input[name="se-default"]').forEach((radio) => {
    radio.addEventListener("change", async () => {
      if (radio.checked) {
        await searchEngineRegistry.setDefault(radio.value);
        broadcastSearchEnginesUpdate();
        renderSearchEnginesTable();
      }
    });
  });

  table.querySelectorAll<HTMLButtonElement>("[data-edit-engine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.editEngine!;
      startEditEngine(id);
    });
  });

  table.querySelectorAll<HTMLButtonElement>("[data-remove-engine]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.removeEngine!;
      const e = searchEngineRegistry.list().find((x) => x.id === id);
      if (!e) return;
      if (!confirm(`Remove search engine "${e.name}"?`)) return;
      await searchEngineRegistry.remove(id);
      broadcastSearchEnginesUpdate();
      renderSearchEnginesTable();
    });
  });

  table.querySelectorAll<HTMLButtonElement>("[data-save-engine]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.saveEngine!;
      const row = btn.closest("[data-engine-row]");
      if (!row) return;
      const rawName = (row.querySelector('[data-field="name"]') as HTMLInputElement).value;
      const rawBang = (row.querySelector('[data-field="bang"]') as HTMLInputElement).value;
      const rawAt = (row.querySelector('[data-field="at"]') as HTMLInputElement).value;
      const rawUrl = (row.querySelector('[data-field="url"]') as HTMLInputElement).value;
      const errEl = row.querySelector('[data-field="error"]') as HTMLDivElement;
      const result = validateEngineForm(rawName, rawBang, rawAt, rawUrl, id);
      if (!result.ok) {
        errEl.textContent = result.error;
        errEl.classList.remove("hidden");
        return;
      }
      await searchEngineRegistry.update(id, {
        name: result.name,
        bang: result.bang,
        at: result.at || undefined,
        urlTemplate: result.url,
      });
      broadcastSearchEnginesUpdate();
      renderSearchEnginesTable();
    });
  });

  table.querySelectorAll<HTMLButtonElement>("[data-cancel-engine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      renderSearchEnginesTable();
    });
  });
}

function searchEngineRowHtml(e: SearchEngine, isDefault: boolean): string {
  const prefixes: string[] = [];
  if (e.bang) prefixes.push(`!${e.bang}`);
  if (e.at) prefixes.push(`@${e.at}`);
  const prefixDisplay = prefixes.map(escapeHtml).join(' · ');
  return `
    <div class="flex items-center gap-3 bg-[var(--bg-2)] rounded-md px-3 py-2 border border-[var(--white-10)]" data-engine-row="${escapeHtml(e.id)}">
      <input type="radio" name="se-default" value="${escapeHtml(e.id)}" ${isDefault ? "checked" : ""}
        class="accent-[var(--main)]" />
      <div class="flex-1 min-w-0">
        <div class="text-sm text-[var(--text)] truncate">
          ${escapeHtml(e.name)}${e.builtIn ? ' <span class="text-[var(--proto)] text-xs">(default seed)</span>' : ""}
        </div>
        <div class="text-xs text-[var(--proto)] truncate">
          <span class="font-mono">${prefixDisplay}</span> · ${escapeHtml(e.urlTemplate)}
        </div>
      </div>
      <button data-edit-engine="${escapeHtml(e.id)}"
        class="px-2 py-1 text-xs rounded bg-[var(--bg-1)] text-[var(--text)] border border-[var(--white-10)] hover:bg-[var(--white-05)] transition-colors">
        Edit
      </button>
      <button data-remove-engine="${escapeHtml(e.id)}"
        class="px-2 py-1 text-xs rounded bg-[var(--bg-1)] text-[var(--text)] border border-[var(--white-10)] hover:bg-[var(--white-05)] transition-colors">
        Remove
      </button>
    </div>
  `;
}

function searchEngineEditRowHtml(e: SearchEngine): string {
  return `
    <div class="bg-[var(--bg-2)] rounded-md px-3 py-2 border border-[var(--main-35a)] space-y-2" data-engine-row="${escapeHtml(e.id)}">
      <input data-field="name" type="text" placeholder="Name" value="${escapeHtml(e.name)}"
        class="w-full rounded bg-[var(--bg-1)] border border-[var(--white-10)] px-2 py-1 text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--main)]" />
      <input data-field="bang" type="text" placeholder="Bang (without !) — optional" value="${escapeHtml(e.bang)}"
        class="w-full rounded bg-[var(--bg-1)] border border-[var(--white-10)] px-2 py-1 text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--main)]" />
      <input data-field="at" type="text" placeholder="At key (without @) — optional" value="${escapeHtml(e.at ?? '')}"
        class="w-full rounded bg-[var(--bg-1)] border border-[var(--white-10)] px-2 py-1 text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--main)]" />
      <input data-field="url" type="text" placeholder="URL template (must contain %s)" value="${escapeHtml(e.urlTemplate)}"
        class="w-full rounded bg-[var(--bg-1)] border border-[var(--white-10)] px-2 py-1 text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--main)]" />
      <div data-field="error" class="hidden text-xs text-red-400"></div>
      <div class="flex gap-2 justify-end">
        <button data-cancel-engine="${escapeHtml(e.id)}"
          class="px-3 py-1 text-xs rounded-md bg-[var(--bg-1)] text-[var(--text)] border border-[var(--white-10)] hover:bg-[var(--white-05)] transition-colors">
          Cancel
        </button>
        <button data-save-engine="${escapeHtml(e.id)}"
          class="px-3 py-1 text-xs rounded-md bg-[var(--main)] text-white hover:opacity-90 transition-opacity">
          Save
        </button>
      </div>
    </div>
  `;
}

function startEditEngine(id: string) {
  const e = searchEngineRegistry.list().find((x) => x.id === id);
  if (!e) return;
  const table = document.getElementById("search-engines-table");
  if (!table) return;
  const row = table.querySelector(`[data-engine-row="${CSS.escape(id)}"]`);
  if (!row) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = searchEngineEditRowHtml(e);
  const newRow = wrapper.firstElementChild!;
  row.replaceWith(newRow);

  newRow.querySelector("[data-cancel-engine]")?.addEventListener("click", () => {
    renderSearchEnginesTable();
  });
  newRow.querySelector("[data-save-engine]")?.addEventListener("click", async () => {
    const rawName = (newRow.querySelector('[data-field="name"]') as HTMLInputElement).value;
    const rawBang = (newRow.querySelector('[data-field="bang"]') as HTMLInputElement).value;
    const rawAt = (newRow.querySelector('[data-field="at"]') as HTMLInputElement).value;
    const rawUrl = (newRow.querySelector('[data-field="url"]') as HTMLInputElement).value;
    const errEl = newRow.querySelector('[data-field="error"]') as HTMLDivElement;
    const result = validateEngineForm(rawName, rawBang, rawAt, rawUrl, id);
    if (!result.ok) {
      errEl.textContent = result.error;
      errEl.classList.remove("hidden");
      return;
    }
    await searchEngineRegistry.update(id, {
      name: result.name,
      bang: result.bang,
      at: result.at || undefined,
      urlTemplate: result.url,
    });
    broadcastSearchEnginesUpdate();
    renderSearchEnginesTable();
  });
}

export function initializeSearchEnginesAddForm() {
  const toggle = document.getElementById("search-engines-add-toggle");
  const form = document.getElementById("search-engines-add-form");
  const cancel = document.getElementById("search-engines-add-cancel");
  const save = document.getElementById("search-engines-add-save");
  const errEl = document.getElementById("search-engines-add-error") as HTMLDivElement | null;
  const nameEl = document.getElementById("search-engines-add-name") as HTMLInputElement | null;
  const bangEl = document.getElementById("search-engines-add-bang") as HTMLInputElement | null;
  const atEl = document.getElementById("search-engines-add-at") as HTMLInputElement | null;
  const urlEl = document.getElementById("search-engines-add-url") as HTMLInputElement | null;
  if (!toggle || !form || !cancel || !save || !errEl || !nameEl || !bangEl || !atEl || !urlEl) return;

  toggle.addEventListener("click", () => {
    form.classList.toggle("hidden");
  });
  cancel.addEventListener("click", () => {
    form.classList.add("hidden");
    nameEl.value = "";
    bangEl.value = "";
    atEl.value = "";
    urlEl.value = "";
    errEl.classList.add("hidden");
  });
  save.addEventListener("click", async () => {
    const result = validateEngineForm(nameEl.value, bangEl.value, atEl.value, urlEl.value, null);
    if (!result.ok) {
      errEl.textContent = result.error;
      errEl.classList.remove("hidden");
      return;
    }
    await searchEngineRegistry.add({
      name: result.name,
      bang: result.bang,
      at: result.at || undefined,
      urlTemplate: result.url,
    });
    broadcastSearchEnginesUpdate();
    form.classList.add("hidden");
    nameEl.value = "";
    bangEl.value = "";
    atEl.value = "";
    urlEl.value = "";
    errEl.classList.add("hidden");
    renderSearchEnginesTable();
  });
}

export function initializeSearchEnginesUI() {
  renderSearchEnginesTable();
  initializeSearchEnginesAddForm();
  document.getElementById("reset-search-engines")?.addEventListener("click", async () => {
    if (!confirm("Reset all search engines to defaults? This will remove any custom engines.")) return;
    await searchEngineRegistry.reset();
    broadcastSearchEnginesUpdate();
    renderSearchEnginesTable();
  });
}

export function initializeCommandsPanel() {
  const listEl = document.getElementById("commands-list") as HTMLDivElement | null;
  const filterEl = document.getElementById("commands-filter") as HTMLInputElement | null;
  if (!listEl || !filterEl) return;
  const w = window as unknown as { opener?: Window & { commands?: import("@apis/commands").CommandRegistry } };
  const registry = w.opener?.commands;
  if (!registry) {
    listEl.innerHTML = `<div class="text-xs text-[var(--proto)]">Command registry not available (main window closed).</div>`;
    return;
  }
  const render = (filter: string) => {
    const matches = filter.trim() ? registry.find(filter, 200) : registry.list();
    if (matches.length === 0) {
      listEl.innerHTML = `<div class="text-xs text-[var(--proto)]">No matching commands.</div>`;
      return;
    }
    const grouped: Record<string, typeof matches> = {};
    for (const cmd of matches) {
      if (!grouped[cmd.category]) grouped[cmd.category] = [];
      grouped[cmd.category].push(cmd);
    }
    listEl.innerHTML = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, cmds]) => `
        <div class="space-y-1">
          <div class="text-xs text-[var(--proto)] uppercase tracking-wide">${escapeHtml(category)}</div>
          ${cmds.map((cmd) => `
            <div class="flex items-center gap-3 bg-[var(--bg-2)] rounded-md px-3 py-2 border border-[var(--white-10)]">
              <div class="flex-1 min-w-0">
                <div class="text-sm text-[var(--text)] truncate">${escapeHtml(cmd.label)}</div>
                ${cmd.shortcut ? `<div class="text-xs text-[var(--proto)] font-mono">${escapeHtml(cmd.shortcut)}</div>` : ''}
              </div>
              <div class="text-xs text-[var(--proto)]">${escapeHtml(cmd.source)}</div>
            </div>
          `).join('')}
        </div>
      `)
      .join('');
  };
  render("");
  filterEl.addEventListener("input", () => render(filterEl.value));
}

function startKeybindCapture(keybindId: string, button: HTMLButtonElement) {
  button.textContent = "Press key...";
  button.classList.add("ring-2", "ring-[var(--main)]");

  const keyboardManager = (window as any).functions?.keyboardManager;
  if (keyboardManager) {
    keyboardManager.captureMode = true;
  }

  const originalKeybind = keybindManager.getAllKeybinds()[keybindId];

  const preventAll = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    preventAll(e);

    if (e.key === "Escape") {
      cleanup();
      return;
    }

    const modifierKeys = [
      "Control",
      "Alt",
      "Shift",
      "Meta",
      "AltGraph",
      "CapsLock",
      "Fn",
      "FnLock",
      "Hyper",
      "NumLock",
      "ScrollLock",
      "Super",
      "Symbol",
      "SymbolLock",
    ];
    if (modifierKeys.includes(e.key)) {
      return;
    }

    const newConfig = {
      ...originalKeybind,
      key: e.key,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      shift: e.shiftKey,
    };

    const conflicts = keybindManager.getConflicts(newConfig, keybindId);

    if (conflicts.length > 0) {
      const conflictKeybind = keybindManager.getAllKeybinds()[conflicts[0]];
      if (
        !confirm(
          `This keybind conflicts with "${conflictKeybind.description}". Override?`,
        )
      ) {
        cleanup();
        return;
      }
    }

    keybindManager.setKeybind(keybindId, newConfig);
    cleanup();
    refreshKeybindsUI();

    window.opener?.postMessage({ type: "keybinds-updated" }, "*");
  };

  const cleanup = () => {
    const keyboardManager = (window as any).functions?.keyboardManager;
    if (keyboardManager) {
      keyboardManager.captureMode = false;
    }
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("keyup", preventAll, true);
    window.removeEventListener("keypress", preventAll, true);
    document.removeEventListener("contextmenu", preventAll, true);
    button.classList.remove("ring-2", "ring-[var(--main)]");
    button.textContent = keybindManager.formatKeybind(originalKeybind);
  };

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", preventAll, true);
  window.addEventListener("keypress", preventAll, true);
  document.addEventListener("contextmenu", preventAll, true);
}

function refreshKeybindsUI() {
  const container = document.getElementById("keybinds-container");
  if (!container) return;
  container.innerHTML = "";
  initializeKeybindsUI();
}

document.addEventListener("DOMContentLoaded", async () => {
  await keybindManager.loadKeybinds();
  initializeKeybindsUI();
  await searchEngineRegistry.load();
  initializeSearchEnginesUI();
  initializeCommandsPanel();
});

import type {
  PermissionGrant,
  PermissionState,
  SitePermissionsStore,
} from "@apis/sitePermissions";

interface ParentSitePerms {
  sitePermissionsStore?: SitePermissionsStore;
}

const PERM_LABELS: Record<string, { icon: string; label: string }> = {
  geolocation: { icon: "map-pin", label: "Location" },
  notifications: { icon: "bell", label: "Notifications" },
  camera: { icon: "camera", label: "Camera" },
  microphone: { icon: "mic", label: "Microphone" },
  midi: { icon: "music-2", label: "MIDI devices" },
  "background-sync": { icon: "refresh-cw", label: "Background sync" },
  "persistent-storage": { icon: "database", label: "Persistent storage" },
  push: { icon: "send", label: "Push notifications" },
  "screen-wake-lock": { icon: "monitor", label: "Keep screen on" },
  "clipboard-read": { icon: "clipboard", label: "Read clipboard" },
  "clipboard-write": { icon: "clipboard-paste", label: "Write to clipboard" },
  "display-capture": { icon: "monitor-up", label: "Screen sharing" },
  "storage-access": { icon: "database", label: "Cross-site storage" },
  "system-wake-lock": { icon: "cpu", label: "Keep system awake" },
};
function permLabel(name: string): { icon: string; label: string } {
  return PERM_LABELS[name] ?? { icon: "shield", label: name };
}

class SitePermissionsUI {
  private store: SitePermissionsStore | null = null;
  private searchEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private clearAllEl: HTMLButtonElement | null = null;
  private query = "";

  async init(): Promise<void> {
    const parent = window.parent as unknown as ParentSitePerms;
    this.store = parent.sitePermissionsStore ?? null;
    this.searchEl = document.getElementById(
      "sp-search",
    ) as HTMLInputElement | null;
    this.listEl = document.getElementById("sp-sites-list");
    this.emptyEl = document.getElementById("sp-empty");
    this.clearAllEl = document.getElementById(
      "sp-clear-all",
    ) as HTMLButtonElement | null;

    if (!this.searchEl || !this.listEl || !this.emptyEl) return;

    this.searchEl.addEventListener("input", () => {
      this.query = (this.searchEl?.value ?? "").trim().toLowerCase();
      void this.render();
    });
    this.clearAllEl?.addEventListener("click", async () => {
      if (
        !confirm(
          "Clear ALL site permission grants? This affects every site you've granted or blocked permissions for.",
        )
      )
        return;
      try {
        await this.store?.clearAll();
        await this.render();
      } catch (err) {
        console.warn("[settings/sitePermissions] clearAll failed:", err);
      }
    });

    if (this.store) {
      this.store.addChangeListener(() => {
        void this.render();
      });
    }
    await this.render();
  }

  private async render(): Promise<void> {
    if (!this.listEl || !this.emptyEl) return;
    if (!this.store) {
      this.emptyEl.removeAttribute("hidden");
      this.listEl.innerHTML = "";
      return;
    }
    const all = await this.store.listAll();
    const byOrigin = new Map<string, PermissionGrant[]>();
    for (const g of all) {
      let arr = byOrigin.get(g.origin);
      if (!arr) {
        arr = [];
        byOrigin.set(g.origin, arr);
      }
      arr.push(g);
    }
    let origins = [...byOrigin.keys()];
    if (this.query) {
      origins = origins.filter((o) => o.toLowerCase().includes(this.query));
    }
    origins.sort();

    if (origins.length === 0) {
      this.emptyEl.removeAttribute("hidden");
      this.listEl.innerHTML = "";
      return;
    }
    this.emptyEl.setAttribute("hidden", "");
    this.listEl.innerHTML = "";

    for (const origin of origins) {
      this.listEl.appendChild(this.renderSiteCard(origin, byOrigin.get(origin)!));
    }

    createIcons({ icons });
  }

  private renderSiteCard(origin: string, grants: PermissionGrant[]): HTMLElement {
    const card = document.createElement("div");
    card.className =
      "bg-[var(--bg-1)] rounded-xl p-4 ring-1 ring-inset ring-[var(--white-08)] backdrop-blur";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between mb-3";
    const titleWrap = document.createElement("div");
    titleWrap.className = "flex items-center gap-2 min-w-0";
    const globe = document.createElement("i");
    globe.setAttribute("data-lucide", "globe");
    globe.className = "h-4 w-4 text-[var(--proto)] flex-shrink-0";
    titleWrap.appendChild(globe);
    const title = document.createElement("span");
    title.className =
      "text-sm font-medium text-[var(--text)] truncate";
    title.textContent = origin;
    title.title = origin;
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    const resetBtn = document.createElement("button");
    resetBtn.className =
      "text-xs text-[var(--proto)] hover:text-[var(--text)] inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--white-05)] transition-colors";
    const ri = document.createElement("i");
    ri.setAttribute("data-lucide", "x");
    ri.className = "h-3 w-3";
    resetBtn.appendChild(ri);
    const rspan = document.createElement("span");
    rspan.textContent = "Reset";
    resetBtn.appendChild(rspan);
    resetBtn.addEventListener("click", async () => {
      try {
        await this.store?.clearForOrigin(origin);
        await this.render();
      } catch (err) {
        console.warn("[settings/sitePermissions] reset failed:", err);
      }
    });
    header.appendChild(resetBtn);
    card.appendChild(header);

    const rows = document.createElement("div");
    rows.className = "space-y-2";
    for (const grant of grants.sort((a, b) => a.name.localeCompare(b.name))) {
      rows.appendChild(this.renderGrantRow(grant));
    }
    card.appendChild(rows);
    return card;
  }

  private renderGrantRow(grant: PermissionGrant): HTMLElement {
    const row = document.createElement("div");
    row.className = "flex items-center gap-3";

    const info = permLabel(grant.name);
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", info.icon);
    icon.className = "h-4 w-4 text-[var(--proto)]";
    row.appendChild(icon);

    const label = document.createElement("span");
    label.className = "flex-1 text-sm text-[var(--text)]";
    label.textContent = info.label;
    row.appendChild(label);

    const select = document.createElement("select");
    select.className =
      "rounded-md bg-[var(--bg-2)] border border-[var(--white-10)] text-[var(--text)] text-xs px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--main)]";
    const opts: PermissionState[] = ["granted", "denied", "prompt"];
    const labels: Record<PermissionState, string> = {
      granted: "Allow",
      denied: "Block",
      prompt: "Ask",
    };
    for (const o of opts) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = labels[o];
      if (o === grant.state) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
      try {
        await this.store?.setState(
          grant.origin,
          grant.name,
          select.value as PermissionState,
        );
      } catch (err) {
        console.warn("[settings/sitePermissions] setState failed:", err);
      }
    });
    row.appendChild(select);

    return row;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const ui = new SitePermissionsUI();
  void ui.init();
  (window as unknown as { sitePermissionsUI: SitePermissionsUI }).sitePermissionsUI = ui;
});
