import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, LayoutDashboard } from "lucide-react";

import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { deletePanel, restorePanel, usePanelList, type Panel, type PanelSummary } from "@/lib/panels";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { BotAvatar } from "../Avatar";
import { TOOL_PAGE_TITLE, ToolPage, ToolPageHeader } from "../ToolPageShell";
import { PanelView } from "./PanelView";

/** A load this quick needs no placeholder; one that takes longer shows the rows' shape. */
export const PANELS_SKELETON_AFTER_MS = 300;

function PanelRow({ panel, onOpen }: { panel: PanelSummary; onOpen: () => void }) {
  const bot = useStoreSelector((state) => state.bots.find((candidate) => candidate.id === panel.createdBy.botId));
  const updated = Date.parse(panel.updatedAt);
  return (
    <li>
      <button
        type="button"
        data-panel-row={panel.id}
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-hairline/40 bg-card px-3.5 py-3 text-start transition-colors hover:bg-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none"
      >
        {bot ? <BotAvatar bot={bot} size={32} /> : <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink-tertiary"><LayoutDashboard size={16} /></span>}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <bdi dir="auto" className="min-w-0 truncate text-[14px] font-semibold leading-5 text-ink">{panel.title}</bdi>
            {panel.failedCount > 0 && (
              <span data-panel-failed className="size-2 shrink-0 rounded-full bg-danger" title={t("panels.list.failed")}>
                <span className="sr-only">{t("panels.list.failed")}</span>
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-tertiary">
            {bot && <span className="min-w-0 truncate"><bdi dir="auto">{bot.name}</bdi><span aria-hidden="true" className="ms-1.5">·</span></span>}
            <span className="shrink-0">{panel.cardCount === 1 ? t("panels.list.cardsOne") : t("panels.list.cardsMany", { count: panel.cardCount })}</span>
            {Number.isFinite(updated) && <><span aria-hidden="true">·</span><span className="shrink-0">{t("panels.updated", { when: relativeTime(updated) })}</span></>}
          </span>
        </span>
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-tertiary rtl:rotate-180" />
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul aria-hidden="true" data-panels-skeleton className="flex flex-col gap-2">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-3 rounded-xl border border-hairline/40 bg-card px-3.5 py-3">
          <span className="size-8 shrink-0 rounded-full bg-ink/[0.06]" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-3.5 w-2/5 rounded bg-ink/[0.06]" />
            <span className="h-3 w-1/4 rounded bg-ink/[0.04]" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function useLateFlag(on: boolean, after: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) { setLate(false); return; }
    const timer = window.setTimeout(() => setLate(true), after);
    return () => window.clearTimeout(timer);
  }, [on, after]);
  return late;
}

/** Every panel, and the one opened from it: boards of cards that bots keep up to date. */
export function PanelsPage() {
  const dispatch = useStoreDispatch();
  const panelId = useStoreSelector((state) => state.panelId);
  const { panels, error, refresh } = usePanelList();
  const [removed, setRemoved] = useState<Panel | null>(null);
  const [problem, setProblem] = useState("");
  const back = useRef<HTMLButtonElement>(null);
  const showSkeleton = useLateFlag(panels === null && !error, PANELS_SKELETON_AFTER_MS);
  useEffect(() => { if (!panelId) back.current?.focus({ preventScroll: true }); }, [panelId]);

  const toList = useCallback(() => dispatch({ type: "showPanels" }), [dispatch]);
  const remove = async (panel: Panel) => {
    setProblem("");
    try {
      setRemoved(await deletePanel(panel.id));
      toList();
    } catch (cause) {
      setProblem(cause instanceof Error && cause.message ? cause.message : t("panels.deleteFailed"));
    }
  };
  const undo = async () => {
    if (!removed) return;
    try {
      await restorePanel(removed);
      setRemoved(null);
    } catch (cause) {
      setProblem(cause instanceof Error && cause.message ? cause.message : t("panels.undoFailed"));
    }
  };

  if (panelId) return <PanelView panelId={panelId} onBack={toList} onDelete={(panel) => void remove(panel)} />;

  return (
    <ToolPage label={t("panels.title")}>
      <ToolPageHeader backLabel={t("automations.back")} onBack={() => dispatch({ type: "showChat" })} backRef={back}>
        <h1 className={TOOL_PAGE_TITLE}>{t("panels.title")}</h1>
      </ToolPageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" data-panels={panels ? panels.length : error ? "error" : "loading"}>
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          <p className="mb-4 text-[14px] leading-relaxed text-ink-secondary">{t("panels.subtitle")}</p>
          {removed && (
            <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-card px-3.5 py-2.5 text-[13px] text-ink-secondary">
              <span dir="auto" className="min-w-0 flex-1 truncate">{t("panels.removed", { name: removed.title })}</span>
              <button type="button" onClick={() => void undo()} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent-text hover:bg-ink/[0.06]">{t("common.undo")}</button>
            </div>
          )}
          {problem && <p role="alert" className="mb-3 text-[13px] text-danger">{problem}</p>}
          {error && !panels ? (
            <section role="alert" className="px-6 py-16 text-center">
              <p className="text-[14px] text-ink-secondary">{t("panels.list.loadFailed")}</p>
              <button type="button" className="ui-button mt-4" onClick={refresh}>{t("common.tryAgain")}</button>
            </section>
          ) : panels && panels.length === 0 ? (
            <section data-panels-empty className="flex flex-col items-center px-6 py-16 text-center">
              <LayoutDashboard aria-hidden="true" size={28} className="text-ink-tertiary" />
              <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-ink-secondary">{t("panels.list.empty")}</p>
              <button type="button" className="ui-button mt-4" onClick={() => dispatch({ type: "showChat" })}>{t("panels.list.emptyAction")}</button>
            </section>
          ) : panels ? (
            <ul aria-label={t("panels.title")} className="flex flex-col gap-2">
              {panels.map((panel) => <PanelRow key={panel.id} panel={panel} onOpen={() => dispatch({ type: "showPanels", panelId: panel.id })} />)}
            </ul>
          ) : showSkeleton ? <ListSkeleton /> : null}
        </div>
      </div>
    </ToolPage>
  );
}
