// A card's own automation: the routine the server makes, changes and removes for a card that has a prompt (the card's
// `routineId`), as opposed to a routine a bot linked to a panel by itself (automations.ts), which keeps working as it
// always did. A run of a card's own routine may only update that one card, once; ending without an update is a failure,
// and five failures in a row pause the routine until the person resolves it.
// Security invariant: a card's own routine is read-and-draft (read-and-draft.ts), so its unattended run reads and may
// reach no route but its card's update, and it runs only on an engine whose every tool use that fence answers; its reply
// reaches no chat.
import {
  PANEL_CADENCE_SCHEDULE, PANEL_LIMITS, PANEL_SCHEDULE_CADENCE, PANEL_SCHEDULES,
  type Panel, type PanelAutomation, type PanelCard, type PanelSchedule, type PanelCardUpdate,
} from "../../shared/panels.ts";
import type { Routine, RoutineRun } from "../routines.ts";
import type { RoutineScheduleInput } from "../routine-schedules.ts";
import type { PanelRoutines } from "./automations.ts";
import type { PanelHistory } from "./history.ts";
import type { PanelRunState } from "./run-state.ts";
import { PANEL_FULL, type PanelStore, type PanelsResult } from "./store.ts";

export interface PanelCardsDeps {
  store: PanelStore;
  history: PanelHistory;
  state: PanelRunState;
  /** Whether this bot's engine runs a read-and-draft routine inside the fence; without it, every engine does. */
  fenced?(botId: string): boolean;
  enabled(): boolean;
  routines(): PanelRoutines | null;
  /** The person's time zone, for "each day at 08:00". */
  timeZone(): string;
  /** Tells the person something about a bot's card, through the app's notifications. */
  notice?(botId: string, text: string): void;
  now?(): number;
}

export const FAILURES_TO_PAUSE = 5;
export const PAUSED_FAILURE = `Paused after ${FAILURES_TO_PAUSE} failures in a row. Resolve turns it back on.`;
export const NO_UPDATE_FAILURE = "no_update: the update run ended without calling update_panel_widget.";
export const ALREADY_UPDATED = "This run already updated its card. Stop here; the next run updates it again.";
export const ENGINE_FAILURE = "engine: this bot's AI cannot update a card read-only. Switch the bot to a Claude model, then Resolve.";
export const NOT_FENCED_FAILURE = "engine: this card's automation was made before cards updated read-only; it is read-only now, and its next run updates the card.";
export const SCHEDULED_FULL = `There are already ${PANEL_LIMITS.scheduledCards} cards that update by themselves. Choose Manual, or remove a scheduled card first.`;

const GOING = new Set(["queued", "running", "waiting"]);
const ENDED_BADLY = new Set(["completed", "failed"]);
const RUNS_PER_DAY: Record<PanelSchedule, number> = { half: 48, hour: 24, day: 1, week: 1 / 7, manual: 0 };
const isScheduled = (schedule: PanelSchedule | undefined) => schedule !== undefined && schedule !== "manual";
const READ_ONLY = "read-and-draft";

export function runsPerDay(schedule: PanelSchedule): number {
  return RUNS_PER_DAY[schedule];
}

/** The routine schedule behind a card's: "manual" is a one-time routine kept off, which only Refresh or a test runs. */
export function routineSchedule(schedule: PanelSchedule, timeZone: string, now: number): RoutineScheduleInput {
  if (schedule === "half" || schedule === "hour") return { type: "interval", everyMinutes: schedule === "half" ? 30 : 60, anchorAt: now };
  if (schedule === "day") return { type: "cron", expression: "0 8 * * *", timeZone };
  if (schedule === "week") return { type: "cron", expression: "0 8 * * 1", timeZone };
  return { type: "once", at: now };
}

