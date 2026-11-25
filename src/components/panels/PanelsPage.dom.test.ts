// @vitest-environment happy-dom
// The Panels page against a stand-in server: the list and its states, one panel with its automations, the card states,
// and Undo after a card or the panel is removed.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Panel, PanelAutomation, PanelCard } from "../../../shared/panels";
import { panelSummary } from "../../../shared/panels";
import { setLocale } from "@/lib/i18n";

type MenuItem = { key: string; label: string; checked?: boolean; onSelect: () => void };
const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { panelId: undefined as string | undefined, bots: [{ id: "scout", name: "Scout" }], groups: [], config: null },
  menus: new Map<string, MenuItem[]>(),
  frames: [] as Array<{ onFrame: (frame: { kind: string }) => void; onMissedFrames?: () => void }>,
}));
vi.mock("@/state/store-select", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store-select")>(),
  useStoreDispatch: () => fixture.dispatch,
  useStoreSelector: <T,>(selector: (state: typeof fixture.state) => T) => selector(fixture.state),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/live-events", () => ({
  listenLiveFrames: (listener: (typeof fixture.frames)[number]) => {
    fixture.frames.push(listener);
    return () => { fixture.frames.splice(fixture.frames.indexOf(listener), 1); };
  },
}));
vi.mock("../Avatar", () => ({ BotAvatar: () => createElement("span", { "data-avatar": "" }) }));
vi.mock("../SidebarPopoverMenu", () => ({
  SidebarPopoverMenu: ({ items, ariaLabel }: { items: MenuItem[]; ariaLabel: string }) => {
    fixture.menus.set(ariaLabel, items);
    return createElement("button", { type: "button", "aria-label": ariaLabel });
  },
}));
vi.mock("@/components/DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }), windowFramed: () => false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const widget = (text: string) => ({ type: "Card", id: "root", children: [{ type: "Text", id: "n1", value: text }] });
const card = (over: Partial<PanelCard>): PanelCard => ({
  id: "c1", title: "Orders today", size: "s", position: 0, botId: "scout", updatedAt: ago(12), status: "ok", widget: widget("42 orders"), ...over,
});
const automation = (over: Partial<PanelAutomation> = {}): PanelAutomation => ({
  routineId: "r1", name: "Morning numbers", botId: "scout", enabled: true, nextRunAt: new Date(NOW + 3_600_000).toISOString(), ...over,
});

let panels: Panel[];
let failList = false;
let hold = false;
const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let host: HTMLDivElement;
let root: Root;
let PanelsPage: typeof import("./PanelsPage").PanelsPage;
let REFRESH_POLL_MS: number;
let REFRESH_GIVE_UP_MS: number;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function server(path: string, method: string, body: Record<string, unknown> | undefined): Response {
  const parts = path.split("/").slice(3).map(decodeURIComponent);
  const find = (id: string | undefined) => panels.find((panel) => panel.id === id);
  if (parts.length === 0) return failList ? reply({ error: "down" }, 500) : reply({ panels: panels.map(panelSummary) });
  if (parts[0] === "restore") {
    panels.push(body!.panel as Panel);
    return reply({ panel: body!.panel });
  }
  const panel = find(parts[0]);
  if (!panel) return reply({ error: "No such panel" }, 404);
  if (parts.length === 1 && method === "GET") return reply({ panel });
  if (parts.length === 1 && method === "PATCH") { Object.assign(panel, body); return reply({ panel }); }
  if (parts.length === 1 && method === "DELETE") { panels = panels.filter((kept) => kept !== panel); return reply({ panel }); }
  if (parts[1] === "refresh") return reply({ ok: true }, 202);
  if (parts[2] === "restore") { panel.cards.push(body!.card as PanelCard); return reply({ panel }); }
  const target = panel.cards.find((item) => item.id === parts[2])!;
  if (method === "PATCH") { Object.assign(target, body); return reply({ panel }); }
  panel.cards = panel.cards.filter((item) => item !== target);
  return reply({ panel, card: target });
}

beforeEach(async () => {
  setLocale("en");
  vi.resetModules();
  fixture.dispatch.mockReset();
  fixture.state.panelId = undefined;
  fixture.menus.clear();
  fixture.frames.length = 0;
  failList = false;
  hold = false;
  calls.length = 0;
  panels = [
    {
      id: "p1", title: "Store health", about: "Sales and refunds at a glance.", createdBy: { botId: "scout", threadId: "t1" },
      createdAt: ago(600), updatedAt: ago(12), position: 0,
      cards: [
        card({}),
        card({ id: "c2", title: "Refunds", size: "m", position: 1, status: "failed", failure: "The store didn't answer.", failedAt: ago(3) }),
        card({ id: "c3", title: "Ad spend", size: "l", position: 2, widget: undefined }),
      ],
      automations: [automation({ lastRunUpdatedNothing: true })],
    },
    { id: "p2", title: "Empty board", createdBy: { botId: "gone" }, createdAt: ago(60), updatedAt: ago(90), position: 1, cards: [] },
  ];
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(input, "http://x").pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method, path, body });
    if (hold) return new Promise<Response>(() => {});
    return Promise.resolve(server(path, method, body));
  }));
  ({ PanelsPage } = await import("./PanelsPage"));
  ({ REFRESH_POLL_MS, REFRESH_GIVE_UP_MS } = await import("./PanelView"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = async () => { for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve(); }); };
