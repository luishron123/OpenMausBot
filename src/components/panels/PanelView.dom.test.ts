// @vitest-environment happy-dom
// One panel against a stand-in server: who sees it and the line under its title, organizing its cards (size, remove,
// moving them by pointer and by keyboard), each card's footer, and New card with its test, add, cancel and pin.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Panel, PanelAutomation, PanelCard, PanelCardUpdate, PanelEstimate, PanelPinnableBlock, PanelSuggestion } from "../../../shared/panels";
import { panelSummary } from "../../../shared/panels";
import { setLocale } from "@/lib/i18n";

type MenuItem = { key: string; label: string; checked?: boolean; onSelect: () => void };
const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    panelId: "p1" as string | undefined,
    bots: [{ id: "scout", name: "Scout" }, { id: "nova", name: "Nova" }],
    groups: [],
    config: null,
  },
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
let blocks: PanelPinnableBlock[];
let history: PanelCardUpdate[] = [];
let suggestions: Record<string, PanelSuggestion[]> = {};
let estimates: Record<string, PanelEstimate> = {};
let keepRefusal: { error: string; errorKey?: string } | null = null;
let testRefusal: { error: string; errorKey?: string } | null = null;
let draftAccess: PanelCard["updateAccess"];
const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let host: HTMLDivElement;
let root: Root;
let PanelsPage: typeof import("./PanelsPage").PanelsPage;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function server(path: string, method: string, body: Record<string, unknown> | undefined, query = ""): Response {
  const parts = path.split("/").slice(3).map(decodeURIComponent);
  if (parts.length === 0) return reply({ panels: panels.map(panelSummary) });
  if (parts[0] === "pinnable") return reply({ blocks });
  if (parts[0] === "suggestions") return reply({ suggestions: suggestions[new URLSearchParams(query).get("botId") ?? ""] ?? [] });
  if (parts[0] === "estimate") return reply(estimates[new URLSearchParams(query).get("schedule") ?? ""] ?? { perDayUsd: null, basis: "none" });
  const panel = panels.find((item) => item.id === parts[0]);
  if (!panel) return reply({ error: "No such panel" }, 404);
  if (parts.length === 1 && method === "GET") return reply({ panel });
  if (parts.length === 1 && method === "PATCH") { Object.assign(panel, body); return reply({ panel }); }
  if (parts[1] === "order") {
    const ids = body!.cardIds as string[];
    panel.cards.forEach((item) => { item.position = ids.indexOf(item.id); });
    return reply({ panel });
  }
  if (parts[2] === "new" && testRefusal) return reply(testRefusal, 409);
  if (parts[2] === "new") {
    const made = card({ id: "draft1", key: "orders-by-hour", title: (body!.title as string) || "Orders by hour", size: body!.size as PanelCard["size"], botId: body!.botId as string, widget: undefined, draft: true, position: 9, ...(draftAccess ? { updateAccess: draftAccess } : {}) });
    panel.cards.push(made);
    return reply({ panel, card: made, routineId: "r9" }, 202);
  }
  if (parts[2] === "pin") {
    const made = card({ id: "pinned1", title: "Pinned", position: 9, pinnedFrom: { threadId: body!.threadId as string, messageId: body!.messageId as string } });
    panel.cards.push(made);
    return reply({ panel, card: made });
  }
  if (parts[2] === "restore") { panel.cards.push(body!.card as PanelCard); return reply({ panel }); }
  const target = panel.cards.find((item) => item.id === parts[2])!;
  if (parts[3] === "keep" && keepRefusal) return reply(keepRefusal, 409);
  if (parts[3] === "keep") { delete target.draft; return reply({ panel }); }
  if (parts[3] === "history") return reply({ updates: history });
  if (parts[3] === "alert") { delete target.alertActive; return reply({ panel }); }
  if (parts[3]) return reply({}, 202);
  if (method === "PATCH") { Object.assign(target, body); return reply({ panel }); }
  panel.cards = panel.cards.filter((item) => item !== target);
  return reply({ panel, card: target });
}

