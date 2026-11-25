import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CircleAlert, LayoutDashboard, MessageSquare, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";

import { nextWhen } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import {
  panelUpdating, refreshPanel, removeCard, renamePanel, resizeCard, restoreCard, usePanel,
  type Panel, type PanelAutomation, type PanelCard as Card, type PanelCardSize,
} from "@/lib/panels";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, openThread } from "@/state/thread-navigation";
import { sameFields, useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { SidebarPopoverMenu } from "../SidebarPopoverMenu";
import { TOOL_PAGE_TITLE, ToolPage, ToolPageActions, ToolPageHeader } from "../ToolPageShell";
import { PanelCard } from "./PanelCard";

/** Grows into two columns, then four, by the page's own width (not the window's), so an open side panel counts. */
export const PANEL_GRID = "grid auto-rows-[minmax(10rem,auto)] grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4";

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

/** While a Refresh now waits for its run to finish, the panel is read again this often, and the wait ends after the last. */
export const REFRESH_POLL_MS = 3_000;
export const REFRESH_GIVE_UP_MS = 120_000;

type Asked = { at: number; lastRunAt: string | null };

/** A run counts as the one asked for once it started after the click, or the panel names a different last run than then;
 * a run quick enough to finish between two reads never shows `running`, so that alone can't end the wait. */
const runFinished = (automation: PanelAutomation, asked: Asked) => {
  if (automation.running === true || !automation.lastRunAt) return false;
  return automation.lastRunAt !== asked.lastRunAt || Date.parse(automation.lastRunAt) >= asked.at;
};

function AutomationLine({ panelId, automation, onPoll }: { panelId: string; automation: PanelAutomation; onPoll: () => void }) {
  const dispatch = useStoreDispatch();
  const [asked, setAsked] = useState<Asked | null>(null);
  const [problem, setProblem] = useState("");
  const poll = useRef(onPoll);
  poll.current = onPoll;
  useEffect(() => { if (asked && runFinished(automation, asked)) setAsked(null); }, [asked, automation]);
  useEffect(() => {
    if (!asked) return;
    const every = window.setInterval(() => poll.current(), REFRESH_POLL_MS);
    const giveUp = window.setTimeout(() => setAsked(null), REFRESH_GIVE_UP_MS);
    return () => { window.clearInterval(every); window.clearTimeout(giveUp); };
  }, [asked]);
  const running = automation.running === true || asked !== null;
  const next = automation.enabled && automation.nextRunAt ? Date.parse(automation.nextRunAt) : NaN;
  const refresh = async () => {
    setProblem("");
    setAsked({ at: Date.now(), lastRunAt: automation.lastRunAt ?? null });
    try {
      await refreshPanel(panelId, automation.routineId);
    } catch (cause) {
      setAsked(null);
      setProblem(errorText(cause, t("panels.refreshFailed")));
    }
  };
  return (
    <li data-panel-automation={automation.routineId} className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-[18px] text-ink-secondary">
        <span className="min-w-0">
          {t("panels.automation.by")}{" "}
          <button
            type="button"
            onClick={() => dispatch({ type: "showRoutines", view: "list", routineId: automation.routineId })}
            className="rounded font-medium text-ink hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <bdi dir="auto">{automation.name}</bdi>
          </button>
          <span aria-hidden="true"> · </span>
          {Number.isFinite(next) ? t("panels.automation.next", { when: nextWhen(next) }) : t("panels.automation.paused")}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={running}
          aria-busy={running || undefined}
          className="ui-button ui-button-sm inline-flex items-center gap-1.5"
        >
          <RefreshCw aria-hidden="true" size={13} className={cn(running && "animate-spin motion-reduce:animate-none")} />
          {running ? t("panels.card.updating") : t("panels.refreshNow")}
        </button>
      </div>
      {automation.lastRunUpdatedNothing && !running && (
        <p className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-tertiary">
          <CircleAlert aria-hidden="true" size={12} className="shrink-0" />
          {t("panels.automation.updatedNothing")}
        </p>
      )}
      {problem && <p role="alert" className="text-[12px] leading-4 text-danger">{problem}</p>}
    </li>
  );
}

function CardGrid({ panel, botName, onAsk }: { panel: Panel; botName: (botId: string) => string | undefined; onAsk?: () => void }) {
  const [removed, setRemoved] = useState<Card | null>(null);
  const [problem, setProblem] = useState("");
  const updating = panelUpdating(panel);
  const cards = [...panel.cards].sort((a, b) => a.position - b.position);
  const resize = async (card: Card, size: PanelCardSize) => {
    setProblem("");
    try { await resizeCard(panel.id, card.id, size); } catch (cause) { setProblem(errorText(cause, t("panels.card.changeFailed"))); }
  };
  const remove = async (card: Card) => {
    setProblem("");
    try {
      const result = await removeCard(panel.id, card.id);
      setRemoved(result.card);
    } catch (cause) {
      setProblem(errorText(cause, t("panels.card.changeFailed")));
    }
  };
  const undo = async () => {
    if (!removed) return;
    try {
      await restoreCard(panel.id, removed);
      setRemoved(null);
    } catch (cause) {
      setProblem(errorText(cause, t("panels.undoFailed")));
    }
  };
  return (
    <>
      {removed && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-card px-3.5 py-2.5 text-[13px] text-ink-secondary">
          <span dir="auto" className="min-w-0 flex-1 truncate">{t("panels.card.removed", { name: removed.title })}</span>
          <button type="button" onClick={() => void undo()} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent-text hover:bg-ink/[0.06]">{t("common.undo")}</button>
        </div>
      )}
      {problem && <p role="alert" className="mb-3 text-[13px] text-danger">{problem}</p>}
      {cards.length === 0 ? (
        <section data-panel-empty className="flex flex-col items-center px-6 py-16 text-center">
          <LayoutDashboard aria-hidden="true" size={28} className="text-ink-tertiary" />
          <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-ink-secondary">{t("panels.panel.empty")}</p>
          {onAsk && <button type="button" className="ui-button mt-4" onClick={onAsk}>{t("panels.menu.openConversation")}</button>}
        </section>
      ) : (
        <div className="@container">
          <div className={PANEL_GRID}>
            {cards.map((card) => (
              <PanelCard
                key={card.id}
                card={card}
                updating={updating}
                botName={botName(card.botId)}
                onResize={(size) => void resize(card, size)}
                onRemove={() => void remove(card)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** One panel: its cards, who keeps them up to date and when they change next. */
export function PanelView({ panelId, onBack, onDelete }: { panelId: string; onBack: () => void; onDelete: (panel: Panel) => void }) {
  const dispatch = useStoreDispatch();
  const showThreads = useShowThreads();
  const routing = useStoreSelector((state) => ({ bots: state.bots, groups: state.groups, config: state.config }), sameFields);
  const { panel, error, missing, refresh } = usePanel(panelId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const back = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, [panelId]);
  useEffect(() => { if (renaming !== null) field.current?.select(); }, [renaming !== null]);
  useEffect(() => { if (missing) onBack(); }, [missing, onBack]);

  const botName = (botId: string) => routing.bots.find((bot) => bot.id === botId)?.name;
  const maker = panel ? routing.bots.find((bot) => bot.id === panel.createdBy.botId) : undefined;
  const title = panel?.title ?? "";

  const rename = async () => {
    const to = renaming?.trim();
    setRenaming(null);
    if (!panel || !to || to === panel.title) return;
    setProblem("");
    try { await renamePanel(panel.id, to); } catch (cause) { setProblem(errorText(cause, t("panels.renameFailed"))); }
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); void rename(); }
    if (event.key === "Escape") { event.preventDefault(); setRenaming(null); }
  };
  const openConversation = () => {
    if (!panel || !maker) return;
    const threadId = panel.createdBy.threadId;
    if (threadId) openThread(dispatch, { botId: maker.id, threadId }, routing, showThreads);
    else openBot(dispatch, maker, showThreads);
  };

  return (
    <ToolPage label={title || t("panels.title")}>
      <ToolPageHeader backLabel={t("panels.back")} onBack={onBack} backRef={back}>
        {renaming !== null ? (
          <input
            ref={field}
            dir="auto"
            value={renaming}
            maxLength={120}
            aria-label={t("panels.menu.rename")}
            onChange={(event) => setRenaming(event.target.value)}
            onKeyDown={keys}
            onBlur={() => void rename()}
            className="min-w-0 flex-1 rounded-md border border-hairline/60 bg-app px-2 py-1 text-[18px] font-semibold tracking-tight text-ink outline-none focus:border-accent"
          />
        ) : (
          <h1 dir="auto" className={cn(TOOL_PAGE_TITLE, "min-w-0 truncate")}>{title}</h1>
        )}
        {panel && (
          <ToolPageActions>
            <SidebarPopoverMenu
              ariaLabel={t("panels.menu.aria", { name: title })}
              triggerLabel={t("panels.menu.aria", { name: title })}
              placement="below"
              align="end"
              triggerClassName="shrink-0"
              renderTrigger={() => (
                <span className="ui-icon-button flex size-9 items-center justify-center text-ink-secondary hover:bg-raised hover:text-ink" title={t("panels.menu.aria", { name: title })}>
                  <MoreHorizontal size={18} aria-hidden="true" />
                </span>
              )}
              items={[
                { key: "rename", label: t("panels.menu.rename"), icon: <Pencil size={16} />, onSelect: () => setRenaming(panel.title) },
                ...(maker ? [{ key: "conversation", label: t("panels.menu.openConversation"), icon: <MessageSquare size={16} />, onSelect: openConversation }] : []),
                { key: "delete", label: t("panels.menu.delete"), icon: <Trash2 size={16} />, separatorBefore: true, onSelect: () => onDelete(panel) },
              ]}
            />
          </ToolPageActions>
        )}
      </ToolPageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" data-panel-view={panel ? panel.id : "loading"}>
        <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
          {error && !panel ? (
            <section role="alert" className="px-6 py-16 text-center">
              <p className="text-[14px] text-ink-secondary">{t("panels.panel.loadFailed")}</p>
              <button type="button" className="ui-button mt-4" onClick={refresh}>{t("common.tryAgain")}</button>
            </section>
          ) : panel ? (
            <>
              <div className="mb-5 flex flex-col gap-2">
                {panel.about && <p dir="auto" className="max-w-2xl text-[14px] leading-relaxed text-ink-secondary">{panel.about}</p>}
                <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-ink-tertiary">
                  {maker && <bdi dir="auto">{t("panels.madeBy", { name: maker.name })}</bdi>}
                  {maker && <span aria-hidden="true">·</span>}
                  <span>{t("panels.updated", { when: relativeTime(Date.parse(panel.updatedAt)) })}</span>
                </p>
                {(panel.automations ?? []).length > 0 && (
                  <ul aria-label={t("panels.automation.list")} className="mt-1 flex flex-col gap-2">
                    {(panel.automations ?? []).map((automation) => <AutomationLine key={automation.routineId} panelId={panel.id} automation={automation} onPoll={refresh} />)}
                  </ul>
                )}
                {problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
              </div>
              <CardGrid panel={panel} botName={botName} onAsk={maker ? openConversation : undefined} />
            </>
          ) : null}
        </div>
      </div>
    </ToolPage>
  );
}