const show = async () => { act(() => root.render(createElement(PanelsPage))); await settle(); };
const rerender = async () => { act(() => root.render(createElement(PanelsPage))); await settle(); };
const button = (name: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name);
const cardState = (id: string) => host.querySelector(`[data-panel-card="${id}"]`)?.getAttribute("data-panel-card-state");

describe("the list", () => {
  it("names each panel with its bot, card count, last update and a dot when a card failed, newest first", async () => {
    await show();
    expect(host.textContent).toContain("Cards your bots keep up to date.");
    const rows = [...host.querySelectorAll("[data-panel-row]")];
    expect(rows.map((row) => row.getAttribute("data-panel-row"))).toEqual(["p1", "p2"]);
    expect(rows[0]!.textContent).toContain("Scout");
    expect(rows[0]!.textContent).toContain("3 cards");
    expect(rows[0]!.textContent).toContain("Updated 12 min ago");
    expect(rows[0]!.querySelector("[data-panel-failed]")).not.toBeNull();
    expect(rows[1]!.textContent).toContain("0 cards");
    expect(rows[1]!.querySelector("[data-panel-failed]")).toBeNull();
    act(() => (rows[0] as HTMLButtonElement).click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showPanels", panelId: "p1" });
  });

  it("says what goes here when there are none, with one way to start", async () => {
    panels = [];
    await show();
    expect(host.querySelector("[data-panels-empty]")?.textContent).toContain("No panels yet.");
    act(() => button("Open a chat")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showChat" });
  });

  it("shows the rows' shape only once loading takes longer than 300 ms", async () => {
    vi.useFakeTimers();
    hold = true;
    act(() => root.render(createElement(PanelsPage)));
    expect(host.querySelector("[data-panels-skeleton]")).toBeNull();
    act(() => { vi.advanceTimersByTime(299); });
    expect(host.querySelector("[data-panels-skeleton]")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(host.querySelector("[data-panels-skeleton]")).not.toBeNull();
  });

  it("says so when the list can't load, and Try again reads it again", async () => {
    failList = true;
    await show();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load your panels.");
    failList = false;
    act(() => button("Try again")!.click());
    await settle();
    expect(host.querySelectorAll("[data-panel-row]")).toHaveLength(2);
  });

  it("reads the list again when the server says a panel changed", async () => {
    await show();
    panels[1]!.title = "Renamed elsewhere";
    act(() => fixture.frames.forEach((listener) => listener.onFrame({ kind: "panels.changed", panelId: "p2" } as { kind: string })));
    await settle();
    expect(host.textContent).toContain("Renamed elsewhere");
  });
});

describe("one panel", () => {
  beforeEach(() => { fixture.state.panelId = "p1"; });

  it("has its title, about, maker, last update and the automation that keeps it up to date", async () => {
    await show();
    expect(host.querySelector("h1")?.textContent).toBe("Store health");
    expect(host.textContent).toContain("Sales and refunds at a glance.");
    expect(host.textContent).toContain("Made by Scout");
    const line = host.querySelector('[data-panel-automation="r1"]')!;
    expect(line.textContent).toContain("Updated by the automation Morning numbers");
    expect(line.textContent).toMatch(/next (today|tomorrow)/);
    expect(line.textContent).toContain("The last run didn't update the panel");
    act(() => [...line.querySelectorAll("button")].find((item) => item.textContent === "Morning numbers")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showRoutines", view: "list", routineId: "r1" });
  });

  it("Refresh now runs that automation and says so until its run starts", async () => {
    await show();
    act(() => button("Refresh now")!.click());
    await settle();
    expect(calls.find((call) => call.method === "POST")).toEqual({ method: "POST", path: "/api/panels/p1/refresh", body: { routineId: "r1" } });
    expect(button("Updating…")?.disabled).toBe(true);
  });

  it("lets go of Updating… once a run that never showed as running has finished, and says it updated nothing", async () => {
    panels[0]!.automations = [automation({ lastRunAt: ago(60) })];
    await show();
    act(() => button("Refresh now")!.click());
    await settle();
    expect(button("Updating…")?.disabled).toBe(true);
    panels[0]!.automations = [automation({ lastRunAt: new Date().toISOString(), lastRunUpdatedNothing: true })];
    act(() => fixture.frames.forEach((listener) => listener.onFrame({ kind: "panels.changed", panelId: "p1" } as { kind: string })));
    await settle();
    expect(button("Refresh now")?.disabled).toBe(false);
    expect(host.querySelector('[data-panel-automation="r1"]')?.textContent).toContain("The last run didn't update the panel");
  });

  it("reads the panel again while it waits, so a finished run shows even when no change arrives", async () => {
    panels[0]!.automations = [automation({ lastRunAt: ago(60) })];
    await show();
    vi.useFakeTimers();
    act(() => button("Refresh now")!.click());
    await settle();
    panels[0]!.automations = [automation({ lastRunAt: new Date().toISOString(), lastRunUpdatedNothing: true })];
    const reads = calls.filter((call) => call.method === "GET" && call.path === "/api/panels/p1").length;
    act(() => { vi.advanceTimersByTime(REFRESH_POLL_MS); });
    await settle();
    expect(calls.filter((call) => call.method === "GET" && call.path === "/api/panels/p1").length).toBe(reads + 1);
    expect(button("Refresh now")?.disabled).toBe(false);
    expect(host.textContent).toContain("The last run didn't update the panel");
  });

  it("gives Refresh now back after two minutes when the run never shows up", async () => {
    await show();
    vi.useFakeTimers();
    act(() => button("Refresh now")!.click());
    await settle();
    act(() => { vi.advanceTimersByTime(REFRESH_GIVE_UP_MS - REFRESH_POLL_MS); });
    await settle();
    expect(button("Updating…")?.disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(REFRESH_POLL_MS); });
    await settle();
    expect(button("Refresh now")?.disabled).toBe(false);
  });

  it("says when an automation is paused", async () => {
    panels[0]!.automations = [automation({ enabled: false, nextRunAt: null })];
    await show();
    expect(host.querySelector('[data-panel-automation="r1"]')?.textContent).toContain("paused");
  });

  it("lays out cards by size and draws each one's state", async () => {
    await show();
    const span = (id: string) => host.querySelector(`[data-panel-card="${id}"]`)!.className;
    expect(span("c1")).not.toContain("col-span-2");
    expect(span("c2")).toContain("@xl:col-span-2");
    expect(span("c3")).toContain("@xl:row-span-2");
    expect([cardState("c1"), cardState("c2"), cardState("c3")]).toEqual(["ok", "failed", "waiting"]);
    const ok = host.querySelector('[data-panel-card="c1"]')!;
    expect(ok.textContent).toContain("42 orders");
    expect(ok.querySelector("footer")?.textContent).toBe("Scout·12 min ago");
    const failed = host.querySelector('[data-panel-card="c2"]')!;
    expect(failed.textContent).toContain("The store didn't answer.");
    expect(failed.textContent).toContain("42 orders");
    expect(failed.querySelector(".opacity-\\[0\\.55\\]")).not.toBeNull();
    expect(host.querySelector('[data-panel-card="c3"]')!.textContent).toContain("Waiting for the first update…");
  });

  it("marks every card updating while one of the panel's automations runs", async () => {
    panels[0]!.automations = [automation({ running: true })];
    await show();
    expect(cardState("c1")).toBe("updating");
    expect(host.querySelector('[data-panel-card="c1"]')!.getAttribute("aria-busy")).toBe("true");
    expect(cardState("c2")).toBe("failed");
  });

  it("changes a card's size and removes it with an Undo", async () => {
    await show();
    const menu = fixture.menus.get("More for Orders today")!;
    expect(menu.map((item) => [item.key, item.checked])).toEqual([["size-s", true], ["size-m", false], ["size-l", false], ["remove", undefined]]);
    act(() => menu.find((item) => item.key === "size-l")!.onSelect());
    await settle();
    expect(calls.find((call) => call.method === "PATCH")).toEqual({ method: "PATCH", path: "/api/panels/p1/cards/c1", body: { size: "l" } });
    expect(host.querySelector('[data-panel-card="c1"]')!.className).toContain("@xl:row-span-2");
    act(() => fixture.menus.get("More for Orders today")!.find((item) => item.key === "remove")!.onSelect());
    await settle();
    expect(host.querySelector('[data-panel-card="c1"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Removed Orders today.");
    act(() => button("Undo")!.click());
    await settle();
    expect(calls.some((call) => call.path === "/api/panels/p1/cards/restore")).toBe(true);
    expect(host.querySelector('[data-panel-card="c1"]')).not.toBeNull();
  });

  it("shows one line and one action when the panel has no cards", async () => {
    panels[0]!.cards = [];
    await show();
    expect(host.querySelector("[data-panel-empty]")?.textContent).toContain("No cards yet.");
    expect(button("Open the bot's conversation")).toBeDefined();
  });

  it("deletes the panel back to the list, where Undo puts it back", async () => {
    await show();
    act(() => fixture.menus.get("More for Store health")!.find((item) => item.key === "delete")!.onSelect());
    await settle();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showPanels" });
    fixture.state.panelId = undefined;
    await rerender();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Deleted Store health.");
    expect(host.querySelector('[data-panel-row="p1"]')).toBeNull();
    act(() => button("Undo")!.click());
    await settle();
    expect(calls.some((call) => call.path === "/api/panels/restore")).toBe(true);
    expect(host.querySelector('[data-panel-row="p1"]')).not.toBeNull();
  });

  it("goes back to the list when the panel is gone", async () => {
    fixture.state.panelId = "missing";
    await show();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showPanels" });
  });
});
