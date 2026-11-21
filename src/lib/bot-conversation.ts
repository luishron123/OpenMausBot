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

/** The chat without the result rows whose hand-off already has its conversation line; a result that carries files stays. */
export function withoutShownHandoffResults<Row extends HandoffRow>(messages: Row[], bots: readonly { id: string }[]): Row[] {
  const shown = new Set(messages.filter((message) => showsBotConversation(message, bots)).map((message) => message.handoff!.id));
  if (!shown.size) return messages;
  return messages.filter((message) => !(message.roomRequest?.phase === "result" && shown.has(message.roomRequest.id) && !message.attachments?.length));
}
