// The person's card routes beside routes.ts: order, New widget (with its test draft), keep, pin a chat widget, a card's
// history, Refresh, Ask for a change, Resolve, clearing an alert, and the reads New widget and the menu need (estimate,
// suggestions, pinnable widgets, alerts). Answers 404 for a panel this person may not see, 403 for one they may not change.
import { z } from "zod";

import {
  PANEL_CADENCES, PANEL_CADENCE_SCHEDULE, PANEL_CARD_FORMATS, PANEL_CARD_SIZES, PANEL_LIMITS, PANEL_SCHEDULES, PANELS_PATH,
  type Panel, type PanelAlert, type PanelCard, type PanelEstimate,
} from "../../shared/panels.ts";
import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { canonicalWidget } from "../chat-widgets.ts";
import { redactSecretsInText } from "../redact.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Routine, RoutineRun } from "../routines.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { runsPerDay, type PanelCards } from "./cards.ts";
import type { PanelHistory } from "./history.ts";
import type { Pinnable } from "./pinnable.ts";
import { freeCardKey, type PanelStore, type PanelsResult } from "./store.ts";
import { panelSuggestions, type SuggestionBot } from "./suggestions.ts";

export interface PanelCardRouteDeps {
  store: PanelStore;
  cards: PanelCards;
  history: PanelHistory;
  enabled(): boolean;
  levelOf(auth: RequestAuth, botId: string): BotAccessLevel;
  /** A panel as this person's screen reads it: automations and each card's held state filled in. */
  present(auth: RequestAuth, panel: Panel): Panel;
  routines(): { listRoutines(): Routine[]; listRuns(): RoutineRun[] } | null;
  pinnable?: Pinnable;
  bot?(botId: string): SuggestionBot | null;
  personStarted?(auth: RequestAuth, runId: string): void;
}

const ESTIMATE_RUNS = 20;
const P = "/api/panels/([\\w-]{1,100})";
const ORDER = new RegExp(`^${P}/order$`);
const NEW = new RegExp(`^${P}/cards/new$`);
const PIN = new RegExp(`^${P}/cards/pin$`);
const CARD_ACTION = new RegExp(`^${P}/cards/([\\w-]{1,100})/(keep|history|refresh|change|resolve|alert/clear)$`);

const orderBody = z.object({ cardIds: z.array(z.string().min(1).max(100)).max(PANEL_LIMITS.cardsPerPanel * 2) }).strict();
const newBody = z.object({
  prompt: z.string().trim().min(1).max(PANEL_LIMITS.prompt),
  title: z.string().trim().min(1).max(PANEL_LIMITS.title).optional(),
  format: z.enum(PANEL_CARD_FORMATS),
  size: z.enum(PANEL_CARD_SIZES),
  botId: z.string().min(1).max(100),
  schedule: z.enum(PANEL_SCHEDULES).optional(),
  cadence: z.enum(PANEL_CADENCES).optional(),
  alert: z.string().trim().max(PANEL_LIMITS.alert).optional(),
  notify: z.boolean(),
  test: z.boolean(),
}).strict();
const pinBody = z.object({ threadId: z.string().min(1).max(200), messageId: z.string().min(1).max(200), size: z.enum(PANEL_CARD_SIZES).optional() }).strict();
const keepBody = z.object({ panelId: z.string().min(1).max(100).optional() }).strict();
const changeBody = z.object({ text: z.string().trim().min(1).max(PANEL_LIMITS.prompt) }).strict();
const empty = z.object({}).strict();

const titleFrom = (prompt: string) => {
  const words = prompt.replace(/\s+/g, " ").trim();
  return words.length > 40 ? `${words.slice(0, 39).trimEnd()}…` : words;
};

