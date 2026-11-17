import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import { BOT_SECTIONS } from "../bot-settings/sections";
import { isSimplePage, PAGE_IDS, PAGES, PANEL_TABS, sectionTarget, SIMPLE_PAGES, TAB_LABEL } from "./page-registry";

describe("the bot panel's page registry", () => {
  it("has two tabs: Details and Library", () => {
    expect(PANEL_TABS).toEqual(["details", "library"]);
  });

  it("lands every settings section on a tab, and on a Simple page that lives on that tab", () => {
    for (const { id } of BOT_SECTIONS) {
      const target = sectionTarget(id);
      expect(PANEL_TABS).toContain(target.tab);
      if (target.page) {
        expect(isSimplePage(target.page), id).toBe(true);
        expect(PAGES[target.page].home, id).toBe(target.tab);
      }
    }
  });

  it.each([
    ["overview", { tab: "details" }], ["identity", { tab: "details" }],
    ["soul", { tab: "details", anchor: "instructions", editInstructions: true }],
    ["skills", { tab: "details", page: "skills" }], ["memory", { tab: "details", page: "memory" }], ["routines", { tab: "details", page: "routines" }],
    ["access", { tab: "details", page: "settings", anchor: "computer" }], ["model", { tab: "details", anchor: "model" }], ["permissions", { tab: "details", anchor: "approval" }],
    ["voice", { tab: "details" }], ["visibility", { tab: "details" }], ["history", { tab: "details" }], ["usage", { tab: "details" }], ["slack", { tab: "details" }],
  ] as const)("sends a %s link to %o", (section, target) => {
    expect(sectionTarget(section)).toEqual(target);
  });

  it("draws every Simple page on Details, with where it works reached from Bot settings", () => {
    expect(SIMPLE_PAGES).toEqual(["settings", "apps", "routines", "visibility", "memory", "skills", "folder", "browser", "where"]);
    const home = Object.fromEntries(SIMPLE_PAGES.map((page) => [page, PAGES[page].home]));
    expect(home).toEqual({
      settings: "details", apps: "details", routines: "details", visibility: "details",
      memory: "details", skills: "details", folder: "details",
      browser: "details", where: "details",
    });
    expect(SIMPLE_PAGES.filter((page) => PAGES[page].under)).toEqual(["browser", "where"]);
    expect([PAGES.browser.under, PAGES.where.under]).toEqual(["settings", "settings"]);
    expect(isSimplePage("mcp")).toBe(false);
  });

  it("names every page, its intro and every tab in English copy", () => {
    const keys = en as Record<string, string>;
    for (const id of PAGE_IDS) {
      expect(keys[PAGES[id].title], id).toBeTruthy();
      if (PAGES[id].intro) expect(keys[PAGES[id].intro], id).toBeTruthy();
    }
    for (const tab of PANEL_TABS) expect(keys[TAB_LABEL[tab]]).toBeTruthy();
    expect(PANEL_TABS.map((tab) => keys[TAB_LABEL[tab]])).toEqual(["Details", "Library"]);
    expect(keys[PAGES.settings.title]).toBe("Bot settings");
  });
});
