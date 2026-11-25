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
  /** Cards with a schedule other than "manual", across every panel. */
  scheduledCards: 60,
  historyPerCard: 20,
  prompt: 2_000,
  alert: 300,
  summary: 300,
  sources: 8,
  source: 300,
  /** A draft not kept is removed after this long. */
  draftMs: 3_600_000,
  /** Drafts on one panel at a time; they are not counted in `cardsPerPanel` nor `scheduledCards`. */
  draftsPerPanel: 4,
} as const;

/** Why a card's own automation failed, for the screen to say in the person's language; `failure` keeps an English
 * sentence for builds that do not know the code. "paused": five failures in a row turned it off. "no_update": a run
 * ended without updating the card. "engine": the bot's AI cannot run it read-only. */
export const PANEL_FAILURE_CODES = ["paused", "no_update", "engine"] as const;
export type PanelFailureCode = (typeof PANEL_FAILURE_CODES)[number];

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

/** How often a card's own automation runs, in the person's time zone: every 30 minutes, every hour, each day at 08:00,
 * each Monday at 08:00, or only when asked (Refresh now, Ask for a change, Test). */
export const PANEL_SCHEDULES = ["half", "hour", "day", "week", "manual"] as const;
export type PanelSchedule = (typeof PANEL_SCHEDULES)[number];

/** The cadence a schedule is shown as. */
export const PANEL_SCHEDULE_CADENCE: Record<PanelSchedule, PanelCadence | "custom"> = { half: "custom", hour: "hourly", day: "daily", week: "weekly", manual: "on-request" };
/** The schedule New widget's older `cadence` field stands for. */
export const PANEL_CADENCE_SCHEDULE: Record<PanelCadence, PanelSchedule> = { "on-request": "manual", hourly: "hour", daily: "day", weekly: "week" };

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
  /** Set with `failure` when the server, not the bot, failed the card. */
  failureCode?: PanelFailureCode;
  /** Made by New widget's Test and not added yet: not drawn on the panel nor counted, dropped when the dialog closes. */
  draft?: true;
  /** What the person asked to keep track of in New widget. */
  prompt?: string;
  format?: PanelCardFormat;
  /** Tell the person when an update changes what the card shows. */
  notify?: boolean;
  /** The chat block this card was pinned from. */
  pinnedFrom?: { threadId: string; messageId: string };
  /** When a draft was made; it is removed `PANEL_LIMITS.draftMs` later unless kept. */
  draftAt?: string;
  /** How often the card's own automation brings it up to date; absent = no own automation. */
  schedule?: PanelSchedule;
  /** The card's own automation, made, changed and removed by the server with the card. */
  routineId?: string;
  /** How the card's own automation runs: "fenced" read-only, or "bot" with the bot's usual access because its engine has no
   * read-only mode. */
  updateAccess?: "fenced" | "bot";
  /** The condition to alert on, in words, e.g. "falls 20% below yesterday". */
  alert?: string;
  /** The last alert an update raised, until the person clears it. */
  alertActive?: { text: string; at: string };
  /** What the bot read for the last update: short names or URLs. */
  sources?: string[];
  /** Has a prompt and no widget yet: its first run is going. */
  building?: true;
  /** Its own automation is waiting (a usage limit, a budget, a computer that is off), and until when if known. */
  held?: { reason: string; until?: string };
}

/** One past update of a card, newest first, at most `PANEL_LIMITS.historyPerCard`. Kept in `panels-history.json`. */
export interface PanelCardUpdate {
  at: string;
  status: PanelCardStatus;
  summary?: string;
  failure?: string;
  failureCode?: PanelFailureCode;
  /** The tree the card showed after this update. */
  widget?: WidgetRoot;
  alert?: string;
  /** The person's Ask for a change this update answered. */
  change?: string;
  /** From the run's recorded usage; absent when none was recorded. */
  costUsd?: number;
  tokens?: number;
  runId?: string;
  threadId?: string;
}

