// @vitest-environment happy-dom
// The row opens the dialog; Escape, the X, a press outside and "Talk to" close it, and focus goes back where it belongs.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const thread = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/state/message-history", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/message-history")>(), loadFullThread: thread.load,
}));

const { BotConversationRow } = await import("./BotConversationRow");
const { noteBotConversationFrame } = await import("@/state/bot-conversation");

const pepper = { id: "pepper", name: "Pepper", color: "blue" as const };
const engineer = { id: "engineer", name: "Engineer", color: "green" as const };
const request: Message = { id: "r1", role: "bot", kind: "text", at: 1_000, text: "@Engineer Write the report.",
  from: { botId: "pepper", name: "Pepper", color: "blue" }, roomRequest: { id: "h1", phase: "request" } };

let host: HTMLDivElement;
let root: Root;
let composer: HTMLTextAreaElement;
let openThread: ReturnType<typeof vi.fn<() => void>>;

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const click = (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const opener = () => host.querySelector<HTMLButtonElement>("[data-bot-conversation-open]")!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function open() {
  opener().focus();
  click(opener());
  await settle();
}
function render(state: "working" | "done" = "working") {
  flushSync(() => root.render(createElement(BotConversationRow, {
    handoff: { id: "h1", state, at: 2_000 }, startedAt: 1_000, threadId: "t", requester: pepper, peer: engineer, onOpenThread: openThread,
  })));
}

beforeEach(() => {
  setLocale("en");
  thread.load.mockReset().mockResolvedValue({ messages: [request], activeLeafId: null });
  openThread = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  document.body.innerHTML = '<div data-tour="composer"><textarea></textarea></div>';
  composer = document.querySelector("textarea")!;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render();
});

afterEach(() => {
  flushSync(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("BotConversationRow", () => {
  it("is one line: who helps whom, the way in, and the state", () => {
    expect(host.textContent).toBe("EngineerhelpingPepper·View conversationWorking");
    expect(host.querySelector('[data-handoff-status="working"]')).not.toBeNull();
    expect(dialog()).toBeNull();
    expect(thread.load).not.toHaveBeenCalled();
  });

  it("opens a modal dialog on the hand-off's thread", async () => {
    await open();
    expect(thread.load).toHaveBeenCalledExactlyOnceWith("t");
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()?.textContent).toContain("Pepper ⇄ Engineer");
    expect(dialog()?.textContent).toContain("Write the report.");
    expect(dialog()?.querySelector("textarea, input")).toBeNull();
  });

  it("starts focus on Close, so a keyboard's ring is drawn on a control and not around the dialog", async () => {
    await open();
    expect(document.activeElement).toBe(dialog()!.querySelector('[aria-label="Close"]'));
  });

  it("closes on Escape and gives focus back to the row", async () => {
    await open();
    dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("closes on the X and on a press outside, not on one inside", async () => {
    await open();
    flushSync(() => dialog()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(dialog()).not.toBeNull();
    click(dialog()!.querySelector('[aria-label="Close"]'));
    await settle();
    expect(dialog()).toBeNull();
    await open();
    flushSync(() => dialog()!.parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("shows a reply that arrives while it is open, and the new state, without loading again", async () => {
    await open();
    expect(dialog()!.textContent).toContain("Conversation between bots · 1 message");
    flushSync(() => noteBotConversationFrame({ kind: "message", threadId: "t", message: { id: "a1", role: "bot", kind: "text", at: 2_000, text: "The report is written." } }));
    render("done");
    await settle();
    expect(dialog()!.textContent).toContain("The report is written.");
    expect(dialog()!.textContent).toContain("Conversation between bots · 2 messages");
    expect(dialog()!.querySelector('[data-handoff-status="done"]')).not.toBeNull();
    expect(thread.load).toHaveBeenCalledTimes(1);
  });

  it("shows no message of a thread it may not read", async () => {
    thread.load.mockRejectedValue(new Error("404"));
    await open();
    flushSync(() => noteBotConversationFrame({ kind: "message", threadId: "t", message: request }));
    await settle();
    expect(dialog()!.textContent).toContain("You can't open this conversation.");
    expect(dialog()!.textContent).not.toContain("Write the report.");
    expect(dialog()!.querySelector("[data-handoff-status]")).not.toBeNull();
  });

  it("'Talk to' closes the dialog and puts the cursor in this chat's composer", async () => {
    await open();
    click(dialog()!.querySelector("[data-bot-conversation-talk]"));
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(composer);
    expect(openThread).not.toHaveBeenCalled();
  });

  it("'Open thread' closes the dialog and goes to the thread", async () => {
    await open();
    click(dialog()!.querySelector("[data-bot-conversation-thread]"));
    await settle();
    expect(dialog()).toBeNull();
    expect(openThread).toHaveBeenCalledOnce();
  });
});
