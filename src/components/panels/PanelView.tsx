import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, CircleAlert, LayoutGrid, MessageSquare, MoreHorizontal, Pencil, Plus, RefreshCw, Share2, Trash2 } from "lucide-react";

import { nextWhen } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { refreshPanel, renamePanel, usePanel, type Panel, type PanelAutomation } from "@/lib/panels";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, openThread } from "@/state/thread-navigation";
import { sameFields, useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { SidebarPopoverMenu } from "../SidebarPopoverMenu";
import { BotAvatar } from "../Avatar";
import { TOOL_PAGE_TITLE, ToolPage, ToolPageActions, ToolPageHeader } from "../ToolPageShell";
import { NewCardDialog } from "./NewCardDialog";
import { CardSidePanel } from "./CardSidePanel";
import { CardGrid, placedCards, useCardRemoval } from "./PanelGrid";
import { ShareDialog, VisibilityChip, panelVisibility } from "./ShareDialog";

export { PANEL_GRID } from "./PanelGrid";

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

/** One panel: its cards, who keeps them up to date and when they change next. */
export function PanelView({ panelId, onBack, onDelete }: { panelId: string; onBack: () => void; onDelete: (panel: Panel) => void }) {
  const dispatch = useStoreDispatch();
  const showThreads = useShowThreads();
  const routing = useStoreSelector((state) => ({ bots: state.bots, groups: state.groups, config: state.config }), sameFields);
  const { panel, error, missing, refresh } = usePanel(panelId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [organizing, setOrganizing] = useState(false);
  const [dialog, setDialog] = useState<"new" | "share" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const removal = useCardRemoval(panelId);
  const back = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, [panelId]);
  useEffect(() => { if (renaming !== null) field.current?.select(); }, [renaming !== null]);
  useEffect(() => { if (missing) onBack(); }, [missing, onBack]);

  const maker = panel ? routing.bots.find((bot) => bot.id === panel.createdBy.botId) : undefined;
  const opened = panel && openId ? placedCards(panel).find((card) => card.id === openId) : undefined;
  useEffect(() => { if (openId && panel && !opened) setOpenId(null); }, [openId, panel, opened]);
  useEffect(() => { if (organizing) setOpenId(null); }, [organizing]);
  const closeSide = () => {
    const id = openId;
    setOpenId(null);
    if (id) requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-panel-card]")].find((element) => element.getAttribute("data-panel-card") === id)?.querySelector<HTMLElement>("[data-panel-card-open]")?.focus());
  };
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
            <button type="button" data-panel-action="share" onClick={() => setDialog("share")} className="ui-button ui-button-md inline-flex items-center gap-1.5">
              <Share2 size={14} aria-hidden="true" />
              <span className="max-sm:sr-only">{t("panels.share.open")}</span>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-panel-action="organize"
                aria-pressed={organizing}
                onClick={() => setOrganizing(!organizing)}
                className={cn("ui-button ui-button-md inline-flex items-center gap-1.5", organizing && "ui-button-primary")}
              >
                {organizing ? <Check size={14} aria-hidden="true" /> : <LayoutGrid size={14} aria-hidden="true" />}
                <span className={cn(!organizing && "max-sm:sr-only")}>{organizing ? t("panels.organize.done") : t("panels.organize.open")}</span>
              </button>
              <button type="button" data-panel-action="new" onClick={() => setDialog("new")} className="ui-button ui-button-md inline-flex items-center gap-1.5">
                <Plus size={14} aria-hidden="true" />
                {t("panels.new.open")}
              </button>
            </div>
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
      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-panel-view={panel ? panel.id : "loading"}>
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
                  <p data-panel-meta className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-ink-tertiary">
                    <VisibilityChip visibility={panelVisibility(panel)} />
                    {maker && (
                      <span className="ms-1 inline-flex min-w-0 items-center gap-1.5">
                        <BotAvatar bot={maker} size={16} />
                        <bdi dir="auto" className="truncate">{t("panels.madeBy", { name: maker.name })}</bdi>
                      </span>
                    )}
                    {maker && <span aria-hidden="true">·</span>}
                    <span>{placedCards(panel).length === 1 ? t("panels.list.cardsOne") : t("panels.list.cardsMany", { count: placedCards(panel).length })}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t("panels.updated", { when: relativeTime(Date.parse(panel.updatedAt)) })}</span>
                  </p>
                  {(panel.automations ?? []).length > 0 && (
                    <ul aria-label={t("panels.automation.list")} className="mt-1 flex flex-col gap-2">
                      {(panel.automations ?? []).map((automation) => <AutomationLine key={automation.routineId} panelId={panel.id} automation={automation} onPoll={refresh} />)}
                    </ul>
                  )}
                  {problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
                </div>
                {organizing && <p className="mb-3 text-[13px] leading-[18px] text-ink-secondary">{t("panels.organize.hint")}</p>}
                <CardGrid
                  panel={panel}
                  bots={routing.bots}
                  organizing={organizing}
                  removal={removal}
                  openId={opened?.id}
                  onAsk={maker ? openConversation : undefined}
                  onOpen={(card) => setOpenId(card.id === openId ? null : card.id)}
                />
                {dialog === "new" && <NewCardDialog panel={panel} bots={routing.bots} onClose={() => setDialog(null)} />}
                {dialog === "share" && <ShareDialog panel={panel} makerName={maker?.name} onClose={() => setDialog(null)} />}
              </>
            ) : null}
          </div>
        </div>
        {panel && opened && (
          <CardSidePanel
            panel={panel}
            card={opened}
            bots={routing.bots}
            onClose={closeSide}
            onRemove={(card) => { setOpenId(null); void removal.remove(card); }}
          />
        )}
      </div>
    </ToolPage>
  );
}
