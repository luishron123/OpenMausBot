import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), showThreads: true }));
const scout: Bot = {
  id: "scout", threadId: "scout-main", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [
    { threadId: "scout-main", title: "Main", createdAt: 1 },
    { threadId: "qa-245", title: "QA PR 245", createdAt: 2, openedBy: { botId: "ada", name: "Ada", at: 2 } },
  ],
};
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: [scout] }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
import { ThreadChip } from "./ThreadChip";

const receipt = (threadId = "qa-245"): Message => ({
  id: "receipt", role: "bot", kind: "activity", at: 3,
  tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
  threadRef: { botId: "scout", threadId, title: "QA PR 245" },
});

type ElementProps = { children?: ReactNode; onClick?: () => void; [key: string]: unknown };
function findElement(tree: ReactNode, attribute: string): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (attribute in child.props) return child;
    const found = findElement(child.props.children, attribute);
    if (found) return found;
  }
}

beforeEach(() => { fixture.dispatch.mockClear(); fixture.showThreads = true; });

describe("ThreadChip", () => {
  it("renders the receipt as a pill named for the thread it opens", () => {
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }));
    expect(markup).toContain("<button");
    expect(markup).toContain("Opened thread #QA PR 245 on Scout");
    expect(markup).toContain('title="Open #QA PR 245"');
    expect(markup).toContain('data-thread-chip="qa-245"');
  });

  it("says in the person's words that work addressed into a room went to a bot outside it directly", () => {
    const sent = (sentDirectly: Message["sentDirectly"]) => renderToStaticMarkup(createElement(ThreadChip, {
      message: { ...receipt(), tool: { name: "server English", ok: true }, sentDirectly },
    }));
    expect(sent({ name: "Scout" })).toContain("Sent to Scout directly: it isn&#x27;t in this room.");
    expect(sent({ name: "Scout", room: "Sales" })).toContain("Sent to Scout directly: it isn&#x27;t in Sales.");
    expect(sent({ name: "Scout" })).not.toContain("server English");
  });

  it("renders nothing without a thread reference", () => {
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: { ...receipt(), threadRef: undefined } }))).toBe("");
  });

  it("clicking shows that thread: select the bot, switch the view, reveal the row", () => {
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt() }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "switchTask", botId: "scout", threadId: "qa-245" },
      { type: "revealThread", threadId: "qa-245" },
    ]);
  });

  it("with threads hidden, the switch alone shows it, so the thread the bot was on stays unread", () => {
    fixture.showThreads = false;
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt() }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "switchTask", botId: "scout", threadId: "qa-245" },
      { type: "revealThread", threadId: "qa-245" },
    ]);
  });

  it("falls back to the bot with a notice when the thread was deleted", () => {
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt("gone") }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "revealThread", threadId: "gone" },
      { type: "notice", notice: { kind: "thread-gone", botName: "Scout" } },
    ]);
  });

  it("marks the receipt when the work in that thread failed", () => {
    const failed = renderToStaticMarkup(createElement(ThreadChip, {
      message: { ...receipt(), tool: { name: "Scout — cancelled: stopped by the person", ok: false } },
    }));
    expect(failed).toContain("Scout — cancelled: stopped by the person");
    expect(failed).toMatch(/<button[^>]*class="[^"]*text-danger/);
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }))).not.toContain("text-danger");
  });

  const sent = (extra: Partial<Message> = {}): Message => ({
    ...receipt(), tool: { name: "Sent to Scout", ok: true }, from: { botId: "ada", name: "Ada", color: "blue" },
    handoff: { id: "h1", state: "working", at: 4 }, ...extra,
  });

  it("shows a hand-off to another bot as one line with a way into the conversation, not a pill out of the chat", () => {
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: sent() }));
    expect(markup).toContain('data-bot-conversation-row="h1"');
    expect(markup).toContain('data-bot-conversation-open="qa-245"');
    expect(markup).toContain("View conversation");
    expect(markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Scout helping Ada");
    expect(markup).toContain('data-handoff-status="working"');
    expect(markup).not.toContain("data-thread-chip");
    expect(markup).not.toContain("Sent to Scout");
  });

  it("keeps what the request asked for under the line", () => {
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: sent({ doneWhen: "the totals add up" }) }));
    expect(markup).toContain("data-handoff-done-when");
    expect(markup).toContain("the totals add up");
  });

  it("keeps the pill that says work left the room, so that sentence is not lost", () => {
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: sent({ sentDirectly: { name: "Scout" } }) }));
    expect(markup).toContain("Sent to Scout directly");
    expect(markup).toContain('data-handoff-status="working"');
    expect(markup).not.toContain("data-bot-conversation-row");
  });

  it("keeps the pill for a bot's own thread and for a bot this person cannot see", () => {
    const own = renderToStaticMarkup(createElement(ThreadChip, { message: sent({ from: { botId: "scout", name: "Scout", color: "green" } }) }));
    const unseen = renderToStaticMarkup(createElement(ThreadChip, { message: sent({ threadRef: { botId: "hidden", threadId: "x", title: "X" } }) }));
    for (const markup of [own, unseen]) {
      expect(markup).toContain("data-thread-chip");
      expect(markup).not.toContain("data-bot-conversation-row");
    }
  });
});
