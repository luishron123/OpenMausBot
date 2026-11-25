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

/** The shape the person asked for in New widget; "auto" lets the bot pick. Told to the bot, never enforced on the tree. */
export const PANEL_CARD_FORMATS = ["auto", "kpi", "goal", "line", "bar", "checklist", "text"] as const;
export type PanelCardFormat = (typeof PANEL_CARD_FORMATS)[number];

/** How often a card made in New widget is brought up to date. "on-request" has no schedule: it runs only on Refresh now. */
export const PANEL_CADENCES = ["on-request", "hourly", "daily", "weekly"] as const;
export type PanelCadence = (typeof PANEL_CADENCES)[number];

/** Who sees a panel. "private": the person and the bots whose cards are on it. "shared": everyone who sees its maker bot. */
export const PANEL_VISIBILITIES = ["private", "shared"] as const;
export type PanelVisibility = (typeof PANEL_VISIBILITIES)[number];

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
  /** Made by New widget's Test and not added yet: not drawn on the panel nor counted, dropped when the dialog closes. */
  draft?: true;
  /** What the person asked to keep track of in New widget. */
  prompt?: string;
  format?: PanelCardFormat;
  /** Tell the person when an update changes what the card shows. */
  notify?: boolean;
  /** The chat block this card was pinned from. */
  pinnedFrom?: { threadId: string; messageId: string };
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
  /** The one card this automation keeps; absent when it keeps the whole panel. */
  cardKey?: string;
  /** Its schedule as a cadence when it is one of these; otherwise "custom" with the routine's own schedule text. */
  cadence?: PanelCadence | "custom";
  scheduleText?: string;
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
  /** Absent reads as "shared", what every panel was before this field. */
  visibility?: PanelVisibility;
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
  visibility?: PanelVisibility;
}

/** `POST /api/panels/:id/cards/new`: New widget. Makes the card (a draft when `test`) and the automation that keeps it,
 * and starts that automation's first run now. Answers `{ panel, card, routineId }`. */
export interface PanelNewCardRequest {
  prompt: string;
  title?: string;
  format: PanelCardFormat;
  size: PanelCardSize;
  botId: string;
  cadence: PanelCadence;
  notify: boolean;
  test: boolean;
}

/** `GET /api/panels/pinnable`: recent widgets the person's bots posted in chat, newest first. */
export interface PanelPinnableBlock {
  threadId: string;
  messageId: string;
  botId: string;
  title: string;
  at: string;
  text?: string;
}

export const PANELS_PATH = "/api/panels";

/** Live frame: a panel was made, changed or removed. The page reads it again by id. */
export interface PanelsChangedFrame {
  kind: "panels.changed";
  panelId: string;
  removed?: true;
  /** The bot that made the panel: a Team Cloud sends the frame only to who sees that bot. */
  botId?: string;
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
    cardCount: panel.cards.filter((card) => !card.draft).length,
    failedCount: panel.cards.filter((card) => !card.draft && card.status === "failed").length,
    ...(panel.visibility ? { visibility: panel.visibility } : {}),
  };
}
