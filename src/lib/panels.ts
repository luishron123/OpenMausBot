// The client side of panels: read the list and one panel, change and remove with Undo. A screen reads again when the
// server says a panel changed (`panels.changed`), when the live stream missed frames, and after a change made here.
import { useCallback, useEffect, useRef, useState } from "react";

import { listenLiveFrames } from "@/lib/live-events";
import { api, ApiError } from "@/state/api";
import {
  PANELS_PATH,
  type Panel, type PanelAutomation, type PanelCard, type PanelCardSize, type PanelNewCardRequest, type PanelPinnableBlock,
  type PanelsChangedFrame, type PanelSummary, type PanelVisibility,
} from "../../shared/panels";

export { PANEL_CADENCES, PANEL_CARD_FORMATS, PANEL_CARD_SIZES } from "../../shared/panels";
export type {
  Panel, PanelAutomation, PanelCadence, PanelCard, PanelCardFormat, PanelCardSize, PanelNewCardRequest, PanelPinnableBlock,
  PanelSummary, PanelVisibility,
} from "../../shared/panels";

const CHANGED = "omb:panels-changed";

let listCache: PanelSummary[] | null = null;
const panelCache = new Map<string, Panel>();

function changed(panelId: string, removed = false): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<PanelsChangedFrame>(CHANGED, { detail: { kind: "panels.changed", panelId, ...(removed ? { removed: true } : {}) } }));
}

function isPanelsFrame(frame: { kind: string }): frame is PanelsChangedFrame {
  return frame.kind === "panels.changed" && typeof (frame as Partial<PanelsChangedFrame>).panelId === "string";
}

/** Calls `onChange` for every panel change, from the server or from this window; `null` after missed frames. */
function useWhenPanelsChange(onChange: (frame: PanelsChangedFrame | null) => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const local = (event: Event) => latest.current((event as CustomEvent<PanelsChangedFrame>).detail);
    window.addEventListener(CHANGED, local);
    const stop = listenLiveFrames({
      onFrame: (frame) => { if (isPanelsFrame(frame)) latest.current(frame); },
      onMissedFrames: () => latest.current(null),
    });
    return () => { window.removeEventListener(CHANGED, local); stop(); };
  }, []);
}

const newestFirst = (panels: PanelSummary[]) => [...panels].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export function usePanelList(): { panels: PanelSummary[] | null; error: boolean; refresh: () => void } {
  const [panels, setPanels] = useState<PanelSummary[] | null>(listCache);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  const refresh = useCallback(() => {
    api<{ panels: PanelSummary[] }>(PANELS_PATH)
      .then((result) => {
        listCache = newestFirst(result.panels ?? []);
        if (!alive.current) return;
        setPanels(listCache);
        setError(false);
      })
      .catch(() => { if (alive.current) setError(true); });
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    return () => { alive.current = false; };
  }, [refresh]);
  useWhenPanelsChange(refresh);
  return { panels, error, refresh };
}

export type PanelLoad = { panel: Panel | null; error: boolean; missing: boolean; refresh: () => void };

export function usePanel(id: string): PanelLoad {
  const [panel, setPanel] = useState<Panel | null>(() => panelCache.get(id) ?? null);
  const [error, setError] = useState(false);
  const [missing, setMissing] = useState(false);
  const alive = useRef(true);
  const refresh = useCallback(() => {
    api<{ panel: Panel }>(`${PANELS_PATH}/${encodeURIComponent(id)}`)
      .then((result) => {
        panelCache.set(id, result.panel);
        if (!alive.current) return;
        setPanel(result.panel);
        setError(false);
        setMissing(false);
      })
      .catch((cause: unknown) => {
        if (!alive.current) return;
        if (cause instanceof ApiError && cause.status === 404) {
          panelCache.delete(id);
          setMissing(true);
        } else setError(true);
      });
  }, [id]);
  useEffect(() => {
    alive.current = true;
    setPanel(panelCache.get(id) ?? null);
    setMissing(false);
    refresh();
    return () => { alive.current = false; };
  }, [id, refresh]);
  useWhenPanelsChange((frame) => {
    if (frame && frame.panelId !== id) return;
    if (frame?.removed) {
      panelCache.delete(id);
      setMissing(true);
      return;
    }
    refresh();
  });
  return { panel, error, missing, refresh };
}

const panelPath = (id: string) => `${PANELS_PATH}/${encodeURIComponent(id)}`;
const cardPath = (id: string, cardId: string) => `${panelPath(id)}/cards/${encodeURIComponent(cardId)}`;

function kept(panel: Panel): Panel {
  panelCache.set(panel.id, panel);
  changed(panel.id);
  return panel;
}

export async function renamePanel(id: string, title: string): Promise<Panel> {
  const { panel } = await api<{ panel: Panel }>(panelPath(id), { method: "PATCH", body: JSON.stringify({ title }) });
  return kept(panel);
}

