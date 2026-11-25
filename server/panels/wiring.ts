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
import { createPinnable, type PanelChats } from "./pinnable.ts";
import { createPanelRoutes } from "./routes.ts";
import type { SuggestionBot } from "./suggestions.ts";
import { createPanelStore } from "./store.ts";
import { createPanelToolRoutes, type PanelCaller } from "./tools.ts";
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
  notice?(botId: string, text: string): void;
  /** The chats whose widgets can be pinned. */
  chats?: PanelChats;
  /** What a bot is for, for New widget's suggestions. */
  bot?(botId: string): SuggestionBot | null;
}

export function createPanels(deps: PanelsDeps) {
  const store = createPanelStore({ dataDir: deps.dataDir });
  const changed = (change: { panelId: string; botId: string; removed?: true }) => deps.broadcast({ kind: "panels.changed", ...change } satisfies PanelsChangedFrame);
  store.onChange(changed);
  const history = createPanelHistory({ dataDir: deps.dataDir });
  const routines = () => deps.routines?.() ?? null;
  const timeZone = () => deps.timeZone?.() || "UTC";
  const cards = createPanelCards({ store, history, enabled: deps.enabled, routines, timeZone, ...(deps.notice ? { notice: deps.notice } : {}) });
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
  const sweeper = setInterval(() => { if (deps.enabled()) cards.sweep(); }, Math.min(PANEL_LIMITS.draftMs / 6, 600_000));
  sweeper.unref?.();
  return { store, routes, toolRoutes, runNote, runChanged, close: () => clearInterval(sweeper) };
}

export type Panels = ReturnType<typeof createPanels>;
