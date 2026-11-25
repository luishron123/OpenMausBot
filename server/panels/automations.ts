// The automations that keep a panel current. A routine names its panel in `panelId` (and, optionally, its own card in
// `cardKey`); the link is set through the bot's trigger tool, which calls the link route below after the routine exists,
// so the routine request cards keep their stored shape. Each run of a linked routine gets one note in its instructions:
// which panel, which cards, and to update them rather than repeat the report in chat.
import { z } from "zod";

import { PANEL_KEY, type Panel, type PanelAutomation } from "../../shared/panels.ts";
import type { RequestAuth } from "../request-auth.ts";
import { scheduleText } from "../routine-requests.ts";
import type { Routine, RoutineManager, RoutineRun } from "../routines.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { PanelStore } from "./store.ts";
import { cadenceOf } from "./cards.ts";
import { PANEL_TOOL_PATH, privateHides, type PanelCaller } from "./tools.ts";
import type { PanelTurnAccess } from "./turn-access.ts";

export type PanelRoutines = Pick<RoutineManager, "listRoutines" | "listRuns" | "update" | "runNow" | "create" | "remove" | "failThread">;

export const PANEL_LINK_PATH = `${PANEL_TOOL_PATH}/link`;

export interface PanelAutomationDeps {
  store: PanelStore;
  enabled(): boolean;
  /** Null until the server has its routines. */
  routines(): PanelRoutines | null;
  /** Whether this person may see a bot's automations. */
  sees(auth: RequestAuth, botId: string): boolean;
  /** Told about a run this person started, as the person's own run-now route is. */
  personStarted?(auth: RequestAuth, run: RoutineRun): void;
  /** Whether this turn may see the panel (tools.ts `sees`); a panel it may not see cannot be linked, as if it did not exist. */
  turnSees?: PanelTurnAccess;
  /** The person's time zone, for each automation's schedule in words. */
  timeZone?(): string;
}

const GOING = new Set(["queued", "running", "waiting"]);
const iso = (ms: number | null | undefined) => (typeof ms === "number" ? new Date(ms).toISOString() : null);

const linkBody = z.object({
  panel_id: z.string({ error: 'panel_id: the panel\'s id or key, or "" to unlink.' }).trim().max(100),
  card_key: z.string().regex(PANEL_KEY, 'card_key: lowercase letters, digits and dashes, e.g. "revenue".').optional(),
  routine_id: z.string().trim().min(1).max(100).optional(),
});

