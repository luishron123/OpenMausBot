// Panels as the server runs them: the store, the person's routes, the bots' tool routes and a `panels.changed` frame for
// every change.
import type { PanelsChangedFrame } from "../../shared/panels.ts";
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
}

export function createPanels(deps: PanelsDeps) {
  const store = createPanelStore({ dataDir: deps.dataDir });
  store.onChange((change) => deps.broadcast({ kind: "panels.changed", ...change } satisfies PanelsChangedFrame));
  const automations = createPanelAutomations({
    store, enabled: deps.enabled, routines: () => deps.routines?.() ?? null,
    sees: (auth, botId) => auth.scopes.includes("admin") || deps.levelOf(auth, botId) !== "none",
    ...(deps.personStarted ? { personStarted: deps.personStarted } : {}),
  });
  const routes = createPanelRoutes({ store, enabled: deps.enabled, levelOf: deps.levelOf, automations: automations.list, refresh: automations.refresh });
  const tools = createPanelToolRoutes({ store, enabled: deps.enabled });
  const toolRoutes = (caller: PanelCaller): RouteHandler => async (context) => (await dispatchRoutes([automations.linkRoute(caller), tools(caller)], context)) ? undefined : PASS;
  return { store, routes, toolRoutes, runNote: automations.runNote };
}

export type Panels = ReturnType<typeof createPanels>;
