// Panels as the server runs them: the store, the person's routes, the bots' tool routes and a `panels.changed` frame for
// every change.
import type { PanelsChangedFrame } from "../../shared/panels.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { createPanelRoutes } from "./routes.ts";
import { createPanelStore } from "./store.ts";
import { createPanelToolRoutes } from "./tools.ts";

export interface PanelsDeps {
  dataDir: string;
  /** `features.panels`, read on every request. */
  enabled(): boolean;
  levelOf(auth: RequestAuth, botId: string): BotAccessLevel;
  broadcast(payload: Record<string, unknown>): void;
}

export function createPanels(deps: PanelsDeps) {
  const store = createPanelStore({ dataDir: deps.dataDir });
  store.onChange((change) => deps.broadcast({ kind: "panels.changed", ...change } satisfies PanelsChangedFrame));
  const routes = createPanelRoutes({ store, enabled: deps.enabled, levelOf: deps.levelOf });
  const toolRoutes = createPanelToolRoutes({ store, enabled: deps.enabled });
  return { store, routes, toolRoutes };
}

export type Panels = ReturnType<typeof createPanels>;
