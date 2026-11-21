import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { HandoffStatusLine } from "../../shared/handoff-status";
import type { BotConversationState } from "@/state/bot-conversation";
import type { Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { BotConversationStatus, BotConversationView, botConversationStatusText } from "./BotConversationDialog";

const pepper = { id: "pepper", name: "Pepper", color: "blue" as const };
const engineer = { id: "engineer", name: "Engineer", color: "green" as const };
const line = (extra: Partial<HandoffStatusLine> = {}): HandoffStatusLine => ({ id: "h1", state: "working", at: 1_000, ...extra });
const request: Message = { id: "r1", role: "bot", kind: "text", at: 1_000, text: "@Engineer Check the export.\nTell me about the totals row.",
  from: { botId: "pepper", name: "Pepper", color: "blue" }, roomRequest: { id: "h1", phase: "request" } };
const answer: Message = { id: "a1", role: "bot", kind: "text", at: 2_000, text: "The export is right." };
const other: Message = { id: "r2", role: "bot", kind: "text", at: 3_000, text: "@Engineer A different request, not shown.",
  from: { botId: "pepper", name: "Pepper", color: "blue" }, roomRequest: { id: "h2", phase: "request" } };
const held = (status: BotConversationState["status"], ...messages: Message[]): BotConversationState => ({ threadId: "t", loadId: 1, status, messages, pending: {} });

function view(conversation: BotConversationState | null, handoff = line()) {
  return renderToStaticMarkup(createElement(BotConversationView, {
    conversation, handoff, startedAt: 1_000, requester: pepper, peer: engineer, titleId: "title",
    onClose: () => {}, onOpenThread: () => {}, onTalk: () => {},
  }));
}

beforeEach(() => { setLocale("en"); });

describe("BotConversationStatus", () => {
  it("reads each state in plain words", () => {
    expect(botConversationStatusText(line({ state: "claimed" }), 0)).toBe("Claimed");
    expect(botConversationStatusText(line(), 0)).toBe("Working");
    expect(botConversationStatusText(line({ state: "waiting", waitingOn: { kind: "bot", name: "Scout" } }), 0)).toBe("Waiting on Scout");
    expect(botConversationStatusText(line({ state: "done" }), 1_000)).toBe("Done");
    expect(botConversationStatusText(line({ state: "failed", why: "the upload was refused" }), 0)).toBe("Failed: the upload was refused");
  });

  it("gives a finished hand-off its duration once it took a minute", () => {
    expect(botConversationStatusText(line({ state: "done", at: 181_000 }), 1_000)).toBe("Done in 3 min");
    expect(botConversationStatusText(line({ state: "done", at: 2 * 3_600_000 + 1_000 }), 1_000)).toBe("Done in 2 h");
    expect(botConversationStatusText(line({ state: "failed", why: "it broke", at: 181_000 }), 1_000)).toBe("Failed: it broke");
  });

  it("calls a stopped hand-off stopped, never failed, and names nobody", () => {
    const stopped = line({ state: "failed", why: "Stopped", stopped: true, at: 61_000 });
    expect(botConversationStatusText(stopped, 1_000)).toBe("Stopped after 1 min");
    expect(botConversationStatusText({ ...stopped, at: 1_500 }, 1_000)).toBe("Stopped");
    const html = renderToStaticMarkup(createElement(BotConversationStatus, { line: stopped, startedAt: 1_000 }));
    expect(html).toContain('data-handoff-status="stopped"');
    expect(html).not.toContain("text-danger");
    expect(html).not.toContain("Failed");
  });

  it("keeps a failure in the danger colour and says whose request it is on a team", () => {
    const html = renderToStaticMarkup(createElement(BotConversationStatus, { line: line({ state: "failed", why: "it broke" }), startedAt: 0 }));
    expect(html).toContain('data-handoff-status="failed"');
    expect(html).toContain("text-danger");
    expect(botConversationStatusText(line({ state: "done", forPerson: { name: "Ana" } }), 1_000)).toBe("Done · for Ana");
  });

  it("ends work in someone else's private chat as a plain failure: no reason, no stop, no duration", () => {
    const hidden = line({ state: "failed", at: 181_000, forPerson: { name: "Ana", private: true } });
    expect(botConversationStatusText(hidden, 1_000)).toBe("Failed · for Ana (private)");
    // A server that predates the rule may still send the mark; the reader must not learn it.
    const marked = { ...hidden, stopped: true as const };
    expect(botConversationStatusText(marked, 1_000)).toBe("Failed · for Ana (private)");
    const html = renderToStaticMarkup(createElement(BotConversationStatus, { line: marked, startedAt: 1_000 }));
    expect(html).toContain('data-handoff-status="failed"');
    expect(html).not.toContain("Stopped");
    expect(html).not.toContain(" min<");
  });

  it("speaks Portuguese", () => {
    setLocale("pt-br");
    expect(botConversationStatusText(line({ state: "failed", stopped: true, at: 61_000 }), 1_000)).toBe("Parado após 1 min");
    expect(botConversationStatusText(line(), 0)).toBe("Trabalhando");
  });
});

describe("BotConversationView", () => {
  it("titles the dialog with both bots and the request on one line, without the mention", () => {
    const html = view(held("ready", request, answer, other));
    expect(html).toContain('<h2 id="title"');
    expect(html).toContain("Pepper ⇄ Engineer");
    expect(html).toMatch(/data-bot-conversation-request[^>]*>Check the export\.</);
    expect(html).toContain("Pepper made a request to Engineer · ");
  });

  it("shows only this hand-off's messages, each under its bot's name", () => {
    const html = view(held("ready", request, answer, other));
    expect(html.match(/data-from="requester"/g)).toHaveLength(1);
    expect(html.match(/data-from="peer"/g)).toHaveLength(1);
    expect(html).toContain("The export is right.");
    expect(html).not.toContain("A different request");
  });

  it("marks the day the conversation happened", () => {
    const now = Date.now();
    expect(view(held("ready", { ...request, at: now }, { ...answer, at: now })).match(/Today/g)).toHaveLength(1);
  });

  it("counts messages in the singular and the plural", () => {
    expect(view(held("ready", request))).toContain("Conversation between bots · 1 message<");
    expect(view(held("ready", request, answer))).toContain("Conversation between bots · 2 messages<");
    setLocale("pt-br");
    expect(view(held("ready", request))).toContain("Conversa entre bots · 1 mensagem<");
    expect(view(held("ready", request, answer))).toContain("Conversa entre bots · 2 mensagens<");
  });

  it("ends on the hand-off's state and a read-only footer that points at the requester", () => {
    const html = view(held("ready", request, answer), line({ state: "done" }));
    expect(html).toContain('data-handoff-status="done"');
    expect(html).toContain("Read only. To change course, talk to Pepper.");
    expect(html).toMatch(/data-bot-conversation-talk[^>]*>Talk to Pepper</);
    expect(html).toMatch(/data-bot-conversation-thread[^>]*>Open thread</);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<input");
  });

  it("shows only the header and the state of a conversation that cannot be read", () => {
    const html = view(held("denied"), line({ state: "failed", stopped: true }));
    expect(html).toContain("Pepper ⇄ Engineer");
    expect(html).toContain("You can&#x27;t open this conversation.");
    expect(html).toContain('data-handoff-status="stopped"');
    expect(html).toContain(">Conversation between bots<");
    expect(html).not.toContain("data-from=");
    expect(html).not.toContain("data-bot-conversation-request");
    expect(html).not.toContain("data-bot-conversation-thread");
    expect(html).not.toContain("made a request");
    expect(html).toContain("Talk to Pepper");
  });

  it("says only that private work failed when its conversation cannot be read", () => {
    const html = view(held("denied"), line({ state: "failed", at: 181_000, forPerson: { name: "Ana", private: true } }));
    expect(html).toContain("You can&#x27;t open this conversation.");
    expect(html).toMatch(/data-handoff-status="failed"[^>]*>(<span[^>]*><\/span>)?<span[^>]*>Failed · for Ana \(private\)</);
    expect(html).not.toContain("Failed:");
    expect(html).not.toContain("Stopped");
    expect(html).not.toContain("data-from=");
    expect(html).not.toContain("data-bot-conversation-thread");
  });

  it("says it is loading before the thread arrives", () => {
    const html = view(null);
    expect(html).toContain("Loading…");
    expect(html).not.toContain("data-from=");
  });
});
