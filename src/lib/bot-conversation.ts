// One hand-off's own conversation, cut out of the thread that did the work: a bot's thread can hold several.
import type { WireMessage as Message } from "../../shared/wire.ts";
import { isMentionNameContinuation } from "../../shared/mention-boundary.ts";

export interface BotConversationLine {
  id: string;
  from: "requester" | "peer";
  text: string;
  at: number;
}

type ConversationMessage = Pick<Message, "id" | "role" | "kind" | "text" | "at" | "from" | "roomRequest" | "requestMessageId">;

export function withoutMention(text: string, name: string): string {
  const rest = text.slice(1);
  const named = name !== "" && text.startsWith("@") && rest.slice(0, name.length).toLowerCase() === name.toLowerCase()
    && !isMentionNameContinuation(rest.slice(name.length));
  return named ? rest.slice(name.length).trimStart() : text;
}

/** The request and the written answers to it. Tool rows, digests and other requests' lines are left out. */
export function botConversationLines(
  messages: readonly ConversationMessage[],
  handoffId: string,
  peer: { botId: string; name: string },
): BotConversationLine[] {
  const lines: BotConversationLine[] = [];
  const asked = new Set<string>();
  let answering = false;
  for (const m of messages) {
    if (m.roomRequest?.phase === "request") {
      answering = m.roomRequest.id === handoffId;
      if (answering) {
        asked.add(m.id);
        lines.push({ id: m.id, from: "requester", text: withoutMention(m.text ?? "", peer.name), at: m.at });
      }
    } else if (m.role === "user") {
      answering = false;
    } else if (
      m.role === "bot" && m.kind === "text" && m.text?.trim() &&
      (!m.from || m.from.botId === peer.botId) &&
      (m.requestMessageId ? asked.has(m.requestMessageId) : answering)
    ) {
      lines.push({ id: m.id, from: "peer", text: m.text, at: m.at });
    }
  }
  return lines;
}

export function requestSummary(lines: readonly BotConversationLine[]): string {
  const request = lines.find((line) => line.from === "requester")?.text ?? "";
  return (request.split("\n").find((line) => line.trim()) ?? "").replace(/\s+/g, " ").trim();
}

/** Whole minutes or hours a hand-off took; null under a minute, where a duration says nothing. */
export function handoffDuration(startedAt: number, endedAt: number): { unit: "minutes" | "hours"; count: number } | null {
  const minutes = Math.floor((endedAt - startedAt) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return null;
  return minutes < 60 ? { unit: "minutes", count: minutes } : { unit: "hours", count: Math.floor(minutes / 60) };
}

type HandoffRow = Pick<Message, "id" | "handoff" | "threadRef" | "sentDirectly" | "from" | "roomRequest" | "attachments">;

/** Whether a sent row reads as the conversation line: a hand-off from one bot to another bot the reader can see. */
export function showsBotConversation(message: HandoffRow, bots: readonly { id: string }[]): boolean {
  const ref = message.threadRef, sender = message.from;
  return Boolean(message.handoff && ref && sender && !message.sentDirectly && sender.botId !== ref.botId && bots.some((bot) => bot.id === ref.botId));
}

/** The hand-off row that already speaks for this result as a conversation line, among the rows loaded with it. A result
 *  that carries files keeps its own row, and so does one whose request is not on the page. */
export function handoffLineOf<Row extends HandoffRow>(result: HandoffRow, messages: readonly Row[], bots: readonly { id: string }[]): Row | undefined {
  const request = result.roomRequest;
  if (request?.phase !== "result" || result.attachments?.length) return undefined;
  return messages.find((message) => message.handoff?.id === request.id && showsBotConversation(message, bots));
}

/** The result row a conversation line stands in for: what the teammate handed back, already delivered to this chat. */
export function handoffResultOf<Row extends HandoffRow>(line: HandoffRow, messages: readonly Row[], bots: readonly { id: string }[]): Row | undefined {
  const id = line.handoff?.id;
  if (!id || !showsBotConversation(line, bots)) return undefined;
  return messages.find((message) => message.roomRequest?.phase === "result" && message.roomRequest.id === id && !message.attachments?.length);
}
