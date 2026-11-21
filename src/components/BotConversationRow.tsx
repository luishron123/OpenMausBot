// A hand-off to another bot as one quiet line in the chat that sent it: who helps whom, how it stands, and the way in.
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { HandoffStatusLine } from "../../shared/handoff-status";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BotAvatar } from "./Avatar";
import { BotConversationDialog, BotConversationStatus, type ConversationBot } from "./BotConversationDialog";

const PEER = "{peer}", REQUESTER = "{requester}";

function Name({ bot }: { bot: ConversationBot }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <BotAvatar bot={bot} state="happy" size={16} motion="none" motionKey={0} animated={false} />
      <span className="min-w-0 truncate font-semibold text-ink">{bot.name}</span>
    </span>
  );
}

export function BotConversationRow({ handoff, startedAt, threadId, requester, peer, reply, onOpenThread }: {
  handoff: HandoffStatusLine;
  startedAt: number;
  threadId: string;
  requester: ConversationBot;
  peer: ConversationBot & { id: string };
  /** What the teammate handed back, as this chat already received it: readable here even when their conversation is not. */
  reply?: string;
  onOpenThread: () => void;
}) {
  const [open, setOpen] = useState(false), [replyShown, setReplyShown] = useState(false);
  // The sentence's word order belongs to the language, so the names are placed where its translation puts them.
  const sentence = t("chat.botConversation.helping", { peer: PEER, requester: REQUESTER }).split(/(\{peer\}|\{requester\})/);
  return (
    <span data-bot-conversation-row={handoff.id} className="flex min-w-0 max-w-full flex-col gap-1">
      <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-secondary">
        {sentence.map((part, index) => part === PEER ? <Name key={index} bot={peer} />
          : part === REQUESTER ? <Name key={index} bot={requester} />
          : part.trim() ? <span key={index}>{part.trim()}</span> : null)}
        <span aria-hidden="true" className="text-ink-tertiary">·</span>
        <button type="button" data-bot-conversation-open={threadId} aria-haspopup="dialog" className="ui-pill" onClick={() => setOpen(true)}>
          {t("chat.botConversation.view")}
        </button>
      </span>
      <span className="flex min-w-0 max-w-full items-center gap-2">
        <BotConversationStatus line={handoff} startedAt={startedAt} />
        {reply && (
          <button type="button" data-bot-conversation-reply={handoff.id} aria-expanded={replyShown} onClick={() => setReplyShown((shown) => !shown)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded py-0.5 text-[12px] leading-4 text-ink-secondary underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            {t("chat.botConversation.reply")}
            <ChevronRight size={12} aria-hidden="true" className={cn(replyShown && "rotate-90")} />
          </button>
        )}
      </span>
      {reply && replyShown && (
        <span dir="auto" data-bot-conversation-reply-text className="block max-h-80 w-fit max-w-[min(38rem,100%)] overflow-auto rounded-xl border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] whitespace-pre-wrap break-words text-ink">{reply}</span>
      )}
      {open && (
        <BotConversationDialog threadId={threadId} handoff={handoff} startedAt={startedAt} requester={requester} peer={peer}
          onClose={() => setOpen(false)}
          onOpenThread={() => { setOpen(false); onOpenThread(); }}
          onTalk={() => {
            setOpen(false);
            requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
          }} />
      )}
    </span>
  );
}