/** The card schedule a routine's schedule matches, or null for one a card could not have chosen. */
export function scheduleOf(routine: Pick<Routine, "schedule" | "enabled">): PanelSchedule | null {
  const { schedule } = routine;
  if (!schedule) return null;
  if (schedule.type === "once") return routine.enabled ? null : "manual";
  if (schedule.type === "interval" && !schedule.weekdays && !schedule.window && schedule.endsAt === undefined) {
    return schedule.everyMinutes === 30 ? "half" : schedule.everyMinutes === 60 ? "hour" : null;
  }
  if (schedule.type === "cron") return schedule.expression === "0 8 * * *" ? "day" : schedule.expression === "0 8 * * 1" ? "week" : null;
  if (schedule.type === "daily" && schedule.time === "08:00") return schedule.weekdays.length === 7 ? "day" : schedule.weekdays.length === 1 && schedule.weekdays[0] === 1 ? "week" : null;
  return null;
}

/** A PanelAutomation's cadence: what the card's own schedule or a linked routine's schedule amounts to. */
export function cadenceOf(routine: Pick<Routine, "schedule" | "enabled">): PanelAutomation["cadence"] {
  const schedule = scheduleOf(routine);
  return schedule ? PANEL_SCHEDULE_CADENCE[schedule] : "custom";
}

export const asSchedule = (value: unknown): PanelSchedule | undefined => (PANEL_SCHEDULES as readonly unknown[]).includes(value) ? value as PanelSchedule : undefined;
export const scheduleFromCadence = (cadence: keyof typeof PANEL_CADENCE_SCHEDULE) => PANEL_CADENCE_SCHEDULE[cadence];

