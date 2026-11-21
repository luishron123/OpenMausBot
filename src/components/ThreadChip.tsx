import { use } from "react";
import { ChevronRight, MessagesSquare } from "lucide-react";
import { openThread, useStore, type Message } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { activityText } from "@/lib/activity-text";
import { cn } from "@/lib/cn";
import { handoffLineOf, handoffResultOf, showsBotConversation } from "@/lib/bot-conversation";
import { BotAvatar } from "./Avatar";
import { BotConversationRow } from "./BotConversationRow";
import { HandoffReply } from "./HandoffReply";
import { HandoffStatusChip } from "./HandoffStatusChip";
import { PeerMessagesContext } from "./PeerExchange";

export function ThreadChip({ message, threadId, conversation = false }: {
  message: Message;
  threadId?: string;
  /** The delegating bot's own chat, where a hand-off reads as a line with its conversation; a room keeps the pill. */
  conversation?: boolean;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads(), transcript = use(PeerMessagesContext);
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  // The result of a hand-off drawn as a conversation line is read from that line: the row stays in the list, so a search
  // jump and the unread divider still find it, and says where it went.
  const line = conversation ? handoffLineOf(message, transcript, state.bots) : undefined;
  if (line) return <span hidden data-shown-in={line.id} />;
  const bot = state.bots.find((candidate) => candidate.id === ref.botId);
  const direct = message.sentDirectly;
  const label = !direct ? activityText(tool, tool.name)
    : direct.room ? t("chat.sentDirectlyNotInRoom", { name: direct.name, room: direct.room }) : t("chat.sentDirectly", { name: direct.name });
  const sender = message.from;
  const requester = state.bots.find((candidate) => candidate.id === sender?.botId) ?? sender;
  if (conversation && message.handoff && bot && requester && showsBotConversation(message, state.bots)) {
    return (
      <HandoffReply message={message} threadId={threadId}>
        <BotConversationRow handoff={message.handoff} startedAt={message.at} threadId={ref.threadId} requester={requester} peer={bot}
          reply={handoffResultOf(message, transcript, state.bots)?.tool?.output?.trim() || undefined}
          onOpenThread={() => openThread(dispatch, ref, state, showThreads)} />
      </HandoffReply>
    );
  }
  return (
    <HandoffReply message={message} threadId={threadId}>
      <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        data-thread-chip={ref.threadId}
        onClick={() => openThread(dispatch, ref, state, showThreads)}
        title={t("chat.openThread", { title: ref.title })}
        className={cn("ui-pill", tool.ok === false && "text-danger")}
      >
        {bot ? <BotAvatar bot={bot} state="happy" size={16} animated={false} /> : <MessagesSquare size={13} aria-hidden="true" />}
        <span className="max-w-[480px] truncate">{label}</span>
        <ChevronRight size={13} />
      </button>
      {message.handoff && <HandoffStatusChip line={message.handoff} />}
      </span>
    </HandoffReply>
  );
}
