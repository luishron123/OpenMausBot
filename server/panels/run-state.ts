// `panels-runs.json` in the data folder: what a card's own runs carry across a restart. A separate file, so `panels.json`
// keeps the shape older versions read; a file that does not parse reads as empty, as the state only shortens what a run
// already knows.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";

export const PANELS_RUNS_FILE = "panels-runs.json";
/** Each list keeps its newest entries: a run that ended while the server was off, or a removal never undone, is never cleared. */
const KEEP = 200;

interface RunState {
  /** Runs that already updated their card. */
  updated: string[];
  /** Runs already told once that they have not updated their card. */
  reminded: string[];
  /** The person's Ask for a change, by routine, until the run it started updates the card or ends. */
  asked: Record<string, string>;
  /** Routines a card's removal paused, by card id, so its Undo turns them back on. */
  paused: Record<string, string[]>;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

export function createPanelRunState(options: { dataDir: string }) {
  const file = join(options.dataDir, PANELS_RUNS_FILE);
  const read = (): RunState => {
    try {
      const parsed = record(JSON.parse(readFileSync(file, "utf8")));
      if (parsed.version !== 1) throw new Error("another version");
      const asked = Object.fromEntries(Object.entries(record(parsed.asked)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      const paused = Object.fromEntries(Object.entries(record(parsed.paused)).map(([cardId, ids]) => [cardId, strings(ids)]));
      return { updated: strings(parsed.updated), reminded: strings(parsed.reminded), asked, paused };
    } catch {
      return { updated: [], reminded: [], asked: {}, paused: {} };
    }
  };
  const change = <T>(apply: (state: RunState) => T): T => {
    const state = read();
    const result = apply(state);
    state.updated = state.updated.slice(-KEEP);
    state.reminded = state.reminded.slice(-KEEP);
    state.paused = Object.fromEntries(Object.entries(state.paused).slice(-KEEP));
    mkdirSync(options.dataDir, { recursive: true });
    writeFileAtomic(file, JSON.stringify({ version: 1, ...state }), { mode: 0o600 });
    return result;
  };
  const mark = (list: "updated" | "reminded") => ({
    has: (runId: string): boolean => read()[list].includes(runId),
    add: (runId: string): void => change((state) => { if (!state[list].includes(runId)) state[list].push(runId); }),
  });

  return {
    file,
    updated: mark("updated"),
    reminded: mark("reminded"),
    asked: {
      get: (routineId: string): string | undefined => read().asked[routineId],
      set: (routineId: string, text: string): void => change((state) => { state.asked[routineId] = text; }),
      delete: (routineId: string): void => { if (read().asked[routineId] !== undefined) change((state) => { delete state.asked[routineId]; }); },
    },
    /** Whether the run updated its card; what the run left here is cleared. */
    ended(runId: string, routineId: string): boolean {
      const now = read();
      if (!now.updated.includes(runId) && !now.reminded.includes(runId) && now.asked[routineId] === undefined) return false;
      return change((state) => {
        const did = state.updated.includes(runId);
        state.updated = state.updated.filter((one) => one !== runId);
        state.reminded = state.reminded.filter((one) => one !== runId);
        delete state.asked[routineId];
        return did;
      });
    },
    pausedByRemoval(cardId: string, routineIds: string[]): void {
      change((state) => { state.paused[cardId] = routineIds; });
    },
    /** The routines a card's removal paused, taken. */
    takePaused(cardId: string): string[] {
      const ids = read().paused[cardId];
      if (!ids) return [];
      change((state) => { delete state.paused[cardId]; });
      return ids;
    },
  };
}

export type PanelRunState = ReturnType<typeof createPanelRunState>;
