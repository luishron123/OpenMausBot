// `panels.json` in the data folder: the boards bots keep and their cards. A missing file is no panels; a panel or card that
// does not parse is left out, so one bad record never hides the rest. The file is read again whenever it changed on disk,
// so a copy written by hand (or by another tool) is what the next request sees. A file this version cannot read whole
// (corrupt, or a newer version) is never written over: changes are refused until it is fixed.
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";

import { PANEL_CARD_SIZES, PANEL_KEY, PANEL_LIMITS, PANELS_VERSION, type Panel, type PanelCard, type PanelCardSize } from "../../shared/panels.ts";
import type { WidgetRoot } from "../../shared/widget.ts";
import { writeFileAtomic } from "../atomic.ts";
import { redactSecretsInText } from "../redact.ts";

export const PANELS_FILE = "panels.json";

/** `features.panels`: on unless false. */
export function panelsEnabled(cfg: { features?: { panels?: boolean } }): boolean {
  return cfg.features?.panels !== false;
}

const id = z.string().min(1).max(100);
const stamp = z.string().min(1).max(40);
const key = z.string().regex(PANEL_KEY);
export const cardSchema = z.looseObject({
  id, key: key.optional(),
  title: z.string().min(1).max(PANEL_LIMITS.title),
  size: z.enum(PANEL_CARD_SIZES),
  position: z.number().int().min(0),
  widget: z.record(z.string(), z.unknown()).optional(),
  text: z.string().max(PANEL_LIMITS.fallbackText).optional(),
  botId: id,
  updatedAt: stamp,
  status: z.enum(["ok", "failed"]),
  failure: z.string().max(PANEL_LIMITS.failure).optional(),
  failedAt: stamp.optional(),
});
export const panelSchema = z.looseObject({
  id, key: key.optional(),
  title: z.string().min(1).max(PANEL_LIMITS.title),
  about: z.string().max(PANEL_LIMITS.about).optional(),
  createdBy: z.object({ botId: id, threadId: z.string().max(200).optional() }),
  createdAt: stamp, updatedAt: stamp,
  position: z.number().int().min(0),
  cards: z.array(z.unknown()).max(PANEL_LIMITS.cardsPerPanel),
});
const fileSchema = z.object({ version: z.literal(PANELS_VERSION), panels: z.array(z.unknown()) });

/** A panel that parses, with only its cards that parse; null when the panel itself does not. */
export function parsePanel(candidate: unknown): Panel | null {
  const panel = panelSchema.safeParse(candidate);
  if (!panel.success) return null;
  const cards = panel.data.cards.flatMap((card) => {
    const parsed = parseCard(card);
    return parsed ? [parsed] : [];
  });
  const { automations: _automations, ...stored } = panel.data as typeof panel.data & { automations?: unknown };
  return { ...stored, cards } as Panel;
}

export function parseCard(candidate: unknown): PanelCard | null {
  const card = cardSchema.safeParse(candidate);
  return card.success ? (card.data as PanelCard) : null;
}

type Read = { panels: Panel[]; writable: true } | { panels: Panel[]; writable: false; why: string };

export function readPanelsFile(file: string): Read {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { panels: [], writable: true };
  }
  let parsed;
  try {
    parsed = fileSchema.safeParse(JSON.parse(text));
  } catch {
    return { panels: [], writable: false, why: `${PANELS_FILE} in the data folder is not valid JSON` };
  }
  if (!parsed.success) return { panels: [], writable: false, why: `${PANELS_FILE} in the data folder was written by another version` };
  return { panels: parsed.data.panels.flatMap((one) => { const panel = parsePanel(one); return panel ? [panel] : []; }), writable: true };
}