export function createPanelAutomations(deps: PanelAutomationDeps) {
  const { store } = deps;
  const described = (routine: Routine): { scheduleText?: string } => {
    if (cadenceOf(routine) === "on-request") return {};
    try {
      return { scheduleText: scheduleText(routine.schedule as Parameters<typeof scheduleText>[0], deps.timeZone?.() ?? "UTC") };
    } catch {
      return {};
    }
  };
  const linked = (panel: Panel) => deps.routines()?.listRoutines().filter((routine) => routine.panelId === panel.id) ?? [];

  function list(auth: RequestAuth, panel: Panel): PanelAutomation[] {
    const routines = linked(panel).filter((routine) => deps.sees(auth, routine.botId));
    if (!routines.length) return [];
    const runs = deps.routines()?.listRuns() ?? [];
    return routines.map((routine) => {
      const own = runs.filter((run) => run.routineId === routine.id);
      const last = own.find((run) => run.finishedAt !== undefined);
      const started = last?.startedAt ?? last?.finishedAt;
      const cards = routine.cardKey ? panel.cards.filter((card) => card.key === routine.cardKey) : panel.cards;
      return {
        routineId: routine.id,
        name: routine.name,
        botId: routine.botId,
        enabled: routine.enabled,
        nextRunAt: iso(routine.nextRunAt),
        lastRunAt: iso(started),
        ...(last?.threadId ? { lastRunThreadId: last.threadId } : {}),
        running: own.some((run) => GOING.has(run.status)),
        lastRunUpdatedNothing: last?.status === "completed" && started !== undefined && !cards.some((card) => Date.parse(card.updatedAt) >= started),
        ...(routine.cardKey ? { cardKey: routine.cardKey } : {}),
        cadence: cadenceOf(routine),
        ...(described(routine)),
      };
    });
  }

  function refresh(auth: RequestAuth, panel: Panel, routineId?: string): { ok: true } | { ok: false; status: 404 | 409; error: string } {
    const manager = deps.routines();
    const routines = linked(panel).filter((routine) => deps.sees(auth, routine.botId) && (!routineId || routine.id === routineId));
    if (!manager || !routines.length) return { ok: false, status: 404, error: routineId ? "No such automation on this panel." : "No automation keeps this panel." };
    let started = 0;
    for (const routine of routines) {
      const run = manager.runNow(routine.id);
      if (!run) continue;
      started += 1;
      deps.personStarted?.(auth, run);
    }
    return started ? { ok: true } : { ok: false, status: 409, error: "The automation could not start now. Try again shortly." };
  }

  /** The panel a linked routine's run kept, once that run has ended, so the person's screen reads the automation again
   * (its `running` is over) even when the run changed no card; null for any other run. */
  function runEnded(run: RoutineRun): { panelId: string; botId: string } | null {
    if (GOING.has(run.status) || !deps.enabled()) return null;
    const routine = deps.routines()?.listRoutines().find((one) => one.id === run.routineId);
    const panel = routine?.panelId ? store.get(routine.panelId) : undefined;
    return panel ? { panelId: panel.id, botId: panel.createdBy.botId } : null;
  }

  /** The line a linked routine's run reads with its instructions; null for any other routine. */
  function runNote(routine: Routine | undefined): string | null {
    if (!routine?.panelId || !deps.enabled()) return null;
    const panel = store.get(routine.panelId);
    if (!panel) return `This automation kept panel ${routine.panelId}, which was removed. Report in chat this time.`;
    const cards = [...panel.cards].sort((a, b) => a.position - b.position).map((card) => `"${card.title}" (${card.key ? `card_key ${card.key}` : `card_id ${card.id}`})`);
    const own = routine.cardKey ? ` Your card is card_key "${routine.cardKey}"; make it with set_panel_widget if it is missing.` : "";
    return `This run keeps panel "${panel.title}" (panel_id ${panel.id}). Its cards: ${cards.length ? cards.join(", ") : "none yet"}.${own} Update them with set_panel_widget or update_panel_widget; when you cannot get fresh data, send update_panel_widget failed with the reason. Do not repeat the report in chat.`;
  }

  /** The trigger tool's link: panel_id names the panel (or "" unlinks); without routine_id it only checks the panel exists. */
  const linkRoute = (caller: PanelCaller): RouteHandler => async ({ req, res, path, method, json, readBody }) => {
    if (path !== PANEL_LINK_PATH) return PASS;
    if (method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!deps.enabled()) return json(res, 404, { error: "Panels are turned off on this computer. Leave out panel_id and report in chat." });
    const parsed = linkBody.safeParse(await readBody(req) ?? {});
    if (!parsed.success) return json(res, 400, { error: parsed.error.issues[0]?.message ?? "Send panel_id." });
    const sent = parsed.data;
    const seen = (one: Panel | undefined) => (one && !privateHides(one, caller.botId) && (deps.turnSees?.(caller, one) ?? true) ? one : undefined);
    const panel = sent.panel_id ? seen(store.get(sent.panel_id)) ?? seen(store.byKey(sent.panel_id)) ?? null : null;
    if (sent.panel_id && !panel) return json(res, 404, { error: `No panel ${sent.panel_id}. Call list_panels for the ids, or create_panel first.` });
    if (panel && !(deps.turnSees?.(caller, panel, "change") ?? true)) {
      return json(res, 403, { error: `Panel ${panel.id} can be read from this conversation but not changed, so no automation of yours can keep it: only people who can chat with the bot that made it (${panel.createdBy.botId}) may. Leave out panel_id and report in chat, or make your own panel with create_panel.` });
    }
    if (!panel && sent.card_key) return json(res, 400, { error: "card_key needs panel_id." });
    if (!sent.routine_id) return json(res, 200, { text: `Panel ${panel?.id ?? "(none)"} can be linked.` });
    const manager = deps.routines();
    const routine = manager?.listRoutines().find((one) => one.id === sent.routine_id);
    if (!manager || !routine || routine.botId !== caller.botId || routine.target !== "bot") {
      return json(res, 404, { error: `No scheduled automation ${sent.routine_id} of yours. Only your own schedule and limit-reset automations keep a panel; trigger_info lists them.` });
    }
    try {
      manager.update(routine.id, { panelId: panel?.id ?? null, cardKey: panel ? sent.card_key ?? null : null });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : "The panel link could not be saved." });
    }
    return json(res, 200, {
      text: panel
        ? `Each run of automation ${routine.id} now keeps panel ${panel.id} ("${panel.title}")${sent.card_key ? `, card ${sent.card_key}` : ""}, and reports there instead of in chat.`
        : `Automation ${routine.id} no longer keeps a panel; it reports in chat.`,
    });
  };

  return { list, refresh, runNote, runEnded, linkRoute };
}
