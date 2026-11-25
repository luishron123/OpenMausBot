// `panels-history.json` in the data folder: the last updates of each card, newest first, for the card's side panel. A
// separate file, so `panels.json` keeps the shape older versions read; a file that does not parse reads as no history and
// is written over by the next update, since history is only a record.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PANEL_LIMITS, type PanelCardUpdate } from "../../shared/panels.ts";
import { writeFileAtomic } from "../atomic.ts";

export const PANELS_HISTORY_FILE = "panels-history.json";

type Cards = Record<string, PanelCardUpdate[]>;

export function createPanelHistory(options: { dataDir: string }) {
  const file = join(options.dataDir, PANELS_HISTORY_FILE);
  const read = (): Cards => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; cards?: unknown };
      return parsed.version === 1 && parsed.cards && typeof parsed.cards === "object" ? parsed.cards as Cards : {};
    } catch {
      return {};
    }
  };
  const write = (cards: Cards) => {
    mkdirSync(options.dataDir, { recursive: true });
    writeFileAtomic(file, JSON.stringify({ version: 1, cards }), { mode: 0o600 });
  };

  return {
    file,
    /** Newest first. */
    list(cardId: string): PanelCardUpdate[] {
      const found = read()[cardId];
      return Array.isArray(found) ? found : [];
    },
    add(cardId: string, update: PanelCardUpdate): void {
      const cards = read();
      cards[cardId] = [update, ...(Array.isArray(cards[cardId]) ? cards[cardId]! : [])].slice(0, PANEL_LIMITS.historyPerCard);
      write(cards);
    },
    /** Sets what a run cost on the update it made, once the run has ended and its cost is known. */
    costed(cardId: string, runId: string, costUsd: number): void {
      const cards = read();
      const update = cards[cardId]?.find((one) => one.runId === runId);
      if (!update) return;
      update.costUsd = costUsd;
      write(cards);
    },
    /** How many of the newest updates failed in a row. */
    failuresInARow(cardId: string): number {
      const updates = this.list(cardId);
      const ok = updates.findIndex((one) => one.status !== "failed");
      return ok < 0 ? updates.length : ok;
    },
    forget(cardId: string): void {
      const cards = read();
      if (!(cardId in cards)) return;
      delete cards[cardId];
      write(cards);
    },
  };
}

export type PanelHistory = ReturnType<typeof createPanelHistory>;