beforeEach(async () => {
  setLocale("en");
  vi.resetModules();
  fixture.dispatch.mockReset();
  fixture.state.panelId = "p1";
  fixture.menus.clear();
  fixture.frames.length = 0;
  calls.length = 0;
  history = [];
  suggestions = {};
  estimates = {};
  keepRefusal = null;
  testRefusal = null;
  draftAccess = undefined;
  blocks = [{ threadId: "t7", messageId: "m3", botId: "nova", title: "Weekly signups", at: ago(30), text: "312 this week" }];
  panels = [
    {
      id: "p1", title: "Store health", createdBy: { botId: "scout", threadId: "t1" }, createdAt: ago(600), updatedAt: ago(12), position: 0,
      cards: [
        card({ key: "orders" }),
        card({ id: "c2", key: "refunds", title: "Refunds", size: "m", position: 1, botId: "nova" }),
        card({ id: "c3", title: "Ad spend", size: "l", position: 2 }),
        card({ id: "old-draft", title: "Left over", position: 3, draft: true }),
      ],
      automations: [automation({ cardKey: "refunds", botId: "nova", cadence: "daily", running: true })],
    },
    { id: "p2", title: "Marketing", createdBy: { botId: "nova" }, createdAt: ago(60), updatedAt: ago(90), position: 1, cards: [], visibility: "private" },
  ];
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = new URL(input, "http://x");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method, path: url.pathname, body });
    return Promise.resolve(server(url.pathname, method, body, url.search));
  }));
  ({ PanelsPage } = await import("./PanelsPage"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const settle = async () => { for (let round = 0; round < 8; round += 1) await act(async () => { await Promise.resolve(); }); };
const show = async () => { act(() => root.render(createElement(PanelsPage))); await settle(); };
const all = () => [...document.querySelectorAll("button")];
const button = (name: string) => all().find((item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name);
const order = () => [...host.querySelectorAll("[data-panel-card]")].map((item) => item.getAttribute("data-panel-card"));
const posted = (path: string) => calls.filter((call) => call.method === "POST" && call.path === path);
const frame = () => act(() => fixture.frames.forEach((listener) => listener.onFrame({ kind: "panels.changed", panelId: "p1" } as { kind: string })));
const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
const choose = (element: HTMLSelectElement, value: string) => act(() => {
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
});
const pointer = (target: Element, kind: string, x: number, y: number) => act(() => {
  target.dispatchEvent(new PointerEvent(kind, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }));
});

describe("the line under the title", () => {
  it("says who sees it, who made it, how many cards it has and when it changed, leaving test cards out", async () => {
    await show();
    const meta = host.querySelector("[data-panel-meta]")!;
    expect(meta.querySelector("[data-panel-visibility]")?.textContent).toBe("Shared");
    expect(meta.textContent).toContain("Made by Scout");
    expect(meta.textContent).toContain("3 cards");
    expect(meta.textContent).toContain("Updated 12 min ago");
    expect(order()).toEqual(["c1", "c2", "c3"]);
  });

  it("Share changes who sees the panel", async () => {
    await show();
    act(() => button("Share")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Everyone who can see Scout.");
    act(() => (document.querySelector('[data-panel-share="private"]') as HTMLButtonElement).click());
    act(() => button("Save")!.click());
    await settle();
    expect(calls.find((call) => call.method === "PATCH")).toEqual({ method: "PATCH", path: "/api/panels/p1", body: { visibility: "private" } });
    frame();
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("[data-panel-visibility]")?.textContent).toBe("Only you");
  });
});

describe("each card's footer", () => {
  it("names the bot that keeps it, when it changed and how often, and marks only the running card updating", async () => {
    await show();
    const footer = (id: string) => host.querySelector(`[data-panel-card="${id}"] [data-panel-card-footer]`)!.textContent;
    expect(footer("c1")).toBe("Scout·12 min ago·when asked");
    expect(footer("c2")).toBe("Nova·Updating…·daily");
    expect(host.querySelector('[data-panel-card="c2"]')!.getAttribute("data-panel-card-state")).toBe("updating");
    expect(host.querySelector('[data-panel-card="c1"]')!.getAttribute("data-panel-card-state")).toBe("ok");
  });

  it("follows an automation that keeps the whole panel, in the routine's own words when it is not a plain cadence", async () => {
    panels[0]!.automations = [automation({ cadence: "custom", scheduleText: "Weekdays at 9:00" })];
    await show();
    expect(host.querySelector('[data-panel-card="c3"] [data-panel-card-cadence]')!.textContent).toBe("Weekdays at 9:00");
  });
});

describe("organizing", () => {
  it("trades each card's menu for size, remove and a handle, and Done leaves", async () => {
    await show();
    expect(fixture.menus.has("More for Orders today")).toBe(true);
    act(() => button("Organize")!.click());
    fixture.menus.clear();
    await settle();
    const first = host.querySelector('[data-panel-card="c1"]')!;
    expect(first.querySelector("[data-panel-card-handle]")).not.toBeNull();
    act(() => (first.querySelector("[data-panel-card-size]") as HTMLButtonElement).click());
    await settle();
    expect(calls.find((call) => call.method === "PATCH")).toEqual({ method: "PATCH", path: "/api/panels/p1/cards/c1", body: { size: "m" } });
    act(() => button("Remove Ad spend from the panel")!.click());
    await settle();
    expect(order()).toEqual(["c1", "c2"]);
    act(() => button("Undo")!.click());
    await settle();
    expect(order()).toEqual(["c1", "c2", "c3"]);
    act(() => button("Done")!.click());
    expect(host.querySelector("[data-panel-card-handle]")).toBeNull();
    expect(fixture.menus.has("More for Orders today")).toBe(true);
  });

  it("moves a card with the arrow keys and saves the order, keeping focus on its handle", async () => {
    await show();
    act(() => button("Organize")!.click());
    const handle = host.querySelector('[data-panel-card="c1"] [data-panel-card-handle]') as HTMLButtonElement;
    act(() => handle.focus());
    act(() => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    await settle();
    expect(order()).toEqual(["c2", "c1", "c3"]);
    expect(posted("/api/panels/p1/order").map((call) => call.body)).toEqual([{ cardIds: ["c2", "c1", "c3"] }]);
    expect(document.activeElement?.closest("[data-panel-card]")?.getAttribute("data-panel-card")).toBe("c1");
    expect(host.textContent).toContain("Orders today moved to position 2 of 3.");
    act(() => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    await settle();
    expect(order()).toEqual(["c2", "c3", "c1"]);
  });

  it("drags a card over another to take its place, and saves once on release", async () => {
    await show();
    act(() => button("Organize")!.click());
    const boxes: Record<string, [number, number]> = { c1: [0, 100], c2: [100, 300], c3: [300, 500] };
    for (const element of host.querySelectorAll<HTMLElement>("[data-panel-card]")) {
      const [left, right] = boxes[element.getAttribute("data-panel-card")!]!;
      element.getBoundingClientRect = () => ({ left, right, top: 0, bottom: 100, width: right - left, height: 100, x: left, y: 0, toJSON: () => ({}) });
    }
    const handle = host.querySelector('[data-panel-card="c1"] [data-panel-card-handle]')!;
    pointer(handle, "pointerdown", 50, 10);
    expect(host.querySelector('[data-panel-card="c1"]')!.getAttribute("data-panel-card-dragging")).toBe("true");
    pointer(handle, "pointermove", 400, 50);
    expect(order()).toEqual(["c2", "c3", "c1"]);
    expect(posted("/api/panels/p1/order")).toHaveLength(0);
    pointer(handle, "pointerup", 400, 50);
    await settle();
    expect(posted("/api/panels/p1/order").map((call) => call.body)).toEqual([{ cardIds: ["c2", "c3", "c1"] }]);
  });
});

describe("New card", () => {
  const open = async () => {
    await show();
    act(() => button("Card")!.click());
    return document.querySelector('[role="dialog"]')!;
  };

  it("tests the card with the bot that made the panel, shows it fill in, then adds it to the chosen panel", async () => {
    const dialog = await open();
    expect(dialog.querySelector("h2")?.textContent).toBe("New card");
    const test = dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement;
    expect(test.disabled).toBe(true);
    const selects = [...dialog.querySelectorAll("select")];
    const bot = selects.find((item) => item.getAttribute("aria-label") === "Bot that keeps it")!;
    expect(bot.value).toBe("scout");
    expect(bot.selectedOptions[0]!.textContent).toBe("Scout (suggested)");
    type(dialog.querySelector("textarea")!, "Orders per hour today");
    choose(selects.find((item) => item.getAttribute("aria-label") === "Format")!, "bar");
    const often = selects.find((item) => item.getAttribute("aria-label") === "How often")!;
    expect([...often.options].map((option) => option.textContent)).toEqual(["every 30 min", "every hour", "daily at 8:00", "Mondays at 8:00", "when asked"]);
    choose(often, "day");
    act(() => (dialog.querySelector("[data-panel-new-notify]") as HTMLButtonElement).click());
    act(() => (dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement).click());
    await settle();
    expect(posted("/api/panels/p1/cards/new").map((call) => call.body)).toEqual([
      { prompt: "Orders per hour today", format: "bar", size: "m", botId: "scout", schedule: "day", notify: true, test: true },
    ]);
    frame();
    await settle();
    const preview = document.querySelector("[data-panel-new-preview]")!;
    expect(preview.textContent).toContain("Waiting for the first update…");
    expect(order()).toEqual(["c1", "c2", "c3"]);
    panels[0]!.cards.find((item) => item.id === "draft1")!.widget = widget("18 orders at 10:00");
    frame();
    await settle();
    expect(preview.textContent).toContain("18 orders at 10:00");
    expect((dialog.querySelector('[data-panel-new="add"]') as HTMLButtonElement).textContent).toBe("Create");
    choose([...dialog.querySelectorAll("select")].find((item) => item.getAttribute("aria-label") === "Add to")!, "p2");
    act(() => (dialog.querySelector('[data-panel-new="add"]') as HTMLButtonElement).click());
    await settle();
    expect(posted("/api/panels/p1/cards/draft1/keep").map((call) => call.body)).toEqual([{ panelId: "p2" }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("asks for a new test after a change, and drops the test card when cancelled", async () => {
    const dialog = await open();
    type(dialog.querySelector("textarea")!, "Refunds this week");
    act(() => (dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement).click());
    await settle();
    expect(dialog.querySelector('[data-panel-new="add"]')).not.toBeNull();
    type(dialog.querySelector("textarea")!, "Refunds this month");
    expect(dialog.querySelector('[data-panel-new="test"]')?.textContent).toBe("Test again");
    act(() => button("Cancel")!.click());
    await settle();
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual(["/api/panels/p1/cards/draft1"]);
  });

  it("fills the card from one of the bot's ideas, sends the alert, and shows the cost a day before testing", async () => {
    suggestions = {
      scout: [
        { title: "Orders today", prompt: "Count today's orders", format: "kpi", schedule: "hour" },
        { title: "Refund rate", prompt: "Refunds as a share of orders this week", format: "line", schedule: "day" },
        { title: "Low stock", prompt: "Products under 10 units", format: "checklist", schedule: "half" },
        { title: "Extra", prompt: "Not shown", format: "text", schedule: "week" },
      ],
      nova: [],
    };
    estimates = { day: { perDayUsd: 0.12, basis: "recent-runs" }, hour: { perDayUsd: null, basis: "none" } };
    const dialog = await open();
    await settle();
    const ideas = [...dialog.querySelectorAll("[data-panel-new-suggestion]")];
    expect(ideas.map((idea) => idea.textContent)).toEqual(["Orders today", "Refund rate", "Low stock"]);
    expect(dialog.querySelector("[data-panel-new-estimate]")?.textContent).toBe("No cost estimate yet");
    act(() => (ideas[1] as HTMLButtonElement).click());
    await settle();
    expect(dialog.querySelector("textarea")!.value).toBe("Refunds as a share of orders this week");
    expect((dialog.querySelector('input[aria-label="Title"]') as HTMLInputElement).value).toBe("Refund rate");
    expect(dialog.querySelector("[data-panel-new-estimate]")?.textContent).toBe("≈ $0.12 per day");
    type(dialog.querySelector("[data-panel-new-alert]") as HTMLInputElement, "the rate goes over 5%");
    const selects = [...dialog.querySelectorAll("select")];
    choose(selects.find((item) => item.getAttribute("aria-label") === "How often")!, "manual");
    expect(dialog.querySelector("[data-panel-new-estimate]")?.textContent).toBe("Costs only when you ask");
    choose(selects.find((item) => item.getAttribute("aria-label") === "Bot that keeps it")!, "nova");
    await settle();
    expect(dialog.querySelector("[data-panel-new-suggestions]")).toBeNull();
    act(() => (dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement).click());
    await settle();
    expect(posted("/api/panels/p1/cards/new").map((call) => call.body)).toEqual([
      { prompt: "Refunds as a share of orders this week", title: "Refund rate", format: "line", size: "m", botId: "nova", schedule: "manual", alert: "the rate goes over 5%", notify: false, test: true },
    ]);
  });

  it("tests at 24 cards, since a test card isn't counted, and says why Create was refused", async () => {
    panels[0]!.cards = Array.from({ length: 24 }, (_, position) => card({ id: `c${position}`, position }));
    keepRefusal = { error: "This panel already has 24 cards. Remove one first, or keep this card on another panel.", errorKey: "panels.limit.panelFull" };
    const dialog = await open();
    type(dialog.querySelector("textarea")!, "One more");
    expect(dialog.querySelector("[data-panel-new-full]")?.textContent).toBe("This panel already has 24 cards, the most it can hold. Remove one or add to another panel.");
    const test = dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement;
    expect(test.disabled).toBe(false);
    act(() => test.click());
    await settle();
    expect(posted("/api/panels/p1/cards/new")).toHaveLength(1);
    const add = dialog.querySelector('[data-panel-new="add"]') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    act(() => add.click());
    await settle();
    expect(posted("/api/panels/p1/cards/draft1/keep")).toHaveLength(1);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("This panel already has 24 cards, the most it can hold. Remove one or add to another panel.");
    expect(dialog.querySelector("[data-panel-new-full]")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("says a limit in the person's language when the server names it, and its own sentence when it doesn't", async () => {
    keepRefusal = { error: "There are already 60 cards that update by themselves.", errorKey: "panels.limit.scheduled" };
    const dialog = await open();
    type(dialog.querySelector("textarea")!, "Refunds this week");
    act(() => (dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement).click());
    await settle();
    await (await import("@/lib/i18n")).loadLocale("pt-br");
    const add = dialog.querySelector('[data-panel-new="add"]') as HTMLButtonElement;
    act(() => add.click());
    await settle();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Você já tem 60 cartões com atualização agendada, o máximo. Deixe um para atualizar só quando pedir, ou remova um.");
    expect(add.disabled).toBe(false);

    keepRefusal = { error: "Something else the server said." };
    act(() => add.click());
    await settle();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Something else the server said.");

    testRefusal = { error: "This panel already has 4 cards being tested.", errorKey: "panels.limit.drafts" };
    type(dialog.querySelector("textarea")!, "Refunds this month");
    act(() => (dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement).click());
    await settle();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Este painel já tem 4 cartões de teste esperando. Tente de novo em alguns minutos.");
  });

  it("says under the preview when the bot updates with its usual access, and only for the bot it was tested with", async () => {
    draftAccess = "bot";
    const dialog = await open();
    type(dialog.querySelector("textarea")!, "Orders per hour today");
    expect(dialog.querySelector("[data-panel-access]")).toBeNull();
    act(() => (dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement).click());
    await settle();
    expect(dialog.querySelector("[data-panel-access]")?.textContent).toBe("This bot updates it with its usual access (its AI has no read-only mode).");
    choose([...dialog.querySelectorAll("select")].find((item) => item.getAttribute("aria-label") === "Bot that keeps it")!, "nova");
    await settle();
    expect(dialog.querySelector("[data-panel-access]")).toBeNull();
  });

  it("says nothing about access when the update runs fenced", async () => {
    draftAccess = "fenced";
    const dialog = await open();
    type(dialog.querySelector("textarea")!, "Orders per hour today");
    act(() => (dialog.querySelector('[data-panel-new="test"]') as HTMLButtonElement).click());
    await settle();
    expect(dialog.querySelector("[data-panel-new-preview] [data-panel-card]")).not.toBeNull();
    expect(dialog.querySelector("[data-panel-access]")).toBeNull();
  });

  it("pins a block a bot already posted in a chat", async () => {
    const dialog = await open();
    act(() => (dialog.querySelector("[data-panel-new-pin]") as HTMLButtonElement).click());
    await settle();
    const block = document.querySelector('[data-panel-pin="t7/m3"]') as HTMLButtonElement;
    expect(block.textContent).toContain("Weekly signups");
    expect(block.textContent).toContain("Nova");
    act(() => block.click());
    await settle();
    expect(posted("/api/panels/p1/cards/pin").map((call) => call.body)).toEqual([{ threadId: "t7", messageId: "m3", size: "m" }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("says so when there is nothing to pin yet", async () => {
    blocks = [];
    const dialog = await open();
    act(() => (dialog.querySelector("[data-panel-new-pin]") as HTMLButtonElement).click());
    await settle();
    expect(document.querySelector("[data-panel-pin-empty]")?.textContent).toBe("No blocks in your chats yet.");
  });
});

describe("the six kinds of card", () => {
  it("draws a number, a goal, a line, bars, a checklist and a note from the widget blocks bots already write", async () => {
    const { PANEL_SAMPLE_WIDGETS } = await import("./panel-samples");
    panels[0]!.cards = Object.entries(PANEL_SAMPLE_WIDGETS).map(([format, sample], position) => card({ id: format, title: sample.title, size: sample.size, widget: sample.widget, format: format as PanelCard["format"], position }));
    panels[0]!.automations = [];
    await show();
    expect(order()).toEqual(["kpi", "goal", "line", "bar", "checklist", "text"]);
    const text = (id: string) => host.querySelector(`[data-panel-card="${id}"]`)!.textContent;
    expect(text("kpi")).toContain("US$ 4,820");
    expect(text("kpi")).toContain("+12%");
    expect(host.querySelector('[data-panel-card="goal"] [role="progressbar"]')).not.toBeNull();
    expect(text("checklist")).toContain("1 rejected");
    expect(text("text")).toContain("2 low stock");
  });
});

describe("what each card is doing", () => {
  it("shows building, on hold with when it comes back, a failure with Resolve, an alert, and the card's own schedule", async () => {
    panels[0]!.cards = [
      card({ id: "b", title: "New one", widget: undefined, building: true, prompt: "Orders by hour", schedule: "half" }),
      card({ id: "h", title: "Held", position: 1, held: { reason: "usage limit reached", until: new Date(NOW + 2 * 3_600_000).toISOString() } }),
      card({ id: "f", title: "Broken", position: 2, status: "failed", failure: "Paused after 5 failures", failedAt: ago(3), schedule: "day" }),
      card({ id: "a", title: "Watched", position: 3, alertActive: { text: "Refunds rose 30%", at: ago(1) }, schedule: "manual" }),
    ];
    panels[0]!.automations = [];
    await show();
    const state = (id: string) => host.querySelector(`[data-panel-card="${id}"]`)!.getAttribute("data-panel-card-state");
    expect(["b", "h", "f", "a"].map(state)).toEqual(["building", "held", "failed", "ok"]);
    expect(host.querySelector('[data-panel-card="b"] [data-panel-card-building]')?.textContent).toBe("Building the first version…");
    expect(host.querySelector('[data-panel-card="b"] [data-panel-card-cadence]')?.textContent).toBe("every 30 min");
    expect(host.querySelector('[data-panel-card="h"] [data-panel-card-held]')?.textContent).toMatch(/^On hold: usage limit reached · back today/);
    expect(host.querySelector('[data-panel-card="a"] [data-panel-card-alert]')?.textContent).toBe("Refunds rose 30%");
    expect(host.querySelector('[data-panel-card="a"] [data-panel-card-cadence]')?.textContent).toBe("when asked");
    const resolve = host.querySelector('[data-panel-card="f"] [data-panel-card-resolve]') as HTMLButtonElement;
    expect(resolve.textContent).toBe("Resolve");
    act(() => resolve.click());
    await settle();
    expect(posted("/api/panels/p1/cards/f/resolve")).toHaveLength(1);
  });

  it("says why the server failed a card in the person's language, and the bot's own sentence when there is no code", async () => {
    panels[0]!.cards = [
      card({ id: "p", title: "Paused", status: "failed", failure: "Paused after 5 failures in a row.", failureCode: "paused", failedAt: ago(3) }),
      card({ id: "n", title: "Quiet", position: 1, status: "failed", failure: "The run ended without an update.", failureCode: "no_update", failedAt: ago(3) }),
      card({ id: "e", title: "Engine", position: 2, status: "failed", failure: "This AI cannot run read-only.", failureCode: "engine", failedAt: ago(3) }),
      card({ id: "o", title: "Old", position: 3, status: "failed", failure: "Shopify didn't answer", failedAt: ago(3) }),
    ];
    panels[0]!.automations = [];
    await (await import("@/lib/i18n")).loadLocale("pt-br");
    await show();
    const failure = (id: string) => host.querySelector(`[data-panel-card="${id}"] [data-panel-card-failure]`)?.textContent;
    expect(failure("p")).toBe("Pausado depois de 5 falhas seguidas");
    expect(failure("n")).toBe("A última atualização não trouxe dados novos");
    expect(failure("e")).toBe("O bot deste card usa um motor que ainda não suporta atualização automática");
    expect(failure("o")).toBe("Shopify didn't answer");
    expect(host.querySelectorAll("[data-panel-card-resolve]")).toHaveLength(4);
  });

  it("marks updating only the card whose own automation runs", async () => {
    panels[0]!.cards = [card({ routineId: "own" }), card({ id: "c2", title: "Other", position: 1, routineId: "other" })];
    panels[0]!.automations = [automation({ routineId: "own", running: true })];
    await show();
    expect(order().map((id) => host.querySelector(`[data-panel-card="${id}"]`)!.getAttribute("data-panel-card-state"))).toEqual(["updating", "ok"]);
  });

  it("lists in the header only the automations that keep the whole panel", async () => {
    panels[0]!.cards = [card({ routineId: "own" })];
    panels[0]!.automations = [automation({ routineId: "own", name: "Card's own" }), automation({ routineId: "wide", name: "Whole panel" })];
    await show();
    const list = host.querySelector('ul[aria-label="Automations that update this panel"]');
    expect(list?.textContent).toContain("Whole panel");
    expect(list?.textContent).not.toContain("Card's own");
  });
});

describe("the card's side panel", () => {
  const openCard = async (id: string) => {
    await show();
    act(() => (host.querySelector(`[data-panel-card="${id}"] [data-panel-card-open]`) as HTMLButtonElement).click());
    await settle();
    return host.querySelector(`[data-panel-side="${id}"]`) as HTMLElement;
  };

  it("shows the card large with its automation, alert, sources and last updates with cost", async () => {
    Object.assign(panels[0]!.cards[0]!, { routineId: "own", schedule: "hour", alert: "orders fall below 30", alertActive: { text: "Only 22 orders", at: ago(5) }, sources: ["Shopify orders", "https://example.com/report"], prompt: "Orders today" });
    panels[0]!.automations = [automation({ routineId: "own", nextRunAt: new Date(NOW + 30 * 60_000).toISOString() })];
    history = [
      { at: ago(12), status: "ok", summary: "Orders went from 40 to 42", costUsd: 0.034, tokens: 12_400 },
      { at: ago(80), status: "failed", failure: "Shopify didn't answer", costUsd: 0.004 },
      { at: ago(140), status: "ok", change: "show it as bars" },
      { at: ago(200), status: "failed", failure: "The run ended without an update.", failureCode: "no_update" },
    ];
    const side = await openCard("c1");
    expect(side.getAttribute("aria-label")).toBe("Orders today, details");
    expect([...side.querySelectorAll("h2")].filter((heading) => heading.textContent === "Orders today")).toHaveLength(1);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    expect(side.querySelector("[data-panel-card]")?.textContent).toContain("42 orders");
    expect(side.querySelector("[data-panel-side-automation]")?.textContent).toMatch(/Scout · every hour · next today/);
    expect(side.querySelector("[data-panel-side-alert]")?.textContent).toContain("Only 22 orders");
    expect(side.textContent).toContain("Alerts you when orders fall below 30");
    expect(side.querySelector("[data-panel-side-sources] a")?.getAttribute("href")).toBe("https://example.com/report");
    const items = [...side.querySelectorAll("[data-panel-history-item]")].map((item) => item.textContent);
    expect(items[0]).toContain("Orders went from 40 to 42");
    expect(items[0]).toContain("$0.03 · 12.4K tokens");
    expect(items[1]).toContain("Shopify didn't answer");
    expect(items[1]).toContain("under $0.01");
    expect(items[2]).toContain("Asked: show it as bars");
    expect(items[2]).not.toContain("$");
    expect(items[3]).toContain("The last update brought no new data");
    expect(side.querySelector("[data-panel-access]")).toBeNull();
    expect(calls.some((call) => call.path === "/api/panels/p1/cards/c1/history")).toBe(true);
  });

  it("says when the bot updates the card with its usual access", async () => {
    Object.assign(panels[0]!.cards[0]!, { routineId: "own", schedule: "hour", updateAccess: "bot" });
    await (await import("@/lib/i18n")).loadLocale("pt-br");
    const side = await openCard("c1");
    expect(side.querySelector("[data-panel-access]")?.textContent).toBe("Este bot atualiza com o acesso normal dele (o motor não tem modo só leitura).");
  });

  it("refreshes now, sends a change, clears the alert, removes with Undo, and closes on Escape", async () => {
    panels[0]!.cards[0]!.alertActive = { text: "Only 22 orders", at: ago(5) };
    let side = await openCard("c1");
    act(() => (side.querySelector('[data-panel-side-action="refresh"]') as HTMLButtonElement).click());
    await settle();
    expect(posted("/api/panels/p1/cards/c1/refresh")).toHaveLength(1);
    type(side.querySelector("textarea")!, "compare with last week");
    act(() => (side.querySelector('[data-panel-side-action="change"]') as HTMLButtonElement).click());
    await settle();
    expect(posted("/api/panels/p1/cards/c1/change").map((call) => call.body)).toEqual([{ text: "compare with last week" }]);
    expect(side.textContent).toContain("Sent. Scout is working on it.");
    act(() => button("Clear")!.click());
    await settle();
    expect(posted("/api/panels/p1/cards/c1/alert/clear")).toHaveLength(1);

    act(() => side.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await settle();
    expect(host.querySelector("[data-panel-side]")).toBeNull();

    side = await openCard("c2");
    act(() => (side.querySelector('[data-panel-side-action="remove"]') as HTMLButtonElement).click());
    await settle();
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual(["/api/panels/p1/cards/c2"]);
    expect(host.querySelector("[data-panel-side]")).toBeNull();
    expect(order()).toEqual(["c1", "c3"]);
    act(() => button("Undo")!.click());
    await settle();
    expect(order()).toEqual(["c1", "c2", "c3"]);
  });
});
