// "View conversation": one hand-off between two bots, read only, in a dialog over the chat that asked for it.
import { Fragment, useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import type { HandoffStatusLine } from "../../shared/handoff-status";
import { closeBotConversation, openBotConversation, useBotConversation, type BotConversationState } from "@/state/bot-conversation";
import { formatTime, type Bot } from "@/state/store";
import { botConversationLines, handoffDuration, requestSummary, type BotConversationLine } from "@/lib/bot-conversation";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { MAUS_COLORS } from "@/lib/mascot";
import { localDay } from "@/lib/transcript-derivations";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { ChatMarkdown } from "./ChatMarkdown";
import { DaySeparator } from "./DaySeparator";
import { handoffStateText, handoffStatusText } from "./HandoffStatusChip";

export type ConversationBot = Pick<Bot, "name" | "color"> & Partial<Bot>;

/** Work in someone else's private chat ends as a plain failure for its readers: neither why nor that it was stopped. */
function wasStopped(line: HandoffStatusLine): boolean {
  return Boolean(line.stopped) && !line.forPerson?.private;
}

/** Who stopped a hand-off is not recorded, so a stopped one names nobody. */
export function botConversationStatusText(line: HandoffStatusLine, startedAt: number): string {
  const stopped = wasStopped(line);
  const took = line.state === "done" || stopped ? handoffDuration(startedAt, line.at) : null;
  const duration = took && t(took.unit === "hours" ? "chat.botConversation.hours" : "chat.botConversation.minutes", { count: took.count });
  if (stopped) return handoffStatusText(line, duration ? t("chat.botConversation.stoppedAfter", { duration }) : t("chat.botConversation.stopped"));
  if (line.state === "done" && duration) return handoffStatusText(line, t("chat.botConversation.doneIn", { duration }));
  return handoffStatusText(line, handoffStateText(line));
}

const TONE: Record<HandoffStatusLine["state"], string> = {
  claimed: "bg-ink-tertiary",
  working: "bg-accent",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-danger",
};

export function BotConversationStatus({ line, startedAt, wrap = false }: { line: HandoffStatusLine; startedAt: number; wrap?: boolean }) {
  const text = botConversationStatusText(line, startedAt), stopped = wasStopped(line);
  const failed = line.state === "failed" && !stopped;
  return (
    <span data-handoff-status={stopped ? "stopped" : line.state} title={wrap ? undefined : text} role="status"
      className={cn("flex min-w-0 max-w-full gap-1.5 text-[12px] leading-4 text-ink-secondary", wrap ? "items-start" : "items-center", failed && "text-danger")}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", wrap && "mt-1", stopped ? "bg-ink-tertiary" : TONE[line.state],
        line.state === "working" && "animate-pulse motion-reduce:animate-none")} />
      <span className={cn("min-w-0", wrap ? "[overflow-wrap:anywhere]" : "truncate")}>{text}</span>
    </span>
  );
}

function nameStyle(bot: ConversationBot) {
  return Object.hasOwn(MAUS_COLORS, bot.color) && bot.color !== "chrome"
    ? { color: `color-mix(in srgb, ${MAUS_COLORS[bot.color]} 55%, var(--color-ink))` } : undefined;
}

function Face({ bot, size }: { bot: ConversationBot; size: number }) {
  return <BotAvatar bot={bot} state="happy" size={size} motion="none" motionKey={0} animated={false} />;
}

function Bubble({ line, bot }: { line: BotConversationLine; bot: ConversationBot }) {
  return (
    <li data-from={line.from} className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <Face bot={bot} size={16} />
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink-secondary" style={nameStyle(bot)}>{bot.name}</span>
        <time className="shrink-0 text-[12px] font-medium text-ink-tertiary">{formatTime(line.at)}</time>
      </div>
      <div dir="auto" className={cn("w-fit min-w-0 max-w-full rounded-4xl px-3 py-2 text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]",
        line.from === "requester" ? "bg-menu-active" : "bg-inset")}>
        <ChatMarkdown text={line.text} />
      </div>
    </li>
  );
}

export interface BotConversationProps {
  handoff: HandoffStatusLine;
  /** When the request went out: the "Sent to" row's own time. */
  startedAt: number;
  requester: ConversationBot;
  peer: ConversationBot & { id: string };
  onClose: () => void;
  onOpenThread: () => void;
  onTalk: () => void;
}