export function createPanelCardRoutes(deps: PanelCardRouteDeps): RouteHandler {
  const { store, cards } = deps;
  const level = (auth: RequestAuth, botId: string) => (auth.scopes.includes("admin") ? "edit" : deps.levelOf(auth, botId));
  const sees = (auth: RequestAuth, panel: Pick<Panel, "createdBy">) => level(auth, panel.createdBy.botId) !== "none";
  const chats = (auth: RequestAuth, botId: string) => ["chat", "edit"].includes(level(auth, botId));

  return async ({ req, res, path, method, url, auth, json, readBody }) => {
    if (!path.startsWith(`${PANELS_PATH}/`) && path !== PANELS_PATH) return PASS;
    if (!deps.enabled()) return PASS;
    if (method === "GET") cards.sweep();
    const params = url?.searchParams ?? new URL(req.url ?? "/", "http://localhost").searchParams;
    const answer = <T extends object>(result: PanelsResult<T>, status: number, body: (done: T) => Record<string, unknown>) =>
      result.ok ? json(res, status, body(result)) : json(res, result.status, { error: result.error });
    const body = async <T>(schema: z.ZodType<T>, error: string): Promise<T | null> => {
      const parsed = schema.safeParse((await readBody(req)) ?? {});
      if (parsed.success) return parsed.data;
      json(res, 400, { error });
      return null;
    };
    const reach = (panelId: string): Panel | null => {
      const panel = store.get(panelId);
      if (!panel || !sees(auth, panel)) {
        json(res, 404, { error: "No such panel." });
        return null;
      }
      if (!chats(auth, panel.createdBy.botId)) {
        json(res, 403, { error: "Only people who can chat with the bot that made this panel can change it." });
        return null;
      }
      return panel;
    };
    const present = (panel: Panel) => deps.present(auth, panel);

    if (path === `${PANELS_PATH}/pinnable`) {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const limit = Math.min(Math.max(Number(params.get("limit")) || 30, 1), 100);
      return json(res, 200, { blocks: deps.pinnable?.list(auth, limit) ?? [] });
    }
    if (path === `${PANELS_PATH}/estimate`) {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const botId = params.get("botId") ?? "";
      const schedule = PANEL_SCHEDULES.find((one) => one === params.get("schedule"));
      if (!schedule || !botId) return json(res, 400, { error: 'Send botId and schedule (half, hour, day, week or manual).' });
      if (level(auth, botId) === "none") return json(res, 404, { error: "No such bot." });
      const costs = (deps.routines()?.listRuns() ?? []).filter((run) => run.botId === botId && run.finishedAt !== undefined && typeof run.cost === "number").slice(0, ESTIMATE_RUNS).map((run) => run.cost as number);
      const estimate: PanelEstimate = costs.length
        ? { perDayUsd: Math.round((costs.reduce((sum, cost) => sum + cost, 0) / costs.length) * runsPerDay(schedule) * 10_000) / 10_000, basis: "recent-runs" }
        : { perDayUsd: null, basis: "none" };
      return json(res, 200, estimate);
    }
    if (path === `${PANELS_PATH}/suggestions`) {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const botId = params.get("botId") ?? "";
      if (!botId || level(auth, botId) === "none") return json(res, 404, { error: "No such bot." });
      const routines = (deps.routines()?.listRoutines() ?? []).filter((routine) => routine.botId === botId);
      return json(res, 200, { suggestions: panelSuggestions(deps.bot?.(botId) ?? null, routines) });
    }
    if (path === `${PANELS_PATH}/alerts`) {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const alerts: PanelAlert[] = store.list().filter((panel) => sees(auth, panel)).flatMap((panel) => panel.cards
        .filter((card) => card.alertActive && !card.draft)
        .map((card) => ({ panelId: panel.id, panelTitle: panel.title, cardId: card.id, cardTitle: card.title, text: card.alertActive!.text, at: card.alertActive!.at })));
      return json(res, 200, { alerts: alerts.sort((a, b) => (a.at < b.at ? 1 : -1)) });
    }

    const order = ORDER.exec(path);
    if (order) {
      if (method !== "POST") return json(res, 405, { error: "Use POST." });
      const panel = reach(order[1]!);
      if (!panel) return;
      const sent = await body(orderBody, "Send cardIds: every card id of the panel, in the new order.");
      if (!sent) return;
      return answer(store.order(panel.id, sent.cardIds), 200, (done) => ({ panel: present(done.panel) }));
    }

    const made = NEW.exec(path);
    if (made) {
      if (method !== "POST") return json(res, 405, { error: "Use POST." });
      const panel = reach(made[1]!);
      if (!panel) return;
      const sent = await body(newBody, "Send prompt, format, size, botId, schedule, notify and test.");
      if (!sent) return;
      const schedule = sent.schedule ?? (sent.cadence ? PANEL_CADENCE_SCHEDULE[sent.cadence] : undefined);
      if (!schedule) return json(res, 400, { error: "Send schedule: half, hour, day, week or manual." });
      if (!chats(auth, sent.botId)) return json(res, 403, { error: "You can only give a card to a bot you can chat with." });
      const refusal = cards.limitRefusal(undefined, schedule);
      if (refusal) return json(res, 409, { error: `There are already ${PANEL_LIMITS.scheduledCards} cards that update by themselves. Choose Manual, or remove a scheduled card first.` });
      const title = sent.title ?? titleFrom(sent.prompt);
      const set = store.setCard(panel.id, {
        key: freeCardKey(panel, title), title, size: sent.size, botId: sent.botId,
        extra: {
          prompt: redactSecretsInText(sent.prompt), format: sent.format, schedule, building: true,
          ...(sent.alert ? { alert: redactSecretsInText(sent.alert) } : {}), ...(sent.notify ? { notify: true } : {}),
          ...(sent.test ? { draft: true, draftAt: new Date().toISOString() } : {}),
        },
      });
      if (!set.ok) return json(res, set.status, { error: set.error });
      const synced = cards.syncOwn(panel.id, set.card.id, { botId: sent.botId, run: true });
      if (!synced.ok) {
        store.removeCard(panel.id, set.card.id);
        return json(res, synced.status, { error: synced.error });
      }
      if (synced.runId) deps.personStarted?.(auth, synced.runId);
      const after = store.get(panel.id)!;
      return json(res, 202, { panel: present(after), card: after.cards.find((card) => card.id === set.card.id), routineId: synced.routineId });
    }

    const pin = PIN.exec(path);
    if (pin) {
      if (method !== "POST") return json(res, 405, { error: "Use POST." });
      const panel = reach(pin[1]!);
      if (!panel) return;
      const sent = await body(pinBody, "Send threadId and messageId of the widget to pin.");
      if (!sent) return;
      const found = deps.pinnable?.find(auth, sent.threadId, sent.messageId);
      if (!found) return json(res, 404, { error: "That widget is not in a chat you can see." });
      const widget = canonicalWidget({ widget: found.root, ...(found.text ? { fallback_text: found.text } : {}) });
      if (!widget.ok) return json(res, 400, { error: widget.error });
      const set = store.setCard(panel.id, {
        key: freeCardKey(panel, found.title), title: found.title.slice(0, PANEL_LIMITS.title), size: sent.size ?? "m",
        content: { widget: widget.root, text: widget.text }, botId: found.botId, extra: { pinnedFrom: { threadId: sent.threadId, messageId: sent.messageId } },
      });
      return answer(set, 200, (done) => ({ panel: present(done.panel), card: done.card }));
    }

    const action = CARD_ACTION.exec(path);
    if (!action) return PASS;
    const [, panelId, cardId, verb] = action;
    if (verb === "history") {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const panel = store.get(panelId!);
      if (!panel || !sees(auth, panel) || !panel.cards.some((card) => card.id === cardId)) return json(res, 404, { error: "No such card." });
      return json(res, 200, { updates: deps.history.list(cardId!) });
    }
    if (method !== "POST") return json(res, 405, { error: "Use POST." });
    const panel = reach(panelId!);
    if (!panel) return;
    const card: PanelCard | undefined = panel.cards.find((one) => one.id === cardId);
    if (!card) return json(res, 404, { error: "No such card." });

    if (verb === "keep") {
      const sent = await body(keepBody, "Send nothing, or panelId to keep the card on another panel.");
      if (!sent) return;
      const undraft = { draft: null, draftAt: null } as const;
      if (sent.panelId && sent.panelId !== panel.id) {
        if (!reach(sent.panelId)) return;
        const moved = store.moveCard(panel.id, card.id, sent.panelId, undraft);
        if (!moved.ok) return json(res, moved.status, { error: moved.error });
        const synced = cards.kept(moved.panel.id, moved.card);
        if (!synced.ok) return json(res, synced.status, { error: synced.error });
        return json(res, 200, { panel: present(store.get(moved.panel.id)!) });
      }
      const kept = store.patchCard(panel.id, card.id, { extra: undraft });
      if (!kept.ok) return json(res, kept.status, { error: kept.error });
      const synced = cards.kept(panel.id, kept.card);
      if (!synced.ok) return json(res, synced.status, { error: synced.error });
      return json(res, 200, { panel: present(store.get(panel.id)!) });
    }
    if (verb === "alert/clear") {
      if (!await body(empty, "Send nothing.")) return;
      return answer(store.patchCard(panel.id, card.id, { extra: { alertActive: null } }), 200, (done) => ({ panel: present(done.panel) }));
    }
    let ran: ReturnType<PanelCards["runCard"]>;
    if (verb === "change") {
      const sent = await body(changeBody, "Send text: the change you want, in a sentence.");
      if (!sent) return;
      ran = cards.runCard(panel, card, redactSecretsInText(sent.text));
    } else {
      if (!await body(empty, "Send nothing.")) return;
      ran = verb === "resolve" ? cards.resolve(panel, card) : cards.runCard(panel, card);
    }
    if (!ran.ok) return json(res, ran.status, { error: ran.error });
    deps.personStarted?.(auth, ran.run.id);
    return json(res, 202, { ok: true });
  };
}
