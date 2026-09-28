import { afterEach, describe, expect, it, vi } from "vitest";

const settings = {
  getItem: vi.fn(),
  setItem: vi.fn(),
};
const events = { emit: vi.fn() };
const protocols = { updateHomeProtocol: vi.fn() };

vi.mock("lucide", () => ({ createIcons: vi.fn(), icons: {} }));
vi.mock("@jaames/iro", () => ({ default: {} }));
vi.mock("../data/host", () => ({
  getEventsAPI: () => events,
  getSettingsAPI: () => settings,
  getHost: () => ({ protocols }),
  getTheming: vi.fn(),
}));

import { render } from "./appearance";
import { settingsSearch } from "../components/settingsSearch";

afterEach(() => {
  document.body.replaceChildren();
  settingsSearch.clearAll();
  settings.getItem.mockReset();
  settings.setItem.mockReset();
  events.emit.mockReset();
  protocols.updateHomeProtocol.mockReset();
});

describe("Appearance settings", () => {
  it("persists bookmarks-bar visibility before announcing its change", async () => {
    settings.getItem.mockResolvedValue("newtab");
    const order: string[] = [];
    settings.setItem.mockImplementation(async () => { order.push("write"); });
    events.emit.mockImplementation(() => { order.push("emit"); });
    const container = document.createElement("div");
    document.body.appendChild(container);

    await render(container, {});
    await Promise.resolve();
    const select = container.querySelector<HTMLSelectElement>("select[name='bookmarksBarVisibility']");

    expect(select).not.toBeNull();
    expect(select?.getAttribute("aria-label")).toBe("Bookmarks bar visibility");
    expect(Array.from(select!.options, (option) => option.text)).toEqual([
      "New tab only",
      "Always show",
      "Hidden",
    ]);
    expect(select!.value).toBe("newtab");
    settingsSearch.filter("visibility");
    expect(select!.closest(".settings-row")?.classList.contains("search-match")).toBe(true);

    select!.value = "always";
    select!.dispatchEvent(new Event("change"));
    await Promise.resolve();

    expect(settings.setItem).toHaveBeenCalledWith("bookmarksBarVisibility", "always");
    expect(events.emit).toHaveBeenCalledWith("bookmarks-bar:visibility-change", { visibility: "always", persisted: true });
    expect(order).toEqual(["write", "emit"]);
  });

  it("restores bookmarks-bar visibility and shows an inline failure notice when saving fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    settings.getItem.mockResolvedValue("newtab");
    settings.setItem.mockRejectedValue(new Error("storage unavailable"));
    const container = document.createElement("div");
    container.className = "settings-content";
    document.body.appendChild(container);

    await render(container, {});
    await Promise.resolve();
    const select = container.querySelector<HTMLSelectElement>("select[name='bookmarksBarVisibility']")!;
    select.value = "hidden";
    select.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();

    expect(select.value).toBe("newtab");
    expect(events.emit).not.toHaveBeenCalled();
    expect(container.querySelector(".ddx-inline-notice")?.textContent).toBe(
      "Failed to save bookmarks bar visibility.",
    );
  });

  it("updates the active home protocol after persisting the home page", async () => {
    settings.getItem.mockResolvedValue("");
    const calls: string[] = [];
    settings.setItem.mockImplementation(async () => { calls.push("persist"); });
    protocols.updateHomeProtocol.mockImplementation(async () => { calls.push("update"); });
    const container = document.createElement("div");
    document.body.appendChild(container);

    await render(container, {});
    await Promise.resolve();
    const input = container.querySelector<HTMLInputElement>("input[type='url']")!;
    input.value = "example.com/home";
    input.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.setItem).toHaveBeenCalledWith("homePage", "https://example.com/home");
    expect(protocols.updateHomeProtocol).toHaveBeenCalledWith("https://example.com/home");
    expect(calls).toEqual(["persist", "update"]);
  });

  it("normalizes a scheme-relative home page before persisting and updating the protocol", async () => {
    settings.getItem.mockResolvedValue("");
    settings.setItem.mockResolvedValue(undefined);
    protocols.updateHomeProtocol.mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);

    await render(container, {});
    await Promise.resolve();
    const input = container.querySelector<HTMLInputElement>("input[type='url']")!;
    input.value = "//example.com/home";
    input.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.setItem).toHaveBeenCalledWith("homePage", "https://example.com/home");
    expect(protocols.updateHomeProtocol).toHaveBeenCalledWith("https://example.com/home");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<h1>unsafe</h1>",
    "file:///etc/passwd",
    "about:blank",
    "ddx://settings",
  ])("rejects non-web home page %s without persisting or updating the protocol", async (value) => {
    settings.getItem.mockResolvedValue("");
    const container = document.createElement("div");
    document.body.appendChild(container);

    await render(container, {});
    await Promise.resolve();
    const input = container.querySelector<HTMLInputElement>("input[type='url']")!;
    input.value = value;
    input.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.setItem).not.toHaveBeenCalled();
    expect(protocols.updateHomeProtocol).not.toHaveBeenCalled();
  });
});
