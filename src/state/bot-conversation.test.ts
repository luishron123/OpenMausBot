import { afterEach, describe, expect, it } from "vitest";
import { closeBotConversation, heldBotConversation, noteBotConversationFrame, openBotConversation, reduceBotConversation, type BotConversationState } from "./bot-conversation";
import type { Message } from "./store";

const row = (id: string, text = id): Message => ({ id, role: "bot", kind: "text", text, at: 1 });
const open = (): BotConversationState => reduceBotConversation(null, { type: "open", threadId: "t", loadId: 1 })!;
const ready = (...messages: Message[]) => reduceBotConversation(open(), { type: "loaded", threadId: "t", loadId: 1, messages })!;

describe("reduceBotConversation", () => {
  it("opens loading and holds the loaded thread", () => {
    expect(open()).toEqual({ threadId: "t", loadId: 1, messages: [], status: "loading" });
    expect(ready(row("a"), row("b"))).toMatchObject({ status: "ready", messages: [row("a"), row("b")] });
  });

  it("ignores a load that belongs to an earlier opening or another thread", () => {
    const state = open();
    expect(reduceBotConversation(state, { type: "loaded", threadId: "t", loadId: 0, messages: [row("a")] })).toBe(state);
    expect(reduceBotConversation(state, { type: "loaded", threadId: "other", loadId: 1, messages: [row("a")] })).toBe(state);
    expect(reduceBotConversation(state, { type: "loadFailed", threadId: "t", loadId: 0 })).toBe(state);
  });

  it("keeps the live copy of a row that arrived while loading, and rows the load did not have", () => {
    let state = open();
    state = reduceBotConversation(state, { type: "message", threadId: "t", message: row("b", "live") })!;
    state = reduceBotConversation(state, { type: "message", threadId: "t", message: row("c") })!;
    state = reduceBotConversation(state, { type: "loaded", threadId: "t", loadId: 1, messages: [row("a"), row("b", "stale")] })!;
    expect(state.messages).toEqual([row("a"), row("b", "live"), row("c")]);
  });

  it("appends a new message and replaces a patched one", () => {
    let state = ready(row("a"));
    state = reduceBotConversation(state, { type: "message", threadId: "t", message: row("b") })!;
    state = reduceBotConversation(state, { type: "message", threadId: "t", message: row("a", "edited"), patch: true })!;
    expect(state.messages).toEqual([row("a", "edited"), row("b")]);
  });

  it("does not add a patched row the loaded thread does not hold, nor another thread's rows", () => {
    const state = ready(row("a"));
    expect(reduceBotConversation(state, { type: "message", threadId: "t", message: row("z"), patch: true })).toBe(state);
    expect(reduceBotConversation(state, { type: "message", threadId: "other", message: row("z") })).toBe(state);
  });

  it("holds nothing of a thread that could not be read, live rows included", () => {
    let state = reduceBotConversation(open(), { type: "message", threadId: "t", message: row("early") })!;
    state = reduceBotConversation(state, { type: "loadFailed", threadId: "t", loadId: 1 })!;
    expect(state).toMatchObject({ status: "denied", messages: [] });
    expect(reduceBotConversation(state, { type: "message", threadId: "t", message: row("later") })).toBe(state);
  });

  it("closes", () => {
    expect(reduceBotConversation(ready(row("a")), { type: "close" })).toBeNull();
  });
});

describe("the open conversation", () => {
  afterEach(closeBotConversation);
  const loaded = async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); };

  it("loads on opening and then takes its thread's message frames only", async () => {
    openBotConversation("t", async () => ({ messages: [row("a")], activeLeafId: null }));
    expect(heldBotConversation()).toMatchObject({ threadId: "t", status: "loading" });
    await loaded();
    noteBotConversationFrame({ kind: "message", threadId: "t", message: row("b") });
    noteBotConversationFrame({ kind: "message.patch", threadId: "t", message: row("a", "edited") });
    noteBotConversationFrame({ kind: "message", threadId: "other", message: row("stray") });
    noteBotConversationFrame({ kind: "bot", threadId: "t", message: row("not a message frame") });
    expect(heldBotConversation()).toMatchObject({ status: "ready", messages: [row("a", "edited"), row("b")] });
  });

  it("shows nothing of a thread whose read was refused, whatever arrives later", async () => {
    openBotConversation("t", () => Promise.reject(new Error("404")));
    await loaded();
    noteBotConversationFrame({ kind: "message", threadId: "t", message: row("b") });
    expect(heldBotConversation()).toMatchObject({ status: "denied", messages: [] });
  });

  it("drops a late answer to an earlier opening, and everything once closed", async () => {
    let finish!: (value: { messages: Message[]; activeLeafId: string | null }) => void;
    openBotConversation("t", () => new Promise((resolve) => { finish = resolve; }));
    openBotConversation("t", () => new Promise(() => {}));
    finish({ messages: [row("stale")], activeLeafId: null });
    await loaded();
    expect(heldBotConversation()).toMatchObject({ status: "loading", messages: [] });
    closeBotConversation();
    noteBotConversationFrame({ kind: "message", threadId: "t", message: row("after close") });
    expect(heldBotConversation()).toBeNull();
  });
});