export function BotConversationView({ conversation, handoff, startedAt, requester, peer, onClose, onOpenThread, onTalk, titleId }:
  BotConversationProps & { conversation: BotConversationState | null; titleId: string }) {
  const status = conversation?.status ?? "loading";
  const lines = useMemo(() => status === "ready" ? botConversationLines(conversation?.messages ?? [], handoff.id, { botId: peer.id, name: peer.name }) : [],
    [conversation?.messages, status, handoff.id, peer.id, peer.name]);
  const summary = requestSummary(lines);
  const today = localDay(Date.now());
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [lines.length, handoff.state]);
  return (
    <>
      <header className="flex items-start gap-3 px-5 pb-3 pt-4">
        <span aria-hidden="true" className="flex shrink-0 items-center pt-0.5">
          <Face bot={requester} size={28} />
          <span className="-ms-2 flex"><Face bot={peer} size={28} /></span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-[20px] font-semibold tracking-[-0.01em]">{t("chat.botConversation.title", { requester: requester.name, peer: peer.name })}</h2>
          {summary && <p dir="auto" data-bot-conversation-request className="truncate text-[13px] text-ink-secondary">{summary}</p>}
          <p data-bot-conversation-count className="text-[12px] leading-4 text-ink-tertiary">
            {status !== "ready" ? t("chat.botConversation.kind")
              : t(lines.length === 1 ? "chat.botConversation.count.one" : "chat.botConversation.count", { count: lines.length })}
          </p>
        </div>
        <button type="button" onClick={onClose} title={t("common.close")} aria-label={t("common.close")} className="ui-icon-button shrink-0">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="ui-modal-divider shrink-0" />
      <div ref={bodyRef} data-bot-conversation-body className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {status === "denied" ? <p data-bot-conversation-denied className="text-[13px] text-ink-secondary">{t("chat.botConversation.denied")}</p> : (
          <>
            <p className="text-center text-[12px] leading-4 text-ink-tertiary">
              {t("chat.botConversation.requested", { requester: requester.name, peer: peer.name, time: formatTime(lines[0]?.at ?? startedAt) })}
            </p>
            {status === "loading" ? (
              <p role="status" className="flex items-center justify-center gap-2 text-[13px] text-ink-secondary">
                <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />{t("chat.botConversation.loading")}
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {lines.map((line, index) => (
                  <Fragment key={line.id}>
                    {(index === 0 || localDay(line.at) !== localDay(lines[index - 1]!.at)) && <li><DaySeparator at={line.at} today={today} simple /></li>}
                    <Bubble line={line} bot={line.from === "requester" ? requester : peer} />
                  </Fragment>
                ))}
              </ol>
            )}
          </>
        )}
        <BotConversationStatus line={handoff} startedAt={startedAt} wrap />
      </div>
      <div className="ui-modal-divider shrink-0" />
      <footer className="flex flex-wrap items-center justify-end gap-2 px-5 py-3">
        <p className="min-w-[160px] flex-1 text-[12px] leading-4 text-ink-secondary">{t("chat.botConversation.readOnly", { name: requester.name })}</p>
        {status !== "denied" && <button type="button" data-bot-conversation-thread className="ui-button ui-button-md" onClick={onOpenThread}>{t("chat.botConversation.openThread")}</button>}
        <button type="button" data-bot-conversation-talk className="ui-button ui-button-md ui-button-primary" onClick={onTalk}>{t("chat.botConversation.talkTo", { name: requester.name })}</button>
      </footer>
    </>
  );
}

export function BotConversationDialog({ threadId, ...props }: BotConversationProps & { threadId: string }) {
  const { onClose } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalDialog(dialogRef, onClose);
  const titleId = useId();
  const held = useBotConversation();
  const conversation = held?.threadId === threadId ? held : null;
  useEffect(() => {
    openBotConversation(threadId);
    return closeBotConversation;
  }, [threadId]);
  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-bot-conversation={threadId}
        className="ui-modal flex max-h-full w-full max-w-[560px] flex-col text-ink shadow-2xl outline-none animate-pop-in motion-reduce:animate-none">
        <BotConversationView {...props} conversation={conversation} titleId={titleId} />
      </div>
    </div>,
    document.body,
  );
}