/** Answers with what was removed, which `restorePanel` puts back. */
export async function deletePanel(id: string): Promise<Panel> {
  const { panel } = await api<{ panel: Panel }>(panelPath(id), { method: "DELETE" });
  panelCache.delete(id);
  changed(id, true);
  return panel;
}

export async function restorePanel(removed: Panel): Promise<Panel> {
  const { panel } = await api<{ panel: Panel }>(`${PANELS_PATH}/restore`, { method: "POST", body: JSON.stringify({ panel: removed }) });
  return kept(panel);
}

export async function resizeCard(id: string, cardId: string, size: PanelCardSize): Promise<Panel> {
  const { panel } = await api<{ panel: Panel }>(cardPath(id, cardId), { method: "PATCH", body: JSON.stringify({ size }) });
  return kept(panel);
}

export async function removeCard(id: string, cardId: string): Promise<{ panel: Panel; card: PanelCard }> {
  const result = await api<{ panel: Panel; card: PanelCard }>(cardPath(id, cardId), { method: "DELETE" });
  kept(result.panel);
  return result;
}

export async function restoreCard(id: string, card: PanelCard): Promise<Panel> {
  const { panel } = await api<{ panel: Panel }>(`${panelPath(id)}/cards/restore`, { method: "POST", body: JSON.stringify({ card }) });
  return kept(panel);
}

/** Runs the panel's automation now; the cards change when its run sets them. */
export async function refreshPanel(id: string, routineId?: string): Promise<void> {
  await api(`${panelPath(id)}/refresh`, { method: "POST", body: JSON.stringify(routineId ? { routineId } : {}) });
}

/** True while one of the panel's automations is running, so its cards are about to change. */
export const panelUpdating = (panel: Pick<Panel, "automations">): boolean => (panel.automations ?? []).some((automation) => automation.running === true);

/** A card is updating while an automation that keeps it runs: its own, or one that keeps the whole panel. */
export const cardUpdating = (panel: Pick<Panel, "automations">, card: Pick<PanelCard, "key">): boolean =>
  (panel.automations ?? []).some((automation) => automation.running === true && (!automation.cardKey || automation.cardKey === card.key));

export async function setPanelVisibility(id: string, visibility: PanelVisibility): Promise<Panel> {
  const { panel } = await api<{ panel: Panel }>(panelPath(id), { method: "PATCH", body: JSON.stringify({ visibility }) });
  return kept(panel);
}

export async function orderCards(id: string, cardIds: string[]): Promise<Panel> {
  const { panel } = await api<{ panel: Panel }>(`${panelPath(id)}/order`, { method: "POST", body: JSON.stringify({ cardIds }) });
  return kept(panel);
}

/** Makes the card and the automation that keeps it, and starts its first run; a `test` card is a draft. */
export async function newCard(id: string, request: PanelNewCardRequest): Promise<{ panel: Panel; card: PanelCard; routineId: string }> {
  const result = await api<{ panel: Panel; card: PanelCard; routineId: string }>(`${panelPath(id)}/cards/new`, { method: "POST", body: JSON.stringify(request) });
  kept(result.panel);
  return result;
}

/** Adds a draft to the panel; a different `toPanelId` moves it, with its automation, to that panel. */
export async function keepCard(id: string, cardId: string, toPanelId?: string): Promise<Panel> {
  const body = toPanelId && toPanelId !== id ? { panelId: toPanelId } : {};
  const { panel } = await api<{ panel: Panel }>(`${cardPath(id, cardId)}/keep`, { method: "POST", body: JSON.stringify(body) });
  if (panel.id !== id) changed(id);
  return kept(panel);
}

export async function pinnableBlocks(limit = 30): Promise<PanelPinnableBlock[]> {
  const { blocks } = await api<{ blocks: PanelPinnableBlock[] }>(`${PANELS_PATH}/pinnable?limit=${limit}`);
  return blocks ?? [];
}

export async function pinBlock(id: string, block: { threadId: string; messageId: string }, size?: PanelCardSize): Promise<{ panel: Panel; card: PanelCard }> {
  const result = await api<{ panel: Panel; card: PanelCard }>(`${panelPath(id)}/cards/pin`, {
    method: "POST",
    body: JSON.stringify({ threadId: block.threadId, messageId: block.messageId, ...(size ? { size } : {}) }),
  });
  kept(result.panel);
  return result;
}

/** The automation that keeps a card: its own (by card key) first, else one that keeps the whole panel. */
export function cardAutomation(panel: Panel, card: PanelCard): PanelAutomation | undefined {
  const automations = (panel.automations ?? []).filter((automation) => automation.enabled);
  return (card.key ? automations.find((automation) => automation.cardKey === card.key) : undefined)
    ?? automations.find((automation) => !automation.cardKey);
}
