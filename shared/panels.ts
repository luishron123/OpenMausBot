// Panels: boards of cards that bots set and later replace in place. A card holds the same widget tree `show_widget`
// posts in chat, so it is drawn by the chat's own renderer. Stored in `panels.json` in the data folder (a new file, so
// an older build ignores it and DATA_FORMAT is unchanged).
import type { WidgetRoot } from "./widget.ts";

export const PANELS_VERSION = 1;

export const PANEL_LIMITS = {
  panels: 50,
  cardsPerPanel: 24,
  cardBytes: 64_000,
  title: 120,
  about: 400,
  key: 64,
  failure: 400,
  fallbackText: 1_500,
} as const;

/** Lowercase letters, digits and hyphens: the key a bot gives a panel or card so making it again finds the same one. */
export const PANEL_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const PANEL_CARD_SIZES = ["s", "m", "l"] as const;
export type PanelCardSize = (typeof PANEL_CARD_SIZES)[number];

export type PanelCardStatus = "ok" | "failed";

export interface PanelAuthor {
  botId: string;
  threadId?: string;
}

export interface PanelCard {
  id: string;
  key?: string;
  title: string;
  size: PanelCardSize;
  position: number;
  /** Absent until the first update: the card waits for data. */
  widget?: WidgetRoot;
  /** Plain text of the card, for screen readers, search and narrow screens. */
  text?: string;
  botId: string;
  updatedAt: string;
  status: PanelCardStatus;
  /** Why the last update failed, one sentence; the widget keeps the last good data. */
  failure?: string;
  failedAt?: string;
}

export interface PanelAutomation {
  routineId: string;
  name: string;
  botId: string;
  enabled: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  /** The last run's thread, to open what it did. */
  lastRunThreadId?: string;
  /** True while a run of it is going. */
  running?: boolean;
  /** The last finished run did not set or update any card of this panel. */
  lastRunUpdatedNothing?: boolean;
}

export interface Panel {
  id: string;
  key?: string;
  title: string;
  about?: string;
  createdBy: PanelAuthor;
  createdAt: string;
  updatedAt: string;
  position: number;
  cards: PanelCard[];
  /** Filled by the server on read, never stored: automations linked to this panel. */
  automations?: PanelAutomation[];
}

export interface PanelsFile {
  version: typeof PANELS_VERSION;
  panels: Panel[];
}

/** One row of the list: the panel without its cards' trees. */
export interface PanelSummary {
  id: string;
  key?: string;
  title: string;
  about?: string;
  createdBy: PanelAuthor;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  failedCount: number;
}

export const PANELS_PATH = "/api/panels";

/** Live frame: a panel was made, changed or removed. The page reads it again by id. */
export interface PanelsChangedFrame {
  kind: "panels.changed";
  panelId: string;
  removed?: true;
}

export function panelSummary(panel: Panel): PanelSummary {
  return {
    id: panel.id,
    ...(panel.key ? { key: panel.key } : {}),
    title: panel.title,
    ...(panel.about ? { about: panel.about } : {}),
    createdBy: panel.createdBy,
    createdAt: panel.createdAt,
    updatedAt: panel.updatedAt,
    cardCount: panel.cards.length,
    failedCount: panel.cards.filter((card) => card.status === "failed").length,
  };
}
