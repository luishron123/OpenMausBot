import { useCallback, useId, useMemo, useState } from "react";
import { CircleAlert, LoaderCircle, MoreHorizontal, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { PANEL_CARD_SIZES, type PanelCard as Card, type PanelCardSize } from "@/lib/panels";
import { widgetFields, widgetInitialValues, type WidgetRoot } from "../../../shared/widget";
import { SidebarPopoverMenu, type SidebarMenuItem } from "../SidebarPopoverMenu";
import { WidgetBody } from "../widget/WidgetBody";
import { WIDGET_COMPACT_BELOW, WidgetFormProvider, type WidgetForm } from "../widget/WidgetControls";

export type PanelCardState = "ok" | "updating" | "failed" | "waiting";

export function panelCardState(card: Card, updating: boolean): PanelCardState {
  if (card.status === "failed") return "failed";
  if (updating) return "updating";
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

const NOTHING = (): void => {};

/** The card's widget as in chat, read-only: its buttons and fields take no input, since nobody's turn is waiting on them. */
function CardWidget({ root, name }: { root: WidgetRoot; name: string }) {
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

export function PanelCard({ card, updating, botName, onResize, onRemove }: {
  card: Card;
  updating: boolean;
  botName?: string;
  onResize: (size: PanelCardSize) => void;
  onRemove: () => void;
}) {
  const state = panelCardState(card, updating);
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
  return (
    <article
      aria-label={card.title}
      aria-busy={state === "updating" || undefined}
      data-panel-card={card.id}
      data-panel-card-state={state}
      className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-hairline/40 bg-card", PANEL_CARD_SPAN[card.size])}
    >
      <header className="flex min-w-0 items-start gap-1 px-4 pb-3 pt-3.5">
        <h2 dir="auto" title={card.title} className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-ink">{card.title}</h2>
        <SidebarPopoverMenu
          ariaLabel={t("panels.card.menu", { name: card.title })}
          triggerLabel={t("panels.card.menu", { name: card.title })}
          placement="below"
          align="end"
          triggerClassName="-me-1.5 -mt-1 shrink-0"
          renderTrigger={() => (
            <span className="ui-icon-button flex size-7 items-center justify-center text-ink-secondary hover:bg-raised hover:text-ink" title={t("panels.card.menu", { name: card.title })}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </span>
          )}
          items={menu}
        />
      </header>
      <div className="min-h-0 flex-1">
        {card.widget ? (
          <div className={cn("transition-opacity motion-reduce:transition-none", state === "failed" && "opacity-[0.55]")}>
            <CardWidget root={card.widget} name={card.title} />
          </div>
        ) : (
          <p className="px-4 pb-4 text-[13px] leading-[18px] text-ink-tertiary">
            {state === "failed" ? t("panels.card.noData") : t("panels.card.waiting")}
          </p>
        )}
      </div>
      {state === "failed" && card.failure && (
        <p className="mx-4 mb-1 flex items-start gap-2 border-t border-hairline/40 pt-3 text-[13px] leading-[18px] text-danger">
          <CircleAlert aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          <span dir="auto" className="min-w-0 break-words">{card.failure}</span>
        </p>
      )}
      <footer className="flex min-w-0 items-center gap-1.5 px-4 pb-3 pt-2 text-[12px] leading-4 text-ink-tertiary">
        {state === "updating" && <LoaderCircle aria-hidden="true" size={12} className="shrink-0 animate-spin motion-reduce:animate-none" />}
        <span className="min-w-0 truncate">
          {state === "updating"
            ? t("panels.card.updating")
            : state === "failed" && Number.isFinite(failedAt)
              ? t("panels.card.failedAt", { when: relativeTime(failedAt) })
              : state === "waiting"
                ? t("panels.card.waitingShort")
                : Number.isFinite(updatedAt) ? relativeTime(updatedAt) : ""}
        </span>
        {botName && (
          <>
            <span aria-hidden="true">·</span>
            <bdi dir="auto" className="min-w-0 truncate">{botName}</bdi>
          </>
        )}
      </footer>
    </article>
  );
}
