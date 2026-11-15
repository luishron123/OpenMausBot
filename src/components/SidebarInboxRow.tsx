// The one Inbox row at the top of the sidebar, on every plan and with no account: shaped like a bot's row, with what waits
// on the person as its count and a dot while any bot is at work. It stays when nothing waits, with no count. The
// conversations that wait on them (a question, an approval, a reply not yet read) open under it, each going where it is.
import { BellDot, ChevronDown, ChevronRight, CircleAlert, Inbox } from "lucide-react";
import { useId, useState } from "react";
import type { InboxView } from "../../shared/inbox";
import type { NeedsYouItem } from "../../shared/today";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { closeInbox, openInbox, useInboxPanel, useInboxSupport, useInboxView } from "@/state/inbox";
import { useTeamPeople } from "@/state/team-people";
import { localizedTaskTitle } from "@/lib/task-title";
import { inboxFixes, waitingCount } from "./inbox/inbox-view";
import { attentionOwnerName, type AttentionThread } from "./SidebarBotActivity";

/** The conversations resting on the person: a bot asked them something there, or answered and was not read. */
export const waitingOnPerson = (attention: readonly AttentionThread[]): AttentionThread[] =>
  attention.filter((entry) => entry.task.activity === "waiting-on-you" || entry.task.unread === true);

/** Those of them neither a line of the inbox nor something to fix already counts. */
export function uncountedWaiting(waiting: readonly AttentionThread[], view: InboxView | null, fixes: readonly NeedsYouItem[] = []): number {
  const counted = new Set([
    ...(view?.rows ?? []).filter((row) => row.tab === "needs-you" || (row.tab === "info" && row.unread)).map((row) => row.origin?.threadId),
    ...fixes.map((item) => item.threadId),
  ]);
  return waiting.filter((entry) => !counted.has(entry.task.threadId)).length;
}

export function SidebarInboxRow({ icons, large, running, attention, onJump, onOpened }: {
  icons: boolean;
  /** Simple's row, sized as its bots' rows are. */
  large: boolean;
  running: boolean;
  attention: readonly AttentionThread[];
  onJump: (entry: AttentionThread) => void;
  onOpened?: () => void;
}) {
  const support = useInboxSupport();
  const view = useInboxView();
  const team = useTeamPeople();
  const { open } = useInboxPanel();
  const [listed, setListed] = useState(false);
  const listId = useId();
  if (support === "no") return null;
  const waiting = waitingOnPerson(attention);
  const fixes = inboxFixes(team?.needsYou, view);
  const count = waitingCount(view) + fixes.length + uncountedWaiting(waiting, view, fixes);
  const shown = count > 9 ? "9+" : String(count);
  const label = count > 0 ? t("inbox.row.count", { count }) : t("inbox.panel.title");
  const toggle = () => {
    if (open) closeInbox();
    else { openInbox(); onOpened?.(); }
  };
  const dot = running && <span data-inbox-running="" aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-panel bg-success", icons ? "size-3" : "size-2.5")} />;
  if (icons) {
    return (
      <button type="button" data-sidebar-inbox={count} aria-label={label} title={label} aria-pressed={open} onClick={toggle}
        className={cn("relative mx-auto mb-1 flex size-[46px] shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus", open && "bg-raised text-ink")}>
        <Inbox size={20} strokeWidth={1.5} aria-hidden="true" />
        {count > 0 && <span aria-hidden="true" data-inbox-count className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-warning px-0.5 text-[10px] font-semibold leading-4 text-panel">{shown}</span>}
        {dot}
      </button>
    );
  }
  const expanded = listed && waiting.length > 0;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const disclose = t(expanded ? "sidebar.section.collapse" : "sidebar.section.expand", { name: t("inbox.panel.title") });
  return (
    <div className="px-3 pb-1">
      <div className="flex items-center gap-0.5">
      <button type="button" data-sidebar-inbox={count} aria-label={label} title={label} aria-pressed={open} onClick={toggle}
        className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60")}>
        <span className={cn("relative grid shrink-0 place-items-center rounded-full", open ? "bg-ink/[0.16] text-ink" : "bg-raised text-ink-secondary", large ? "size-9" : "size-8")}>
          <Inbox size={large ? 18 : 16} strokeWidth={1.75} aria-hidden="true" />
          {dot}
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-ink", large ? "text-[14px] font-medium leading-5" : "text-[15px] font-semibold leading-5")}>{t("inbox.panel.title")}</span>
        {count > 0 && <span aria-hidden="true" data-inbox-count className="shrink-0 rounded-full bg-warning px-1.5 text-[11px] font-semibold tabular-nums text-panel">{shown}</span>}
      </button>
      {waiting.length > 0 && <button type="button" data-inbox-disclose="" aria-expanded={expanded} aria-controls={listId} aria-label={disclose} title={disclose} onClick={() => setListed(!expanded)}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary outline-none hover:bg-raised/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 touch:size-10">
        <Chevron size={14} aria-hidden="true" className="rtl:-scale-x-100" />
      </button>}
      </div>
      <div id={listId} data-inbox-waiting="" hidden={!expanded} className="ms-4 mt-0.5 space-y-0.5">
        {expanded && waiting.map((entry) => {
          const asks = entry.task.activity === "waiting-on-you";
          const title = localizedTaskTitle(entry.task.title);
          const byline = `${attentionOwnerName(entry)} · ${asks ? t("inbox.waitsOnYou") : t("task.unread")}`;
          const Mark = asks ? CircleAlert : BellDot;
          return <button key={`${entry.kind}-${entry.task.threadId}`} type="button" data-inbox-waiting-row={entry.task.threadId} title={`${title} · ${byline}`}
            onClick={() => { onJump(entry); onOpened?.(); }}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink outline-none hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60">
            <Mark size={16} aria-hidden="true" className={cn("shrink-0", asks ? "text-warning" : "text-accent")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{title}</span>
              <span className="block truncate text-[12px] leading-4 text-ink-secondary">{byline}</span>
            </span>
          </button>;
        })}
      </div>
    </div>
  );
}
