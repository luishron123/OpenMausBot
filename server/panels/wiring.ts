// Panels as the server runs them: the store, the person's routes, the bots' tool routes and a `panels.changed` frame for
// every change.
import { PANEL_LIMITS, type Panel, type PanelsChangedFrame } from "../../shared/panels.ts";
import type { RoutineRun } from "../routines.ts";
import { dispatchRoutes, PASS, type RouteHandler } from "../routes/table.ts";
import { createPanelAutomations, type PanelRoutines } from "./automations.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { createPanelCardRoutes } from "./card-routes.ts";
import { createPanelCards } from "./cards.ts";
import { createPanelHistory } from "./history.ts";
import { createPanelRunState } from "./run-state.ts";
import { createPinnable, type PanelChats } from "./pinnable.ts";
import { createPanelRoutes } from "./routes.ts";
import type { SuggestionBot } from "./suggestions.ts";
import { createPanelStore } from "./store.ts";
import { createPanelToolRoutes, PANEL_TOOL_PATH, type PanelCaller } from "./tools.ts";
import type { PanelTurnAccess } from "./turn-access.ts";

export interface PanelsDeps {
  dataDir: string;
  /** `features.panels`, read on every request. */
  enabled(): boolean;
  levelOf(auth: RequestAuth, botId: string): BotAccessLevel;
  broadcast(payload: Record<string, unknown>): void;
  /** The server's routines, once it has them; without them a panel lists no automations. */
  routines?(): PanelRoutines | null;
  personStarted?(auth: RequestAuth, run: RoutineRun): void;
  /** Whether a bot's turn may see a panel (turn-access.ts); without it every turn sees every panel. */
  turnSees?: PanelTurnAccess;
  /** The person's time zone; UTC without it. */
  timeZone?(): string;
  /** Tells the person something about a bot's card (a changed card they asked to hear about, an alert). */
  notice?(botId: string, line: (language: string | undefined) => string): void;
  /** The chats whose widgets can be pinned. */
  chats?: PanelChats;
  /** What a bot is for, for New widget's suggestions. */
  bot?(botId: string): SuggestionBot | null;
  /** Another turn of a routine run in its own conversation, which the run's rules still hold. */
  continueRun?(run: RoutineRun, threadId: string, text: string): Promise<unknown>;
  /** A turn runs or settles in this conversation. */
  threadBusy?(botId: string, threadId: string): boolean;
}

/** The one route of OpenMausBot's own a card's update run reaches beside the reads read-and-draft.ts lets through. */
const CARD_UPDATE_ROUTE = `POST ${PANEL_TOOL_PATH}/update-card`;
const REMINDER_WAIT_MS = 60_000;
const REMINDER_POLL_MS = 500;

export function createPanels(deps: PanelsDeps) {
  const store = createPanelStore({ dataDir: deps.dataDir });
  const changed = (change: { panelId: string; botId: string; removed?: true }) => deps.broadcast({ kind: "panels.changed", ...change } satisfies PanelsChangedFrame);
  store.onChange(changed);
  const history = createPanelHistory({ dataDir: deps.dataDir });
  const routines = () => deps.routines?.() ?? null;
  const timeZone = () => deps.timeZone?.() || "UTC";
  const state = createPanelRunState({ dataDir: deps.dataDir });
  const cards = createPanelCards({ store, history, state, enabled: deps.enabled, routines, timeZone, ...(deps.notice ? { notice: deps.notice } : {}) });
  const automations = createPanelAutomations({
    store, enabled: deps.enabled, routines, timeZone,
    sees: (auth, botId) => auth.scopes.includes("admin") || deps.levelOf(auth, botId) !== "none",
    ...(deps.personStarted ? { personStarted: deps.personStarted } : {}), ...(deps.turnSees ? { turnSees: deps.turnSees } : {}),
  });
  const present = (auth: RequestAuth, panel: Panel): Panel => ({ ...panel, cards: panel.cards.map(cards.shown), automations: automations.list(auth, panel) });
  const personRoutes = createPanelRoutes({ store, enabled: deps.enabled, levelOf: deps.levelOf, present, refresh: automations.refresh, cards });
  const cardRoutes = createPanelCardRoutes({
    store, cards, history, enabled: deps.enabled, levelOf: deps.levelOf, present, routines,
    ...(deps.chats ? { pinnable: createPinnable(deps.chats) } : {}), ...(deps.bot ? { bot: deps.bot } : {}),
    personStarted: (auth, runId) => { const run = routines()?.listRuns().find((one) => one.id === runId); if (run) deps.personStarted?.(auth, run); },
  });
  const routes: RouteHandler = async (context) => (await dispatchRoutes([cardRoutes, personRoutes], context)) ? undefined : PASS;
  const tools = createPanelToolRoutes({ store, enabled: deps.enabled, cards, ...(deps.turnSees ? { sees: deps.turnSees } : {}) });
  /** A card's own update run gets no link route: tools() refuses everything but its one update. */
  const toolRoutes = (caller: PanelCaller): RouteHandler => async (context) =>
    (await dispatchRoutes([...(cards.ownRun(caller.threadId) ? [] : [automations.linkRoute(caller)]), tools(caller)], context)) ? undefined : PASS;
  /** A linked routine's run changed: once it has ended, its panel is said to have changed, so the screen reads it again. */
  const runChanged = (run: RoutineRun) => {
    const own = cards.runEnded(run);
    const ended = automations.runEnded(run);
    if (ended ?? own) changed((ended ?? own)!);
  };
  /** A card's own routine reads its rules; any other routine linked to a panel reads the panel's note. */
  const runNote = (routine: Parameters<typeof cards.runNote>[0]) => cards.runNote(routine) ?? automations.runNote(routine);
  /** A card's own run whose turn ended with no update is told so once, in a turn of its own once this one has settled;
   * true when that turn is on its way and the run goes on. */
  const remindRun = (run: RoutineRun, threadId: string): boolean => {
    const continueRun = deps.continueRun;
    const text = continueRun ? cards.reminder(run) : null;
    if (!continueRun || !text) return false;
    const since = Date.now();
    const lost = (why: string) => routines()?.failThread(threadId, `The reminder to update the card could not start: ${why}`);
    const carryOn = () => {
      if (deps.threadBusy?.(run.botId, threadId)) {
        if (Date.now() - since >= REMINDER_WAIT_MS) return lost("the conversation stayed busy");
        setTimeout(carryOn, REMINDER_POLL_MS).unref?.();
        return;
      }
      continueRun(run, threadId, text).catch((error: unknown) => lost(error instanceof Error ? error.message : String(error)));
    };
    queueMicrotask(carryOn);
    return true;
  };
  /** A card's own update run may reach its card's update route, which takes only its own card, once. */
  const mayReach = (threadId: string, route: string): boolean => route === CARD_UPDATE_ROUTE && cards.ownRun(threadId) !== null;
  const sweeper = setInterval(() => { if (deps.enabled()) cards.sweep(); }, Math.min(PANEL_LIMITS.draftMs / 6, 600_000));
  sweeper.unref?.();
  return { store, routes, toolRoutes, runNote, runChanged, runRefusal: cards.runRefusal, remindRun, quiet: cards.owns, mayReach, close: () => clearInterval(sweeper) };
}

export type Panels = ReturnType<typeof createPanels>;