/** `PATCH /api/panels/:id/cards/:cardId`. `alert: ""` clears the alert condition. */
export interface PanelCardPatchRequest {
  title?: string;
  size?: PanelCardSize;
  prompt?: string;
  schedule?: PanelSchedule;
  alert?: string;
  notify?: boolean;
  botId?: string;
}

/** `GET /api/panels/estimate?botId=&schedule=`: the bot's recent average run cost times runs per day; null without data. */
export interface PanelEstimate {
  perDayUsd: number | null;
  basis: "recent-runs" | "none";
}

/** `GET /api/panels/suggestions?botId=`: up to 3, made from the bot's role and automations without asking a model. */
export interface PanelSuggestion {
  title: string;
  prompt: string;
  format: PanelCardFormat;
  schedule: PanelSchedule;
}

/** `GET /api/panels/alerts`: cards with an alert the person has not cleared, newest first, for Waiting on you and the
 * dot on Panels in the menu. Cleared with `POST /api/panels/:id/cards/:cardId/alert/clear`. */
export interface PanelAlert {
  panelId: string;
  panelTitle: string;
  cardId: string;
  cardTitle: string;
  text: string;
  at: string;
}

/** The shape of a card's main block, for a panel's thumbnail. */
export type PanelThumbKind = Exclude<PanelCardFormat, "auto"> | "widget" | "empty";

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
  /** Up to 8 cards in order, for the list's thumbnail. */
  thumb?: Array<{ size: PanelCardSize; kind: PanelThumbKind }>;
  /** Cards with an alert the person has not cleared. */
  alertCount?: number;
}

/** `POST /api/panels/:id/cards/new`: New widget. Makes the card (a draft when `test`) and the automation that keeps it,
 * and starts that automation's first run now. Answers `{ panel, card, routineId }`. */
export interface PanelNewCardRequest {
  prompt: string;
  title?: string;
  format: PanelCardFormat;
  size: PanelCardSize;
  botId: string;
  /** Preferred over `cadence`; one of the two is required. */
  schedule?: PanelSchedule;
  cadence?: PanelCadence;
  alert?: string;
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

type Node = { type?: unknown; children?: unknown; series?: unknown };

/** The shape of a card's main block: the format the person asked for, else the first chart, progress or list in it. */
export function panelThumbKind(card: Pick<PanelCard, "format" | "widget">): PanelThumbKind {
  if (card.format && card.format !== "auto") return card.format;
  if (!card.widget) return "empty";
  const stack: Node[] = [card.widget as unknown as Node];
  for (let seen = 0; stack.length && seen < 400; seen += 1) {
    const node = stack.shift()!;
    if (node.type === "Chart") return Array.isArray(node.series) && node.series.some((one) => (one as { type?: unknown }).type === "line" || (one as { type?: unknown }).type === "area") ? "line" : "bar";
    if (node.type === "Progress") return "goal";
    if (node.type === "ListView" || node.type === "Checkbox") return "checklist";
    if (Array.isArray(node.children)) stack.push(...(node.children as Node[]));
  }
  return "widget";
}

export function panelSummary(panel: Panel): PanelSummary {
  const shown = panel.cards.filter((card) => !card.draft).sort((a, b) => a.position - b.position);
  return {
    id: panel.id,
    ...(panel.key ? { key: panel.key } : {}),
    title: panel.title,
    ...(panel.about ? { about: panel.about } : {}),
    createdBy: panel.createdBy,
    createdAt: panel.createdAt,
    updatedAt: panel.updatedAt,
    cardCount: shown.length,
    failedCount: shown.filter((card) => card.status === "failed").length,
    ...(panel.visibility ? { visibility: panel.visibility } : {}),
    thumb: shown.slice(0, 8).map((card) => ({ size: card.size, kind: panelThumbKind(card) })),
    alertCount: shown.filter((card) => card.alertActive).length,
  };
}
