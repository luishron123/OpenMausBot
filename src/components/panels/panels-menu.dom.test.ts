// @vitest-environment happy-dom
// Panels sits right above Automations in every menu that lists the tools (the sidebar's rows, the account menu's tools,
// the phone bar), and leaves all three while Settings → Features has it off.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { panelsEnabled } from "@/lib/feature-flags";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ config: {} as Record<string, unknown>, items: [] as Array<{ key: string }>, dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { config: fixture.config, activeView: "chat", pluginsOpen: false, bots: [{ id: "scout" }], routines: [], webhooks: [], routineRuns: [] },
    dispatch: fixture.dispatch,
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/web-panel-preferences", () => ({ useWebPanels: () => [] }));
vi.mock("@/lib/cloud-files", () => ({ useCloudFilesReady: () => false }));
vi.mock("../CloudRoomCard", () => ({ CloudRoomCard: () => null }));
vi.mock("../CloudUsageMeter", () => ({ CloudUsageCard: () => null }));
vi.mock("../UpdateIndicator", () => ({ UpdateIndicator: () => null }));
vi.mock("../SidebarPopoverMenu", () => ({ SidebarPopoverMenu: ({ items }: { items: Array<{ key: string }> }) => { fixture.items = items; return null; } }));

const { SidebarFooterNav } = await import("../SidebarFooterNav");
const { SidebarPhoneBar } = await import("../SidebarPhoneBar");
const { toolMenuItems } = await import("../SidebarProfileMenu");

beforeEach(() => {
  fixture.config = {};
  fixture.items = [];
  fixture.dispatch.mockReset();
  setLocale("en");
});

const sidebarPlaces = () => {
  const html = renderToStaticMarkup(createElement(SidebarFooterNav, { density: "comfortable", onToggleCollapsed: () => {} }));
  return [...html.matchAll(/data-sidebar-nav="([^"]+)"/g)].map((match) => match[1]);
};
const phoneTools = () => {
  renderToStaticMarkup(createElement(SidebarPhoneBar, { query: "", onQuery: () => {} }));
  return fixture.items.map((item) => item.key);
};
const right = (keys: string[]) => keys.indexOf("panels") >= 0 && keys.indexOf("panels") + 1 === keys.indexOf("automations");

describe("the Panels row", () => {
  it("is on until the place's config.json turns it off", () => {
    expect(panelsEnabled(null)).toBe(true);
    expect(panelsEnabled({ features: {} })).toBe(true);
    expect(panelsEnabled({ features: { panels: false } })).toBe(false);
  });

  it("sits directly above Automations in the sidebar's places and the phone bar's tools", () => {
    expect(right(sidebarPlaces())).toBe(true);
    expect(right(phoneTools())).toBe(true);
  });

  it("sits directly above Automations in the account menu's tools, lit while its page is open", () => {
    const items = toolMenuItems({ activeView: "panels", automationsNeedYou: false, onAutomations: () => {}, onTeamMap: () => {}, onPanels: () => {} });
    expect(items.map((item) => item.key).slice(0, 3)).toEqual(["panels", "automations", "team-map"]);
    expect(items[0]).toMatchObject({ label: "Panels", active: true });
    expect(toolMenuItems({ activeView: "chat", automationsNeedYou: false, onAutomations: () => {}, onTeamMap: () => {} }).map((item) => item.key)).not.toContain("panels");
  });

  it("opens the list of panels", () => {
    phoneTools();
    (fixture.items.find((item) => item.key === "panels") as unknown as { onSelect: () => void }).onSelect();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showPanels" });
  });

  it("leaves every menu while the switch is off", () => {
    fixture.config = { features: { panels: false } };
    expect(sidebarPlaces()).not.toContain("panels");
    expect(phoneTools()).not.toContain("panels");
    const source = readFileSync(join(process.cwd(), "src/components/SidebarProfileMenu.tsx"), "utf8");
    expect(source).toContain('onPanels: panels ? () => dispatch({ type: "showPanels" }) : undefined,');
    expect(source).toContain('panels = useFeature("panels")');
  });
});