const sameWidget = (a: PanelCard["widget"], b: PanelCard["widget"]) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function createPanelCards(deps: PanelCardsDeps) {
  const { store, history, state } = deps;
  const now = () => deps.now?.() ?? Date.now();

  const routineById = (routineId: string | undefined) => (routineId ? deps.routines()?.listRoutines().find((one) => one.id === routineId) : undefined);
  /** The card whose own routine this is. */
  const cardOf = (routineId: string): { panel: Panel; card: PanelCard } | null => {
    for (const panel of store.list()) {
      const card = panel.cards.find((one) => one.routineId === routineId);
      if (card) return { panel, card };
    }
    return null;
  };

  /** Kept cards with a schedule that runs by itself, everywhere; `except` leaves one card out of the count. */
  function scheduledCount(except?: string): number {
    return store.list().reduce((sum, panel) => sum + panel.cards.filter((card) => card.id !== except && !card.draft && isScheduled(card.schedule)).length, 0);
  }

  function limitRefusal(cardId: string | undefined, schedule: PanelSchedule | undefined): string | null {
    if (!isScheduled(schedule) || scheduledCount(cardId) < PANEL_LIMITS.scheduledCards) return null;
    return `schedule: there are already ${PANEL_LIMITS.scheduledCards} cards that update by themselves. Use schedule "manual" (updated on Refresh only), or ask the person to remove a scheduled card first.`;
  }

  function instruction(panel: Panel, card: PanelCard): string {
    const format = card.format && card.format !== "auto" ? ` Show it as a ${card.format} block.` : "";
    const alert = card.alert ? ` If this condition is met, send alert with one sentence saying so: "${card.alert}".` : "";
    return [
      `Keep the card "${card.title}" on panel "${panel.title}" current.`,
      `What it tracks: ${card.prompt ?? card.title}.${format}${alert}`,
      `Call update_panel_widget once with panel_id "${panel.id}" and card_key "${card.key}": widget with the new content, summary with one line on what changed, and sources you read. If you cannot get fresh data, send failed with the reason instead.`,
    ].join("\n");
  }

  /** Why the person cannot keep this draft on `panel`, in their words; null when they can. */
  function keepRefusal(panel: Panel, card: PanelCard): string | null {
    if (!card.draft) return null;
    if (panel.cards.filter((one) => !one.draft && one.id !== card.id).length >= PANEL_LIMITS.cardsPerPanel) return PANEL_FULL;
    return limitRefusal(card.id, card.schedule) ? SCHEDULED_FULL : null;
  }

  /** Makes, changes or removes a card's own routine to match the card: a card with a prompt has one, run by `botId` (the
   * routine's bot otherwise); with `run` it starts now. */
  function syncOwn(panelId: string, cardId: string, options: { botId?: string; run?: boolean } = {}): PanelsResult<{ routineId: string | null; runId: string | null }> {
    const manager = deps.routines();
    const panel = store.get(panelId);
    const card = panel?.cards.find((one) => one.id === cardId);
    if (!panel || !card) return { ok: false, status: 404, error: "No such card." };
    const existing = routineById(card.routineId);
    if (!card.prompt) {
      if (existing) manager?.remove(existing.id);
      if (card.routineId) store.patchCard(panelId, cardId, { extra: { routineId: null } });
      return { ok: true, routineId: null, runId: null };
    }
    if (!manager) return { ok: false, status: 409, error: "Automations are not ready yet. Try again in a moment." };
    if (!card.key) return { ok: false, status: 400, error: "card_key: a card that updates by itself needs a key. Send set_panel_widget again with card_key." };
    const schedule = card.schedule ?? "manual";
    const enabled = !card.draft && isScheduled(schedule);
    const botId = options.botId ?? existing?.botId ?? card.botId;
    const base = { name: `Panel card: ${card.title}`.slice(0, 80), prompt: instruction(panel, card), botId, panelId: panel.id, cardKey: card.key, access: READ_ONLY } as const;
    let routine: Routine | null;
    try {
      if (existing) {
        const same = scheduleOf(existing) === schedule && existing.enabled === enabled;
        routine = manager.update(existing.id, { ...base, ...(same ? {} : { schedule: routineSchedule(schedule, deps.timeZone(), now()), enabled }) });
      } else {
        routine = manager.create({ ...base, target: "bot", schedule: routineSchedule(schedule, deps.timeZone(), now()), enabled });
      }
    } catch (error) {
      return { ok: false, status: 400, error: error instanceof Error ? error.message : "The card's automation could not be saved." };
    }
    if (!routine) return { ok: false, status: 404, error: "The card's automation is gone. Try again." };
    if (card.routineId !== routine.id) store.patchCard(panelId, cardId, { extra: { routineId: routine.id } });
    const run = options.run ? manager.runNow(routine.id) : null;
    return { ok: true, routineId: routine.id, runId: run?.id ?? null };
  }

  /** Runs a card's own routine now, or else the routine linked to its key; null when no automation keeps it. */
  function runCard(panel: Panel, card: PanelCard, change?: string): { ok: true; run: RoutineRun } | { ok: false; status: 404 | 409; error: string } {
    const manager = deps.routines();
    const own = routineById(card.routineId);
    const routine = own ?? manager?.listRoutines().find((one) => one.panelId === panel.id && card.key !== undefined && one.cardKey === card.key);
    if (!manager || !routine) return { ok: false, status: 404, error: "No automation keeps this card. Give it a prompt to update it." };
    if (change !== undefined) state.asked.set(routine.id, change);
    const run = manager.runNow(routine.id);
    if (!run) {
      state.asked.delete(routine.id);
      return { ok: false, status: 409, error: "The automation could not start now. Try again shortly." };
    }
    return { ok: true, run };
  }

  /** Turns a paused own routine back on (when its schedule runs by itself) and runs it now. */
  function resolve(panel: Panel, card: PanelCard): { ok: true; run: RoutineRun } | { ok: false; status: 404 | 409; error: string } {
    const own = routineById(card.routineId);
    if (own && !own.enabled && isScheduled(card.schedule)) {
      try { deps.routines()?.update(own.id, { enabled: true }); } catch { /* runs once below either way */ }
    }
    return runCard(panel, card);
  }

  /** The card a turn's routine run keeps by itself, when this thread is such a run. */
  function ownRun(threadId: string): { run: RoutineRun; routine: Routine; panel: Panel; card: PanelCard } | null {
    const manager = deps.routines();
    if (!manager) return null;
    const run = manager.listRuns().find((one) => one.threadId === threadId && GOING.has(one.status));
    const routine = run ? routineById(run.routineId) : undefined;
    const found = routine ? cardOf(routine.id) : null;
    return run && routine && found ? { run, routine, ...found } : null;
  }

  /** Records an update a bot made: history, the person's notice when the content changed, and the run's one update. */
  function updatedCard(panel: Panel, previous: PanelCard | undefined, card: PanelCard, about: { summary?: string; alert?: string; run?: RoutineRun }): void {
    if (card.draft && !about.run) return;
    const change = about.run ? state.asked.get(about.run.routineId) : undefined;
    if (about.run) {
      state.updated.add(about.run.id);
      state.asked.delete(about.run.routineId);
    }
    const entry: PanelCardUpdate = {
      at: card.updatedAt, status: card.status,
      ...(about.summary ? { summary: about.summary } : {}), ...(card.failure && card.status === "failed" ? { failure: card.failure, ...(card.failureCode ? { failureCode: card.failureCode } : {}) } : {}),
      ...(card.widget ? { widget: card.widget } : {}), ...(about.alert ? { alert: about.alert } : {}), ...(change ? { change } : {}),
      ...(about.run ? { runId: about.run.id, ...(about.run.threadId ? { threadId: about.run.threadId } : {}) } : {}),
    };
    history.add(card.id, entry);
    if (card.draft) return;
    if (about.alert) deps.notice?.(card.botId, `Alert on "${card.title}" (${panel.title}): ${about.alert}`);
    if (card.notify && previous?.widget && card.widget && !sameWidget(previous.widget, card.widget)) {
      deps.notice?.(card.botId, `"${card.title}" on ${panel.title} changed${about.summary ? `: ${about.summary}` : "."}`);
    }
  }

  /** The end of a card's own run: a run that updated nothing fails the card, and enough failures in a row pause it. */
  function runEnded(run: RoutineRun): { panelId: string; botId: string } | null {
    if (GOING.has(run.status) || !deps.enabled()) return null;
    const found = cardOf(run.routineId);
    const did = state.ended(run.id, run.routineId);
    if (!found) return null;
    const { panel, card } = found;
    if (did) {
      if (typeof run.cost === "number" && run.cost > 0) history.costed(card.id, run.id, run.cost);
      if (card.status !== "failed") return null;
    } else if (ENDED_BADLY.has(run.status)) {
      const refused = run.status === "failed" && (run.error === ENGINE_FAILURE || run.error === NOT_FENCED_FAILURE) ? run.error : null;
      const failed = store.updateCard(panel.id, { cardId: card.id }, { failed: refused ?? NO_UPDATE_FAILURE, failureCode: refused ? "engine" : "no_update", botId: card.botId });
      if (failed.ok) updatedCard(panel, card, failed.card, { run });
      state.ended(run.id, run.routineId);
    } else {
      return null;
    }
    // A run refused because its routine predates read-only cards is the build's doing, and the next run goes ahead.
    if (history.failuresInARow(card.id, (update) => update.failure === NOT_FENCED_FAILURE) < FAILURES_TO_PAUSE) return null;
    const own = routineById(card.routineId);
    if (own?.enabled) {
      try { deps.routines()?.update(own.id, { enabled: false }); } catch { /* the card still says it failed */ }
    }
    store.updateCard(panel.id, { cardId: card.id }, { failed: PAUSED_FAILURE, failureCode: "paused", botId: card.botId });
    return { panelId: panel.id, botId: panel.createdBy.botId };
  }

  /** The person removed a card: a draft's routine goes with it; a kept card's own routine, and a routine linked to its key
   * alone, are paused until its Undo. */
  function removed(panel: Panel, card: PanelCard): void {
    const manager = deps.routines();
    if (!manager) return;
    const own = routineById(card.routineId);
    if (card.draft) {
      if (own) manager.remove(own.id);
      history.forget(card.id);
      return;
    }
    const keeping = [own, ...manager.listRoutines().filter((one) => one.panelId === panel.id && card.key !== undefined && one.cardKey === card.key && one.id !== own?.id)];
    const paused: string[] = [];
    for (const routine of keeping) {
      if (!routine?.enabled) continue;
      try {
        manager.update(routine.id, { enabled: false });
        paused.push(routine.id);
      } catch { /* left as it was */ }
    }
    if (paused.length) state.pausedByRemoval(card.id, paused);
  }

  function restored(card: PanelCard): void {
    for (const routineId of state.takePaused(card.id)) {
      try { deps.routines()?.update(routineId, { enabled: true }); } catch { /* stays paused; the card shows its automation off */ }
    }
  }

  /** Drafts older than an hour, removed with their routines. */
  function sweep(): void {
    for (const gone of store.sweepDrafts(now() - PANEL_LIMITS.draftMs)) {
      if (gone.card.routineId) deps.routines()?.remove(gone.card.routineId);
      history.forget(gone.card.id);
    }
  }

  /** A kept draft: its routine starts its schedule; moved to `toPanelId`, the routine follows. */
  function kept(panelId: string, card: PanelCard): PanelsResult<{ routineId: string | null; runId: string | null }> {
    return card.prompt ? syncOwn(panelId, card.id) : { ok: true, routineId: null, runId: null };
  }

  /** A card as the person's screen reads it: `held` while its own routine waits on something outside the app. */
  function shown(card: PanelCard): PanelCard {
    const held = routineById(card.routineId)?.heldFor;
    return held ? { ...card, held: { reason: held } } : card;
  }

  /** The run note for a card's own routine; null for any other routine. */
  function runNote(routine: Routine | undefined): string | null {
    if (!routine || !deps.enabled()) return null;
    const found = cardOf(routine.id);
    if (!found) return null;
    const change = state.asked.get(routine.id);
    return [
      `This is an update run for one panel card. Only read: look things up, but do not write, send, buy or change anything, and do not reply in chat; nobody reads this conversation.`,
      `Call update_panel_widget exactly once, for panel_id "${found.panel.id}" and card_key "${found.card.key}". No other panel or card can be changed from this run.`,
      ...(change ? [`The person asked for this change: "${change}". Apply it; you may send a new prompt or schedule with the update.`] : []),
    ].join("\n");
  }

  /** Why a card's own run may not start: its bot's engine is not fenced, or the routine is not read-only yet (made by an
   * earlier build; it is made read-only here for its next run). Null for any other run. */
  function runRefusal(run: RoutineRun): string | null {
    if (!deps.enabled()) return null;
    const own = cardOf(run.routineId) ? routineById(run.routineId) : undefined;
    if (!own) return null;
    if (deps.fenced && !deps.fenced(run.botId)) return ENGINE_FAILURE;
    if (run.access === READ_ONLY) return null;
    try { deps.routines()?.update(own.id, { access: READ_ONLY }); } catch { /* refused again next run */ }
    return NOT_FENCED_FAILURE;
  }

  /** The one line a card's own run is told when its turn ended with no update; null once told, or for any other run. */
  function reminder(run: RoutineRun): string | null {
    if (!deps.enabled() || state.updated.has(run.id) || state.reminded.has(run.id)) return null;
    const found = cardOf(run.routineId);
    if (!found) return null;
    state.reminded.add(run.id);
    return `You have not updated the card yet, and this run fails without it. Call update_panel_widget now, once, for panel_id "${found.panel.id}" and card_key "${found.card.key}": the new widget, or failed with the reason. Do not reply in chat.`;
  }

  /** A card's own run: its answer goes nowhere but its card. */
  const owns = (run: Pick<RoutineRun, "routineId">): boolean => cardOf(run.routineId) !== null;

  return { hasUpdated: (runId: string) => state.updated.has(runId), syncOwn, runCard, resolve, ownRun, updatedCard, runEnded, removed, restored, sweep, kept, shown, runNote, scheduledCount, limitRefusal, keepRefusal, cardOf, routineById, runRefusal, reminder, owns };
}

export type PanelCards = ReturnType<typeof createPanelCards>;
