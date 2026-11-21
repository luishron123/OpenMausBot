// A hand-off to another bot as one quiet line in the chat that sent it: who helps whom, how it stands, and the way in.
import { useState } from "react";
import type { HandoffStatusLine } from "../../shared/handoff-status";
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

export function BotConversationRow({ handoff, startedAt, threadId, requester, peer, onOpenThread }: {
  handoff: HandoffStatusLine;
  startedAt: number;
  threadId: string;
  requester: ConversationBot;
  peer: ConversationBot & { id: string };
  onOpenThread: () => void;
}) {
  const [open, setOpen] = useState(false);
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
      <BotConversationStatus line={handoff} startedAt={startedAt} />
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
