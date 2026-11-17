// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Task } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: (...args: unknown[]) => fixture.api(...args),
    useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }),
  };
});

const { ChatHeadThreads, showBotConversations, threadsPlace } = await import("./ChatHeadThreads");
const { forgetConversationLines } = await import("./bot-panel/Conversations");

const now = Date.now();
const task = (threadId: string, title: string, order: number): Task =>
  ({ threadId, title, createdAt: now - 86_400_000, updatedAt: now - order * 60_000, lastThreadOrderAt: now - order * 60_000 });
const research = (extra: Partial<Bot> = {}): Bot => ({
  id: "research", threadId: "who", name: "Research", title: "", description: "", notifications: true, color: "green",
  unread: false, modelSelection: { instanceId: "fake", model: "fake" }, messages: [],
  tasks: [task("launch", "Translate the launch post", 1), task("who", "Who am I?", 2), task("pricing", "Competitor pricing", 3)],
  ...extra,
});

let host: HTMLDivElement;
let root: Root;
const render = (bot: Bot) => flushSync(() => root.render(createElement("div", null, createElement(ChatHeadThreads, { bot }))));
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const trigger = () => host.querySelector<HTMLButtonElement>("[data-chathead-threads]")!;
const sheet = () => document.querySelector<HTMLElement>("[data-chathead-threads-sheet]");
const rows = () => [...sheet()!.querySelectorAll<HTMLElement>("[data-sidebar-thread-row]")];
const search = () => sheet()!.querySelector<HTMLInputElement>("[data-conversations-query]");
const click = (element: Element | null, detail = 1) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
};
const press = (element: Element | null, key: string) => {
  if (!element) throw new Error("nothing to press");
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  flushSync(() => element.dispatchEvent(event));
  return event;
};
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
};
const open = async (bot = research(), detail = 1) => {
  render(bot);
  click(trigger(), detail);
  await settle();
};

beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  fixture.api.mockImplementation(() => Promise.resolve({ messages: [], activeLeafId: null }));
  forgetConversationLines();
  // The list opens and closes at once instead of animating.
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("the conversations list on the chat header's pill", () => {
  it("is closed until the chevron is pressed, then lists the bot's conversations with the one on screen marked", async () => {
    render(research());
    expect(sheet()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().getAttribute("aria-label")).toBe("Conversations: Research");

    click(trigger());
    await settle();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(sheet()!.getAttribute("role")).toBe("dialog");
    expect(sheet()!.querySelector("[data-conversations-new]")).not.toBeNull();
    expect(search()).not.toBeNull();
    expect(rows().map((row) => row.getAttribute("data-sidebar-thread-row"))).toEqual(["launch", "who", "pricing"]);
    expect(rows().filter((row) => row.getAttribute("aria-current") === "page").map((row) => row.getAttribute("data-sidebar-thread-row"))).toEqual(["who"]);
    // The panel's heading and its link anchor stay in the panel.
    expect(sheet()!.querySelector("[data-panel-card]")).toBeNull();

    click(trigger());
    await settle();
    expect(sheet()).toBeNull();
  });

  it("opens the conversation that is picked and closes", async () => {
    await open();
    click(rows()[0]!);
    await settle();
    expect(fixture.dispatch.mock.calls.map(([action]) => action.type)).not.toContain("toggleSettings");
    expect(fixture.dispatch.mock.calls.some(([action]) => JSON.stringify(action).includes("launch"))).toBe(true);
    expect(sheet()).toBeNull();
  });

  it("starts a new conversation and closes", async () => {
    await open();
    click(sheet()!.querySelector("[data-conversations-new]"));
    await settle();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newTask", botId: "research" });
    expect(sheet()).toBeNull();
  });

  it("offers New conversation and no search for a bot with no conversations yet", async () => {
    await open(research({ tasks: [] }));
    expect(sheet()!.querySelector("[data-conversations-new]")).not.toBeNull();
    expect(search()).toBeNull();
    expect(rows()).toEqual([]);
  });

  it("filters as the person types, clears the search on Escape, and closes on the next one with focus back on the chevron", async () => {
    await open();
    const input = search()!;
    input.focus();
    type(input, "pricing");
    await settle();
    expect(rows().map((row) => row.getAttribute("data-sidebar-thread-row"))).toEqual(["pricing"]);

    expect(press(search(), "Escape").defaultPrevented).toBe(true);
    await settle();
    expect(sheet()).not.toBeNull();
    expect(search()!.value).toBe("");
    expect(rows()).toHaveLength(3);

    press(search(), "Escape");
    await settle();
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("puts focus in the list when opened from the keyboard, and walks it with the arrows, Home and End", async () => {
    await open(research(), 0);
    const first = document.activeElement as HTMLElement;
    expect(sheet()!.contains(first)).toBe(true);

    press(first, "ArrowDown");
    const second = document.activeElement as HTMLElement;
    expect(second).not.toBe(first);
    expect(sheet()!.contains(second)).toBe(true);
    press(second, "ArrowUp");
    expect(document.activeElement).toBe(first);
    // Up from the first stop wraps to the last.
    press(first, "ArrowUp");
    const last = document.activeElement as HTMLElement;
    expect(last).not.toBe(first);

    rows()[1]!.focus();
    press(rows()[1]!, "Home");
    expect(document.activeElement).toBe(first);
    press(first, "End");
    expect(document.activeElement).toBe(last);
  });

  it.each([
    ["the conversation on screen", () => rows()[1]!],
    ["another conversation", () => rows()[0]!],
    ["New conversation", () => sheet()!.querySelector<HTMLElement>("[data-conversations-new]")!],
  ])("gives focus back to the chevron when %s is chosen from the keyboard", async (_name, choice) => {
    await open(research(), 0);
    const chosen = choice();
    chosen.focus();
    click(chosen, 0);
    await settle();
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("gives the chevron a touch-sized target", () => {
    render(research());
    expect(trigger().className).toContain("touch:min-w-10");
    expect(trigger().className).toContain("touch:min-h-10");
  });

  it("jumps to a conversation by its first letters, but not while the person types in the search", async () => {
    await open();
    rows()[0]!.focus();
    press(rows()[0]!, "c");
    expect(document.activeElement).toBe(rows()[2]);

    const input = search()!;
    input.focus();
    expect(press(input, "w").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("closes on Tab and on a press outside, and leaves a mouse press's focus alone", async () => {
    await open();
    rows()[0]!.focus();
    press(rows()[0]!, "Tab");
    await settle();
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    click(trigger());
    await settle();
    flushSync(() => sheet()!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(sheet()).not.toBeNull();
    flushSync(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    await settle();
    expect(sheet()).toBeNull();
  });

  it("closes when the header moves to another bot", async () => {
    await open();
    render(research({ id: "writer", name: "Writer" }));
    await settle();
    expect(sheet()).toBeNull();
  });

  it("opens when asked to for its bot, as the sidebar's View conversations does, and ignores a request for another bot", async () => {
    render(research());
    flushSync(() => showBotConversations("writer"));
    await settle();
    expect(sheet()).toBeNull();
    flushSync(() => showBotConversations("research"));
    await settle();
    expect(sheet()?.getAttribute("data-chathead-threads-sheet")).toBe("research");
  });

  it("opens for a request made before its header came on screen", async () => {
    showBotConversations("research");
    render(research());
    await settle();
    expect(sheet()?.getAttribute("data-chathead-threads-sheet")).toBe("research");
  });

  it("opens for a request that arrives with the switch to its bot, and not again when the header comes back to it", async () => {
    await open(research({ id: "writer", name: "Writer" }));
    flushSync(() => {
      showBotConversations("research");
      root.render(createElement("div", null, createElement(ChatHeadThreads, { bot: research() })));
    });
    await settle();
    expect(sheet()?.getAttribute("data-chathead-threads-sheet")).toBe("research");

    render(research({ id: "writer", name: "Writer" }));
    await settle();
    expect(sheet()).toBeNull();
    render(research());
    await settle();
    expect(sheet()).toBeNull();
  });

  it("drops a request whose header never came on screen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      showBotConversations("research");
      vi.setSystemTime(Date.now() + 6000);
      render(research());
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(sheet()).toBeNull();
  });
});

describe("where the list sits", () => {
  it("centres under the pill and stays inside the window", () => {
    expect(threadsPlace({ left: 400, width: 120, bottom: 48 }, { width: 1200 })).toEqual({ left: 300, top: 54, width: 320 });
    expect(threadsPlace({ left: 0, width: 100, bottom: 48 }, { width: 1200 }).left).toBe(8);
    expect(threadsPlace({ left: 1150, width: 100, bottom: 48 }, { width: 1200 }).left).toBe(872);
    expect(threadsPlace({ left: 20, width: 120, bottom: 48 }, { width: 300 })).toEqual({ left: 8, top: 54, width: 284 });
  });
});
