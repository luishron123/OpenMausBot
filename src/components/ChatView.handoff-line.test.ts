// @vitest-environment happy-dom
// A hand-off in the chat that sent it is one line. Its result row is not drawn again, yet what it carried and the places
// that point at it (a search jump, the unread divider) still work.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, InstanceInfo, Message } from "@/state/store";

const thread = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/state/message-history", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/message-history")>(), loadFullThread: thread.load,
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");

const at = (minute: number) => new Date(2026, 9, 8, 9, minute).getTime();
const from = { botId: "pepper", name: "Pepper", color: "blue" as const };
const threadRef = { botId: "scout", threadId: "scout-work", title: "Totals" };
const messages: Message[] = [
  { id: "u1", role: "user", kind: "text", text: "Ask Scout for the totals.", at: at(1) },
  { id: "sent", role: "bot", kind: "activity", at: at(2), parentId: "u1", from, threadRef,
    tool: { name: "Sent to Scout", ok: true }, handoff: { id: "h1", state: "done", at: at(3) } },
  { id: "result", role: "bot", kind: "activity", at: at(3), parentId: "sent", threadRef,
    tool: { name: "Scout replied", ok: true, output: "Final total: 42\nChecked against the ledger." }, roomRequest: { id: "h1", phase: "result" } },
  { id: "said", role: "bot", kind: "text", text: "Scout got back to me.", at: at(4), parentId: "result" },
  { id: "sent2", role: "bot", kind: "activity", at: at(5), parentId: "said", from, threadRef,
    tool: { name: "Sent to Scout", ok: true }, handoff: { id: "h2", state: "done", at: at(6) } },
  { id: "result2", role: "bot", kind: "activity", at: at(6), parentId: "sent2", threadRef,
    tool: { name: "Scout replied", ok: true, output: "The report is attached." }, roomRequest: { id: "h2", phase: "result" },
    attachments: [{ kind: "file", path: "/tmp/report.pdf", mime: "application/pdf", name: "report.pdf" }] },
];

const profile = (id: string, name: string, list: Message[], lastReadMessageId?: string): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green",
  notifications: true, unread: Boolean(lastReadMessageId), busy: false, messages: list, activeLeafId: list.at(-1)?.id,
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: `${id}-thread`, title: "Thread", createdAt: 1, busy: false, activity: "idle", unread: Boolean(lastReadMessageId), lastReadMessageId, modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
});

let state: AppState;
const dispatched: Action[] = [];
const dispatch = (action: Action) => { dispatched.push(action); };
let root: Root;
async function draw() {
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  const children = createElement(ChatView, { bot: state.bots.find((bot) => bot.id === state.selectedId)! });
  flushSync(() => root.render(createElement(BotEditorStore, { value, children })));
  await vi.advanceTimersByTimeAsync(0);
}
async function apply(action: Action) {
  state = reducer(state, action);
  await draw();
}
const click = (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const row = (id: string) => document.querySelector<HTMLElement>(`[data-mid="${id}"]`);

beforeAll(async () => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 10, 0));
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  thread.load.mockRejectedValue(new Error("404"));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state = {
    ...initialState,
    connected: true,
    selectedId: "scout",
    bots: [profile("pepper", "Pepper", messages, "sent"), profile("scout", "Scout", [{ id: "s1", role: "user", kind: "text", text: "hi", at: at(1) }])],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
  };
  await draw();
  await apply({ type: "select", id: "pepper" });
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a finished hand-off in the chat that sent it", () => {
  it("is drawn once: the line, with no second chip for its result", () => {
    expect(row("sent")?.querySelectorAll("[data-bot-conversation-row]")).toHaveLength(1);
    expect(row("sent")?.querySelector('[data-handoff-status="done"]')).not.toBeNull();
    expect(row("result")?.querySelector("[data-thread-chip]")).toBeNull();
    expect(row("result")?.textContent).not.toContain("Scout replied");
    expect(document.body.textContent).not.toContain("Final total: 42");
    expect(document.body.textContent).toContain("Scout got back to me.");
  });

  it("keeps the unread divider when the result is the first thing unread, above the next row drawn", () => {
    const divider = document.querySelector<HTMLElement>('[role="separator"][data-unread-divider]');
    expect(divider?.closest("[data-mid]")).toBe(row("result"));
    expect(row("result")!.textContent).toBe(divider!.textContent);
    expect(divider!.compareDocumentPosition(row("said")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider!.compareDocumentPosition(row("sent")!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("opens the reply this chat already received from the line, also when the conversation cannot be read", async () => {
    const toggle = document.querySelector<HTMLButtonElement>('[data-bot-conversation-reply="h1"]')!;
    expect(toggle.textContent).toBe("View reply");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    click(document.querySelector("[data-bot-conversation-open]"));
    await vi.advanceTimersByTimeAsync(0);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(thread.load).toHaveBeenCalledWith("scout-work");
    expect(dialog.textContent).not.toContain("Final total: 42");
    click(dialog.querySelector('[aria-label="Close"]'));
    await vi.advanceTimersByTimeAsync(0);
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(row("sent")!.querySelector("[data-bot-conversation-reply-text]")?.textContent).toBe("Final total: 42\nChecked against the ledger.");
    click(toggle);
    expect(row("sent")!.querySelector("[data-bot-conversation-reply-text]")).toBeNull();
  });

  it("sends a search jump that lands on the result to the line that shows it", async () => {
    dispatched.length = 0;
    await apply({ type: "focusMessage", threadId: "pepper-thread", messageId: "result", matchText: "replied" });
    const jump = dispatched.find((action) => action.type === "focusMessage");
    expect(jump).toEqual({ type: "focusMessage", threadId: "pepper-thread", messageId: "sent" });
    await apply(jump!);
    expect(dispatched.some((action) => action.type === "focusMessageConsumed")).toBe(true);
    expect(row("sent")!.lastElementChild!.className).toContain("ring-2");
  });

  it("leaves a result that came with files on its own row", () => {
    expect(row("result2")!.textContent).toContain("Scout replied");
    expect(row("sent2")!.querySelector("[data-bot-conversation-reply]")).toBeNull();
  });
});
