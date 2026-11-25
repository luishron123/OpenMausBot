import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LayoutDashboard } from "lucide-react";

import { t } from "@/lib/i18n";
import {
  cardUpdating, orderCards, removeCard, resizeCard, resolveCard, restoreCard,
  type Panel, type PanelCard as Card, type PanelCardSize,
} from "@/lib/panels";
import type { Bot } from "@/state/store";
import { PanelCard, cardCadence, panelCardState, type CardMover } from "./PanelCard";

/** Grows into two columns, then four, by the page's own width (not the window's), so an open side panel counts. */
export const PANEL_GRID = "grid auto-rows-[minmax(10rem,auto)] grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4";

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

/** The cards drawn on the panel, in order: a draft from New card stays off it until it is added. */
export const placedCards = (panel: Panel): Card[] => panel.cards.filter((card) => !card.draft).sort((a, b) => a.position - b.position);

/** `ids` with `id` moved to `to`, clamped to the list. */
export function moved(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const target = Math.max(0, Math.min(ids.length - 1, to));
  if (target === from) return ids;
  const next = ids.filter((item) => item !== id);
  next.splice(target, 0, id);
  return next;
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

type Drag = { id: string; pointerId: number; start: string[] };

export function CardGrid({ panel, bots, organizing, onAsk, onOpen }: {
  panel: Panel;
  bots: ReadonlyArray<Bot>;
  organizing: boolean;
  onAsk?: () => void;
  onOpen?: (card: Card) => void;
}) {
  const [removed, setRemoved] = useState<Card | null>(null);
  const [problem, setProblem] = useState("");
  const [order, setOrder] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const placed = placedCards(panel);
  const serverIds = placed.map((card) => card.id);
  const ids = order && order.length === serverIds.length && order.every((id) => serverIds.includes(id)) ? order : serverIds;
  const byId = new Map(placed.map((card) => [card.id, card]));
  const cards = ids.map((id) => byId.get(id)!);

  useEffect(() => { if (order && !drag && sameOrder(order, serverIds)) setOrder(null); });
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const card = [...(grid.current?.querySelectorAll<HTMLElement>("[data-panel-card]") ?? [])].find((element) => element.getAttribute("data-panel-card") === id);
    card?.querySelector<HTMLElement>("[data-panel-card-handle]")?.focus();
  });

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
  const resolve = async (card: Card) => {
    setProblem("");
    try { await resolveCard(panel.id, card.id); } catch (cause) { setProblem(errorText(cause, t("panels.card.resolveFailed"))); }
  };
  const save = async (next: string[], before: string[]) => {
    setProblem("");
    setOrder(next);
    if (sameOrder(next, before)) return;
    try {
      await orderCards(panel.id, next);
    } catch (cause) {
      setOrder(null);
      setProblem(errorText(cause, t("panels.order.failed")));
    }
  };
  const announce = (id: string, next: string[]) => {
    const card = byId.get(id);
    if (card) setSaid(t("panels.order.moved", { name: card.title, position: next.indexOf(id) + 1, count: next.length }));
  };

  const mover = (card: Card): CardMover => ({
    dragging: drag?.id === card.id,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ id: card.id, pointerId: event.pointerId, start: ids });
      setOrder(ids);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (!drag || drag.pointerId !== event.pointerId || !grid.current) return;
      for (const element of grid.current.querySelectorAll<HTMLElement>("[data-panel-card]")) {
        const over = element.getAttribute("data-panel-card");
        if (!over || over === drag.id) continue;
        const box = element.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) continue;
        setOrder((current) => moved(current ?? ids, drag.id, (current ?? ids).indexOf(over)));
        return;
      }
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      const next = order ?? ids;
      setDrag(null);
      announce(drag.id, next);
      void save(next, drag.start);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const at = ids.indexOf(card.id);
      const to = {
        ArrowUp: at - 1, ArrowDown: at + 1,
        ArrowLeft: rtl ? at + 1 : at - 1, ArrowRight: rtl ? at - 1 : at + 1,
        Home: 0, End: ids.length - 1,
      }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      const next = moved(ids, card.id, to);
      if (sameOrder(next, ids)) return;
      refocus.current = card.id;
      announce(card.id, next);
      void save(next, ids);
    },
  });

  return (
    <>
      {removed && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-card px-3.5 py-2.5 text-[13px] text-ink-secondary">
          <span dir="auto" className="min-w-0 flex-1 truncate">{t("panels.card.removed", { name: removed.title })}</span>
          <button type="button" onClick={() => void undo()} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent-text hover:bg-ink/[0.06]">{t("common.undo")}</button>
        </div>
      )}
      {problem && <p role="alert" className="mb-3 text-[13px] text-danger">{problem}</p>}
      <p aria-live="polite" className="sr-only">{said}</p>
      {cards.length === 0 ? (
        <section data-panel-empty className="flex flex-col items-center px-6 py-16 text-center">
          <LayoutDashboard aria-hidden="true" size={28} className="text-ink-tertiary" />
          <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-ink-secondary">{t("panels.panel.empty")}</p>
          {onAsk && <button type="button" className="ui-button mt-4" onClick={onAsk}>{t("panels.menu.openConversation")}</button>}
        </section>
      ) : (
        <div className="@container">
          <div ref={grid} className={PANEL_GRID} data-panel-organizing={organizing || undefined}>
            {cards.map((card) => (
              <PanelCard
                key={card.id}
                card={card}
                state={panelCardState(card, cardUpdating(panel, card))}
                bot={bots.find((bot) => bot.id === card.botId)}
                cadence={cardCadence(panel, card)}
                organizing={organizing}
                mover={organizing ? mover(card) : undefined}
                onResize={(size) => void resize(card, size)}
                onRemove={() => void remove(card)}
                onOpen={organizing || !onOpen ? undefined : () => onOpen(card)}
                onResolve={() => resolve(card)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
