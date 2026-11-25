import { useCallback, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Bell, CircleAlert, CirclePause, GripVertical, LoaderCircle, MoreHorizontal, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { nextWhen } from "@/lib/automations";
import { relativeTime } from "@/lib/memory";
import { PANEL_CARD_SIZES, cardAutomation, type Panel, type PanelAutomation, type PanelCard as Card, type PanelCardSize, type PanelSchedule } from "@/lib/panels";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { widgetFields, widgetInitialValues, type WidgetRoot } from "../../../shared/widget";
import { SidebarPopoverMenu, type SidebarMenuItem } from "../SidebarPopoverMenu";
import { WidgetBody } from "../widget/WidgetBody";
import { WIDGET_COMPACT_BELOW, WidgetFormProvider, type WidgetForm } from "../widget/WidgetControls";

export type PanelCardState = "ok" | "updating" | "failed" | "waiting" | "building" | "held";

/** Failed and held say why the card is stuck, so they come before a run in progress; a card with no widget yet whose
 * first run is going is building. */
export function panelCardState(card: Card, updating: boolean): PanelCardState {
  if (card.status === "failed") return "failed";
  if (card.held) return "held";
  if (updating) return card.widget ? "updating" : "building";
  if (card.building && !card.widget) return "building";
  return card.widget ? "ok" : "waiting";
}

/** S takes one column, M two, L two by two; under the two-column width every card is one column. */
export const PANEL_CARD_SPAN: Record<PanelCardSize, string> = {
  s: "",
  m: "@xl:col-span-2",
  l: "@xl:col-span-2 @xl:row-span-2",
};

const SIZE_LABEL: Record<PanelCardSize, "panels.card.sizeSmall" | "panels.card.sizeMedium" | "panels.card.sizeLarge"> = {
  s: "panels.card.sizeSmall",
  m: "panels.card.sizeMedium",
  l: "panels.card.sizeLarge",
};

const SIZE_LETTER: Record<PanelCardSize, "panels.card.sizeLetterSmall" | "panels.card.sizeLetterMedium" | "panels.card.sizeLetterLarge"> = {
  s: "panels.card.sizeLetterSmall",
  m: "panels.card.sizeLetterMedium",
  l: "panels.card.sizeLetterLarge",
};

export const nextSize = (size: PanelCardSize): PanelCardSize => PANEL_CARD_SIZES[(PANEL_CARD_SIZES.indexOf(size) + 1) % PANEL_CARD_SIZES.length]!;

/** How often the card is brought up to date: its automation's cadence, the routine's own words for any other schedule,
 * and "when asked" with none, since then it changes only when someone asks a bot. */
export function cadenceText(automation: PanelAutomation | undefined): string {
  if (!automation) return t("panels.cadence.onRequest");
  switch (automation.cadence) {
    case "on-request": return t("panels.cadence.onRequest");
    case "hourly": return t("panels.cadence.hourly");
    case "daily": return t("panels.cadence.daily");
    case "weekly": return t("panels.cadence.weekly");
    case "custom": return automation.scheduleText?.trim() || automation.name;
    default: return "";
  }
}

const SCHEDULE_TEXT: Record<PanelSchedule, "panels.schedule.half" | "panels.schedule.hour" | "panels.schedule.day" | "panels.schedule.week" | "panels.schedule.manual"> = {
  half: "panels.schedule.half",
  hour: "panels.schedule.hour",
  day: "panels.schedule.day",
  week: "panels.schedule.week",
  manual: "panels.schedule.manual",
};

export const scheduleText = (schedule: PanelSchedule): string => t(SCHEDULE_TEXT[schedule]);

/** The card's own schedule when it has one, else the cadence of the automation that keeps it. */
export const cardCadence = (panel: Panel, card: Card): string =>
  card.schedule ? scheduleText(card.schedule) : cadenceText(cardAutomation(panel, card));

const NOTHING = (): void => {};

/** The card's widget as in chat, read-only: its buttons and fields take no input, since nobody's turn is waiting on them. */
export function CardWidget({ root, name }: { root: WidgetRoot; name: string }) {
  const uid = useId();
  const [compact, setCompact] = useState(false);
  const [imagesAllowed, setImagesAllowed] = useState(false);
  const watch = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setCompact(width < WIDGET_COMPACT_BELOW);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const form = useMemo<WidgetForm>(() => ({
    uid,
    values: widgetInitialValues(root),
    setValue: NOTHING,
    other: {},
    chooseOther: NOTHING,
    setOther: NOTHING,
    locked: true,
    errorId: `${uid}-error`,
    fields: new Map(widgetFields(root).map((field) => [field.name, field])),
    actions: new Map(),
    press: NOTHING,
    imagesAllowed,
    allowImages: () => setImagesAllowed(true),
    labelled: new Set(),
    compact,
    name,
  }), [uid, root, imagesAllowed, compact, name]);
  return (
    <WidgetFormProvider value={form}>
      <div ref={watch} data-widget-compact={compact || undefined} className="min-w-0">
        <WidgetBody root={root} headed />
      </div>
    </WidgetFormProvider>
  );
}

/** The handle that moves a card while the panel is being organized: dragged with the pointer, or focused and moved with
 * the arrow keys, Home and End. */
export type CardMover = {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  dragging: boolean;
};

export function PanelCard({ card, state, bot, cadence, organizing = false, bare = false, selected = false, mover, onResize, onRemove, onOpen, onResolve }: {
  card: Card;
  state: PanelCardState;
  bot?: Pick<Bot, "id" | "name"> & Partial<Bot>;
  cadence: string;
  organizing?: boolean;
  /** A preview: no menu, no size or span of its own. */
  bare?: boolean;
  /** Open in the side panel. */
  selected?: boolean;
  mover?: CardMover;
  onResize: (size: PanelCardSize) => void;
  onRemove: () => void;
  onOpen?: () => void;
  /** Turns a paused automation back on and runs it; the button shows while it is pending. */
  onResolve?: () => Promise<void>;
}) {
  const [resolving, setResolving] = useState(false);
  const resolve = () => {
    if (!onResolve || resolving) return;
    setResolving(true);
    void onResolve().finally(() => setResolving(false));
  };
  const heldUntil = card.held?.until ? Date.parse(card.held.until) : NaN;
  const failedAt = card.failedAt ? Date.parse(card.failedAt) : NaN;
  const updatedAt = Date.parse(card.updatedAt);
  const menu: SidebarMenuItem[] = [
    ...PANEL_CARD_SIZES.map((size, index) => ({
      key: `size-${size}`,
      label: t(SIZE_LABEL[size]),
      heading: index === 0 ? t("panels.card.size") : undefined,
      checked: card.size === size,
      onSelect: () => { if (card.size !== size) onResize(size); },
    })),
    { key: "remove", label: t("panels.card.remove"), icon: <Trash2 size={16} />, separatorBefore: true, onSelect: onRemove },
  ];
  const when = state === "updating"
    ? t("panels.card.updating")
    : state === "failed" && Number.isFinite(failedAt)
      ? t("panels.card.failedAt", { when: relativeTime(failedAt) })
      : state === "waiting"
        ? t("panels.card.waitingShort")
        : state === "building"
          ? t("panels.card.buildingShort")
          : Number.isFinite(updatedAt) ? relativeTime(updatedAt) : "";
  return (
    <article
      aria-label={card.title}
      aria-busy={state === "updating" || state === "building" || undefined}
      data-panel-card={card.id}
      data-panel-card-state={state}
      data-panel-card-dragging={mover?.dragging || undefined}
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-opacity motion-reduce:transition-none",
        selected ? "border-accent" : organizing ? "border-hairline" : "border-hairline/40",
        mover?.dragging && "opacity-60",
        !bare && PANEL_CARD_SPAN[card.size],
      )}
    >
      <header className="flex min-w-0 items-start gap-1 px-4 pb-3 pt-3.5">
        <h2 dir="auto" title={card.title} className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-ink">
          {onOpen ? (
            <button
              type="button"
              data-panel-card-open
              aria-expanded={selected}
              onClick={onOpen}
              className="max-w-full truncate rounded text-start hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus after:absolute after:inset-0 after:content-['']"
            >
              {card.title}
            </button>
          ) : card.title}
        </h2>
        {organizing ? (
          <div className="relative z-10 -me-1.5 -mt-1 flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-panel-card-size={card.size}
              onClick={() => onResize(nextSize(card.size))}
              aria-label={t("panels.card.sizeChange", { size: t(SIZE_LABEL[card.size]), next: t(SIZE_LABEL[nextSize(card.size)]) })}
              title={t("panels.card.sizeChange", { size: t(SIZE_LABEL[card.size]), next: t(SIZE_LABEL[nextSize(card.size)]) })}
              className="ui-button ui-button-sm min-w-7 justify-center px-0 tabular-nums"
            >
              {t(SIZE_LETTER[card.size])}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={t("panels.card.removeNamed", { name: card.title })}
              title={t("panels.card.remove")}
              className="ui-icon-button ui-button-ghost flex size-7 items-center justify-center"
            >
              <X size={16} aria-hidden="true" />
            </button>
            {mover && (
              <button
                type="button"
                data-panel-card-handle
                aria-label={t("panels.card.move", { name: card.title })}
                aria-roledescription={t("panels.card.handle")}
                title={t("panels.card.moveHint")}
                onPointerDown={mover.onPointerDown}
                onPointerMove={mover.onPointerMove}
                onPointerUp={mover.onPointerUp}
                onPointerCancel={mover.onPointerUp}
                onKeyDown={mover.onKeyDown}
                className="ui-icon-button ui-button-ghost flex size-7 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
              >
                <GripVertical size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        ) : bare ? null : (
          <SidebarPopoverMenu
            ariaLabel={t("panels.card.menu", { name: card.title })}
            triggerLabel={t("panels.card.menu", { name: card.title })}
            placement="below"
            align="end"
            triggerClassName="relative z-10 -me-1.5 -mt-1 shrink-0"
            renderTrigger={() => (
              <span className="ui-icon-button flex size-7 items-center justify-center text-ink-secondary hover:bg-raised hover:text-ink" title={t("panels.card.menu", { name: card.title })}>
                <MoreHorizontal size={16} aria-hidden="true" />
              </span>
            )}
            items={menu}
          />
        )}
      </header>
      <div className="min-h-0 flex-1">
        {card.widget ? (
          <div className={cn("transition-opacity motion-reduce:transition-none", state === "failed" && "opacity-[0.55]")}>
            <CardWidget root={card.widget} name={card.title} />
          </div>
        ) : state === "building" ? (
          <p data-panel-card-building className="flex items-center gap-2 px-4 pb-4 text-[13px] leading-[18px] text-ink-secondary">
            <LoaderCircle aria-hidden="true" size={14} className="shrink-0 animate-spin motion-reduce:animate-none" />
            {t("panels.card.building")}
          </p>
        ) : (
          <p className="px-4 pb-4 text-[13px] leading-[18px] text-ink-tertiary">
            {state === "failed" ? t("panels.card.noData") : t("panels.card.waiting")}
          </p>
        )}
      </div>
      {card.alertActive && (
        <p data-panel-card-alert className="mx-4 mb-1 flex items-start gap-2 rounded-lg bg-warning/10 px-2.5 py-2 text-[13px] leading-[18px] text-ink">
          <Bell aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-warning" />
          <span dir="auto" className="min-w-0 break-words">{card.alertActive.text}</span>
        </p>
      )}
      {state === "held" && card.held && (
        <p data-panel-card-held className="mx-4 mb-1 flex items-start gap-2 border-t border-hairline/40 pt-3 text-[13px] leading-[18px] text-ink-secondary">
          <CirclePause aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          <span dir="auto" className="min-w-0 break-words">
            {Number.isFinite(heldUntil)
              ? t("panels.card.heldUntil", { reason: card.held.reason, when: nextWhen(heldUntil) })
              : t("panels.card.held", { reason: card.held.reason })}
          </span>
        </p>
      )}
      {state === "failed" && (card.failure || onResolve) && (
        <div className="mx-4 mb-1 flex items-start gap-2 border-t border-hairline/40 pt-3 text-[13px] leading-[18px] text-danger">
          <CircleAlert aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          <span dir="auto" className="min-w-0 flex-1 break-words">{card.failure ?? t("panels.card.failedShort")}</span>
          {onResolve && !organizing && (
            <button
              type="button"
              data-panel-card-resolve
              onClick={resolve}
              disabled={resolving}
              aria-busy={resolving || undefined}
              className="ui-button ui-button-sm relative z-10 -mt-0.5 shrink-0"
            >
              {resolving ? t("panels.card.resolving") : t("panels.card.resolve")}
            </button>
          )}
        </div>
      )}
      <PanelCardFooter bot={bot} when={when} cadence={cadence} updating={state === "updating"} />
    </article>
  );
}

/** Who keeps the card, when it last changed and how often it changes. */
export function PanelCardFooter({ bot, when, cadence, updating }: { bot?: Pick<Bot, "id" | "name"> & Partial<Bot>; when: string; cadence: string; updating: boolean }) {
  return (
    <footer data-panel-card-footer className="flex min-w-0 items-center gap-1.5 px-4 pb-3 pt-2 text-[12px] leading-4 text-ink-tertiary">
      {updating && <LoaderCircle aria-hidden="true" size={12} className="shrink-0 animate-spin motion-reduce:animate-none" />}
      {bot && (
        <>
          <BotAvatar bot={bot as Bot} size={16} />
          <bdi dir="auto" className="min-w-0 shrink truncate font-medium text-ink-secondary">{bot.name}</bdi>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="min-w-0 shrink-0 truncate">{when}</span>
      {cadence && (
        <>
          <span aria-hidden="true">·</span>
          <span data-panel-card-cadence className="min-w-0 truncate">{cadence}</span>
        </>
      )}
    </footer>
  );
}