export function writePanelsFile(file: string, panels: readonly Panel[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const stored = panels.map(({ automations: _automations, ...panel }) => panel);
  writeFileAtomic(file, JSON.stringify({ version: PANELS_VERSION, panels: stored }, null, 2), { mode: 0o600 });
}

export type PanelsError = { ok: false; status: 400 | 404 | 409; error: string };
export type PanelsResult<T> = ({ ok: true } & T) | PanelsError;

export interface PanelsChange {
  panelId: string;
  botId: string;
  removed?: true;
}

export interface CardContent {
  widget: WidgetRoot;
  text: string;
}

const fail = (status: PanelsError["status"], error: string): PanelsError => ({ ok: false, status, error });
const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const tooBig = (card: PanelCard) => byteLength(card) > PANEL_LIMITS.cardBytes;
const TOO_BIG = `widget: this card is over ${PANEL_LIMITS.cardBytes / 1000} KB; show fewer rows or shorter text.`;
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const nextPosition = (items: ReadonlyArray<{ position: number }>) => items.reduce((top, item) => Math.max(top, item.position + 1), 0);
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export interface PanelStoreOptions {
  dataDir: string;
  now?: () => Date;
}

export function createPanelStore(options: PanelStoreOptions) {
  const file = join(options.dataDir, PANELS_FILE);
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const listeners = new Set<(change: PanelsChange) => void>();
  let cache: Read = { panels: [], writable: true };
  let seen: string | null = null;

  const signature = () => {
    try {
      const stat = statSync(file);
      return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    } catch {
      return "missing";
    }
  };
  const load = (): Read => {
    const current = signature();
    if (current !== seen) {
      cache = readPanelsFile(file);
      seen = current;
    }
    return cache;
  };
  const save = (panels: Panel[]) => {
    writePanelsFile(file, panels);
    cache = { panels, writable: true };
    seen = signature();
  };
  /** Changes the panels read fresh from disk; nothing is written when `apply` fails. */
  const change = <T extends object>(apply: (panels: Panel[]) => PanelsResult<T & { change: PanelsChange }>): PanelsResult<T> => {
    const read = load();
    if (!read.writable) return fail(409, `Panels can't be changed: ${read.why}. Fix or move that file, then try again.`);
    const panels = structuredClone(read.panels);
    const result = apply(panels);
    if (!result.ok) return result;
    save(panels);
    const { change: made, ...rest } = result;
    for (const listener of listeners) listener(made);
    return rest as PanelsResult<T>;
  };
  const touched = (panel: Panel, at: string): PanelsChange => {
    panel.updatedAt = at;
    return { panelId: panel.id, botId: panel.createdBy.botId };
  };
  const findPanel = (panels: Panel[], panelId: string) => panels.find((panel) => panel.id === panelId);
  const findCard = (panel: Panel, ref: { cardId?: string; key?: string }) =>
    panel.cards.find((card) => (ref.cardId ? card.id === ref.cardId : card.key === ref.key));

  return {
    file,
    onChange(listener: (change: PanelsChange) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Every panel, the most recently updated first. */
    list(): Panel[] {
      return [...load().panels].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    get(panelId: string): Panel | undefined {
      return load().panels.find((panel) => panel.id === panelId);
    },
    byKey(panelKey: string): Panel | undefined {
      return load().panels.find((panel) => panel.key === panelKey);
    },

    /** With a key some panel already has, that panel comes back unchanged and `created` is false. */
    create(input: { title: string; about?: string; key?: string; createdBy: Panel["createdBy"] }): PanelsResult<{ panel: Panel; created: boolean }> {
      return change((panels) => {
        const existing = input.key ? panels.find((panel) => panel.key === input.key) : undefined;
        if (existing) return { ok: true, panel: existing, created: false, change: { panelId: existing.id, botId: existing.createdBy.botId } };
        if (panels.length >= PANEL_LIMITS.panels) return fail(409, `There are already ${PANEL_LIMITS.panels} panels. Ask the person to remove one in Panels, or reuse one from list_panels.`);
        const at = now();
        const panel: Panel = {
          id: newId("pnl"), ...(input.key ? { key: input.key } : {}), title: input.title, ...(input.about ? { about: input.about } : {}),
          createdBy: input.createdBy, createdAt: at, updatedAt: at, position: nextPosition(panels), cards: [],
        };
        panels.push(panel);
        return { ok: true, panel, created: true, change: { panelId: panel.id, botId: panel.createdBy.botId } };
      });
    },

    patch(panelId: string, input: { title?: string; about?: string }): PanelsResult<{ panel: Panel }> {
      return change((panels) => {
        const panel = findPanel(panels, panelId);
        if (!panel) return fail(404, "No such panel.");
        if (input.title !== undefined) panel.title = input.title;
        if (input.about !== undefined) {
          if (input.about) panel.about = input.about;
          else delete panel.about;
        }
        return { ok: true, panel, change: touched(panel, now()) };
      });
    },

    remove(panelId: string): PanelsResult<{ panel: Panel }> {
      return change((panels) => {
        const index = panels.findIndex((panel) => panel.id === panelId);
        if (index < 0) return fail(404, "No such panel.");
        const [panel] = panels.splice(index, 1);
        return { ok: true, panel: panel!, change: { panelId, botId: panel!.createdBy.botId, removed: true } };
      });
    },

    /** Undo of a removal: the panel as it was read before, back under its own id. */
    restore(panel: Panel): PanelsResult<{ panel: Panel }> {
      return change((panels) => {
        if (findPanel(panels, panel.id)) return fail(409, "That panel is already here.");
        if (panel.key && panels.some((one) => one.key === panel.key)) return fail(409, `Another panel has the key ${panel.key} now.`);
        if (panels.length >= PANEL_LIMITS.panels) return fail(409, `There are already ${PANEL_LIMITS.panels} panels. Remove one first.`);
        panels.push(panel);
        return { ok: true, panel, change: { panelId: panel.id, botId: panel.createdBy.botId } };
      });
    },

    /** Makes a card, or with a key a card of this panel already has, replaces that card's title, content and size. */
    setCard(panelId: string, input: { key?: string; title: string; size?: PanelCardSize; content?: CardContent; botId: string }): PanelsResult<{ panel: Panel; card: PanelCard; created: boolean }> {
      return change((panels) => {
        const panel = findPanel(panels, panelId);
        if (!panel) return fail(404, `No panel ${panelId}. Call list_panels for the ids, or create_panel first.`);
        const at = now();
        const existing = input.key ? findCard(panel, { key: input.key }) : undefined;
        if (!existing && panel.cards.length >= PANEL_LIMITS.cardsPerPanel) {
          return fail(409, `This panel already has ${PANEL_LIMITS.cardsPerPanel} cards. Replace one by its key, or make another panel.`);
        }
        const card: PanelCard = {
          id: existing?.id ?? newId("crd"), ...(input.key ? { key: input.key } : {}), title: input.title,
          size: input.size ?? existing?.size ?? "s", position: existing?.position ?? nextPosition(panel.cards),
          ...(input.content ? { widget: input.content.widget, text: clip(input.content.text, PANEL_LIMITS.fallbackText) } : {}),
          botId: input.botId, updatedAt: at, status: "ok",
        };
        if (tooBig(card)) return fail(400, TOO_BIG);
        if (existing) panel.cards[panel.cards.indexOf(existing)] = card;
        else panel.cards.push(card);
        return { ok: true, panel, card, created: !existing, change: touched(panel, at) };
      });
    },

    /** Changes one card in place. A failure keeps the card's last content and says why; new content clears a failure. */
    updateCard(panelId: string, ref: { cardId?: string; key?: string }, input: { title?: string; size?: PanelCardSize; content?: CardContent; failed?: string; botId: string }): PanelsResult<{ panel: Panel; card: PanelCard }> {
      return change((panels) => {
        const panel = findPanel(panels, panelId);
        if (!panel) return fail(404, `No panel ${panelId}. Call list_panels for the ids.`);
        const card = findCard(panel, ref);
        if (!card) return fail(404, `No card ${ref.cardId ?? ref.key} on this panel. Call list_panels with {"panel_id":"${panelId}"} for its cards, or make it with set_panel_widget.`);
        const at = now();
        const next: PanelCard = { ...card, botId: input.botId, updatedAt: at };
        if (input.title !== undefined) next.title = input.title;
        if (input.size !== undefined) next.size = input.size;
        if (input.content) {
          next.widget = input.content.widget;
          next.text = clip(input.content.text, PANEL_LIMITS.fallbackText);
          next.status = "ok";
          delete next.failure;
          delete next.failedAt;
        }
        if (input.failed !== undefined) {
          next.status = "failed";
          // The card shows this sentence to everyone who sees the panel: it loses its secrets as a widget's text does.
          next.failure = clip(redactSecretsInText(input.failed), PANEL_LIMITS.failure);
          next.failedAt = at;
        }
        if (tooBig(next)) return fail(400, TOO_BIG);
        panel.cards[panel.cards.indexOf(card)] = next;
        return { ok: true, panel, card: next, change: touched(panel, at) };
      });
    },

    /** The person's rename or resize: the card's content, author and time stay as they were. */
    patchCard(panelId: string, cardId: string, input: { title?: string; size?: PanelCardSize }): PanelsResult<{ panel: Panel; card: PanelCard }> {
      return change((panels) => {
        const panel = findPanel(panels, panelId);
        if (!panel) return fail(404, "No such panel.");
        const card = findCard(panel, { cardId });
        if (!card) return fail(404, "No such card.");
        if (input.title !== undefined) card.title = input.title;
        if (input.size !== undefined) card.size = input.size;
        return { ok: true, panel, card, change: touched(panel, now()) };
      });
    },

    removeCard(panelId: string, cardId: string): PanelsResult<{ panel: Panel; card: PanelCard }> {
      return change((panels) => {
        const panel = findPanel(panels, panelId);
        if (!panel) return fail(404, "No such panel.");
        const card = findCard(panel, { cardId });
        if (!card) return fail(404, "No such card.");
        panel.cards.splice(panel.cards.indexOf(card), 1);
        return { ok: true, panel, card, change: touched(panel, now()) };
      });
    },

    /** Undo of a card's removal: back under its own id and place. */
    restoreCard(panelId: string, card: PanelCard): PanelsResult<{ panel: Panel }> {
      return change((panels) => {
        const panel = findPanel(panels, panelId);
        if (!panel) return fail(404, "No such panel.");
        if (findCard(panel, { cardId: card.id })) return fail(409, "That card is already here.");
        if (card.key && findCard(panel, { key: card.key })) return fail(409, `Another card has the key ${card.key} now.`);
        if (panel.cards.length >= PANEL_LIMITS.cardsPerPanel) return fail(409, `This panel already has ${PANEL_LIMITS.cardsPerPanel} cards. Remove one first.`);
        if (tooBig(card)) return fail(400, TOO_BIG);
        panel.cards.push(card);
        panel.cards.sort((a, b) => a.position - b.position);
        return { ok: true, panel, change: touched(panel, now()) };
      });
    },
  };
}

export type PanelStore = ReturnType<typeof createPanelStore>;
