// Panels as the server runs them: the store, the person's routes, the bots' tool routes and a `panels.changed` frame for
// every change.
import type { Panel, PanelsChangedFrame } from "../../shared/panels.ts";
import type { RoutineRun } from "../routines.ts";
import { dispatchRoutes, PASS, type RouteHandler } from "../routes/table.ts";
import { createPanelAutomations, type PanelRoutines } from "./automations.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { createPanelRoutes } from "./routes.ts";
import { createPanelStore } from "./store.ts";
import { createPanelToolRoutes, type PanelCaller } from "./tools.ts";

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
  turnSees?(caller: PanelCaller, panel: Panel): boolean;
}

export function createPanels(deps: PanelsDeps) {
  const store = createPanelStore({ dataDir: deps.dataDir });
  const changed = (change: { panelId: string; botId: string; removed?: true }) => deps.broadcast({ kind: "panels.changed", ...change } satisfies PanelsChangedFrame);
  store.onChange(changed);
  const automations = createPanelAutomations({
    store, enabled: deps.enabled, routines: () => deps.routines?.() ?? null,
    sees: (auth, botId) => auth.scopes.includes("admin") || deps.levelOf(auth, botId) !== "none",
    ...(deps.personStarted ? { personStarted: deps.personStarted } : {}), ...(deps.turnSees ? { turnSees: deps.turnSees } : {}),
  });
  const routes = createPanelRoutes({ store, enabled: deps.enabled, levelOf: deps.levelOf, automations: automations.list, refresh: automations.refresh });
  const tools = createPanelToolRoutes({ store, enabled: deps.enabled, ...(deps.turnSees ? { sees: deps.turnSees } : {}) });
  const toolRoutes = (caller: PanelCaller): RouteHandler => async (context) => (await dispatchRoutes([automations.linkRoute(caller), tools(caller)], context)) ? undefined : PASS;
  /** A linked routine's run changed: once it has ended, its panel is said to have changed, so the screen reads it again. */
  const runChanged = (run: RoutineRun) => {
    const ended = automations.runEnded(run);
    if (ended) changed(ended);
  };
  return { store, routes, toolRoutes, runNote: automations.runNote, runChanged };
}

export type Panels = ReturnType<typeof createPanels>;
