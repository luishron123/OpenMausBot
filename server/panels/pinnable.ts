// Widgets a bot showed in chat (show_widget) that the person can pin to a panel: the newest first, from the chats the
// person can see. Widgets the server built from records (mail, calendar, other bots' work) are not the bot's and are left out.
import type { PanelPinnableBlock } from "../../shared/panels.ts";
import type { WidgetRoot } from "../../shared/widget.ts";
import type { RequestAuth } from "../request-auth.ts";

/** What pinning reads of a chat message. */
export interface PinnableMessage {
  id: string;
  kind: string;
  role: string;
  at: number;
  text?: string;
  widget?: { root: WidgetRoot };
  serverCard?: true;
}

export interface PanelChats {
  bots(): ReadonlyArray<{ id: string; threadId?: string; tasks?: ReadonlyArray<{ threadId: string; createdAt: number; updatedAt?: number }> }>;
  visible(auth: RequestAuth, threadId: string): boolean;
  /** The newest `limit` messages of a chat, oldest first. */
  messages(threadId: string, limit: number): readonly PinnableMessage[];
}

const CHATS_READ = 40;
const MESSAGES_READ = 60;

const pinnableMessage = (message: PinnableMessage) => message.kind === "widget" && message.role === "bot" && !message.serverCard && message.widget?.root;
const titleOf = (text: string | undefined) => (text ?? "").split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 80) || "Widget";

export function createPinnable(chats: PanelChats) {
  /** The chats with recent work, newest first, that this person can see. */
  const recentChats = (auth: RequestAuth) => chats.bots()
    .flatMap((bot) => [
      ...(bot.threadId ? [{ botId: bot.id, threadId: bot.threadId, at: Number.MAX_SAFE_INTEGER }] : []),
      ...(bot.tasks ?? []).map((task) => ({ botId: bot.id, threadId: task.threadId, at: task.updatedAt ?? task.createdAt })),
    ])
    .sort((a, b) => b.at - a.at)
    .filter((chat) => chats.visible(auth, chat.threadId))
    .slice(0, CHATS_READ);

  return {
    list(auth: RequestAuth, limit: number): PanelPinnableBlock[] {
      const blocks: PanelPinnableBlock[] = [];
      for (const chat of recentChats(auth)) {
        for (const message of chats.messages(chat.threadId, MESSAGES_READ)) {
          if (!pinnableMessage(message)) continue;
          blocks.push({ threadId: chat.threadId, messageId: message.id, botId: chat.botId, title: titleOf(message.text), at: new Date(message.at).toISOString(), ...(message.text ? { text: message.text.slice(0, 300) } : {}) });
        }
      }
      return blocks.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
    },
    /** The widget of one message the person can see, with the bot that showed it. */
    find(auth: RequestAuth, threadId: string, messageId: string): { botId: string; root: WidgetRoot; text: string; title: string } | null {
      if (!chats.visible(auth, threadId)) return null;
      const botId = chats.bots().find((bot) => bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId))?.id;
      const message = chats.messages(threadId, 500).find((one) => one.id === messageId);
      if (!botId || !message || !pinnableMessage(message)) return null;
      return { botId, root: message.widget!.root, text: message.text ?? "", title: titleOf(message.text) };
    },
  };
}

export type Pinnable = ReturnType<typeof createPinnable>;
