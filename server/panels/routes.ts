// Panels over HTTP, for the person's own session. GET lists the panels they may see; one panel comes with the automations
// that keep it. Renames, removals and their Undo need chat with the bot that made the panel (an admin, or this computer's
// own owner, always has it); seeing one needs at least view. With `features.panels` off every route answers 404.
import { z } from "zod";

import { PANEL_CARD_SIZES, PANEL_LIMITS, PANEL_SCHEDULES, PANEL_VISIBILITIES, PANELS_PATH, panelSummary, type Panel, type PanelCard } from "../../shared/panels.ts";
import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { canonicalWidget } from "../chat-widgets.ts";
import type { RequestAuth } from "../request-auth.ts";
import { redactSecretsInText } from "../redact.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { PanelCards } from "./cards.ts";
import { parseCard, parsePanel, type PanelStore, type PanelsResult } from "./store.ts";

export interface PanelRouteDeps {
  store: PanelStore;
  /** `features.panels`, read on every request. */
  enabled(): boolean;
  /** What this person may do with a bot. */
  levelOf(auth: RequestAuth, botId: string): BotAccessLevel;
  /** A panel as this person's screen reads it: the automations that keep it, as they may see them, filled in. */
  present?(auth: RequestAuth, panel: Panel): Panel;
  /** Cards' own automations: changed with the card, paused with its removal and back on with its Undo. */
  cards?: PanelCards;
  /** Runs a linked automation now. */
  refresh?(auth: RequestAuth, panel: Panel, routineId?: string): { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };
}

const title = z.string().trim().min(1).max(PANEL_LIMITS.title);
const patchBody = z.object({ title: title.optional(), about: z.string().trim().max(PANEL_LIMITS.about).optional(), visibility: z.enum(PANEL_VISIBILITIES).optional() }).strict();
const cardPatchBody = z.object({
  title: title.optional(), size: z.enum(PANEL_CARD_SIZES).optional(),
  prompt: z.string().trim().max(PANEL_LIMITS.prompt).optional(), schedule: z.enum(PANEL_SCHEDULES).optional(),
  alert: z.string().trim().max(PANEL_LIMITS.alert).optional(), notify: z.boolean().optional(), botId: z.string().min(1).max(100).optional(),
}).strict();
const restoreBody = z.object({ panel: z.unknown() }).strict();
const cardRestoreBody = z.object({ card: z.unknown() }).strict();
const refreshBody = z.object({ routineId: z.string().min(1).max(100).optional() }).strict();

const ONE = /^\/api\/panels\/([\w-]{1,100})$/;
const CARD = /^\/api\/panels\/([\w-]{1,100})\/cards\/([\w-]{1,100})$/;
const CARD_RESTORE = /^\/api\/panels\/([\w-]{1,100})\/cards\/restore$/;
const REFRESH = /^\/api\/panels\/([\w-]{1,100})\/refresh$/;
const RESTORE = `${PANELS_PATH}/restore`;

/** A card read back from the person's Undo goes through the same scrub a bot's widget does. */
function cleanCard(candidate: unknown): PanelCard | null {
  const card = parseCard(candidate);
  if (!card) return null;
  if (!card.widget) return card;
  const widget = canonicalWidget({ widget: card.widget, ...(card.text ? { fallback_text: card.text } : {}) });
  return widget.ok ? { ...card, widget: widget.root, text: widget.text } : null;
}

export function createPanelRoutes(deps: PanelRouteDeps): RouteHandler {
  const { store } = deps;
  const level = (auth: RequestAuth, panel: Pick<Panel, "createdBy">) => (auth.scopes.includes("admin") ? "edit" : deps.levelOf(auth, panel.createdBy.botId));
  const sees = (auth: RequestAuth, panel: Pick<Panel, "createdBy">) => level(auth, panel) !== "none";
  const changes = (auth: RequestAuth, panel: Pick<Panel, "createdBy">) => ["chat", "edit"].includes(level(auth, panel));
  const withAutomations = (auth: RequestAuth, panel: Panel): Panel => deps.present?.(auth, panel) ?? { ...panel, automations: [] };

  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PANELS_PATH && !path.startsWith(`${PANELS_PATH}/`)) return PASS;
    if (!deps.enabled()) return json(res, 404, { error: "Panels are turned off." });
    const notFound = () => json(res, 404, { error: "No such panel." });
    const refused = () => json(res, 403, { error: "Only people who can chat with the bot that made this panel can change it." });
    const answer = <T extends object>(result: PanelsResult<T>, body: (done: T) => Record<string, unknown>) =>
      result.ok ? json(res, 200, body(result)) : json(res, result.status, { error: result.error });
    /** The panel by id when this person may see it; with `change`, only when they may change it too (answered otherwise). */
    const reach = (panelId: string, change: boolean): Panel | null => {
      const panel = store.get(panelId);
      if (!panel || !sees(auth, panel)) {
        notFound();
        return null;
      }
      if (change && !changes(auth, panel)) {
        refused();
        return null;
      }
      return panel;
    };
    const body = async <T>(schema: z.ZodType<T>, error: string): Promise<T | null> => {
      const parsed = schema.safeParse(await readBody(req));
      if (parsed.success) return parsed.data;
      json(res, 400, { error });
      return null;
    };

    if (path === PANELS_PATH) {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      return json(res, 200, { panels: store.list().filter((panel) => sees(auth, panel)).map(panelSummary) });
    }

    if (path === RESTORE) {
      if (method !== "POST") return json(res, 405, { error: "Use POST." });
      const sent = await body(restoreBody, "Send the panel to put back.");
      if (!sent) return;
      const panel = parsePanel(sent.panel);
      if (!panel) return json(res, 400, { error: "That is not a panel this server can put back." });
      if (!changes(auth, panel)) return refused();
      const cards = (sent.panel as { cards: unknown[] }).cards.map(cleanCard);
      if (cards.some((card) => !card)) return json(res, 400, { error: "A card of that panel could not be read." });
      return answer(store.restore({ ...panel, cards: cards as PanelCard[] }), (done) => ({ panel: withAutomations(auth, done.panel) }));
    }

    const cardRestore = CARD_RESTORE.exec(path);
    if (cardRestore) {
      if (method !== "POST") return json(res, 405, { error: "Use POST." });
      const panel = reach(cardRestore[1]!, true);
      if (!panel) return;
      const sent = await body(cardRestoreBody, "Send the card to put back.");
      if (!sent) return;
      const card = cleanCard(sent.card);
      if (!card) return json(res, 400, { error: "That is not a card this server can put back." });
      const restored = store.restoreCard(panel.id, card);
      if (restored.ok) deps.cards?.restored(card);
      return answer(restored, (done) => ({ panel: withAutomations(auth, done.panel) }));
    }

    const refresh = REFRESH.exec(path);
    if (refresh) {
      if (method !== "POST") return json(res, 405, { error: "Use POST." });
      const panel = reach(refresh[1]!, true);
      if (!panel) return;
      const sent = await body(refreshBody, "Send nothing, or the routineId to run.");
      if (!sent) return;
      if (!deps.refresh) return json(res, 404, { error: "No automation keeps this panel." });
      const ran = deps.refresh(auth, panel, sent.routineId);
      return ran.ok ? json(res, 202, { ok: true }) : json(res, ran.status, { error: ran.error });
    }

    const card = CARD.exec(path);
    if (card) {
      const panel = reach(card[1]!, true);
      if (!panel) return;
      const cardId = card[2]!;
      if (method === "PATCH") {
        const sent = await body(cardPatchBody, "Send title, size (s, m or l), prompt, schedule, alert, notify or botId.");
        if (!sent) return;
        if (sent.botId && !(auth.scopes.includes("admin") || ["chat", "edit"].includes(deps.levelOf(auth, sent.botId)))) {
          return json(res, 403, { error: "You can only give a card to a bot you can chat with." });
        }
        const refusal = deps.cards?.limitRefusal(cardId, sent.schedule);
        if (refusal) return json(res, 409, { error: `There are already ${PANEL_LIMITS.scheduledCards} cards that update by themselves. Choose Manual, or remove a scheduled card first.` });
        const { title: newTitle, size, botId, prompt, schedule, alert, notify } = sent;
        const patched = store.patchCard(panel.id, cardId, {
          ...(newTitle !== undefined ? { title: newTitle } : {}), ...(size ? { size } : {}), ...(botId ? { botId } : {}),
          extra: {
            ...(prompt !== undefined ? { prompt: prompt ? redactSecretsInText(prompt) : null } : {}), ...(schedule ? { schedule } : {}),
            ...(alert !== undefined ? { alert: alert ? redactSecretsInText(alert) : null } : {}), ...(notify !== undefined ? { notify } : {}),
          },
        });
        if (!patched.ok) return json(res, patched.status, { error: patched.error });
        const automated = [prompt, schedule, alert, botId, newTitle].some((one) => one !== undefined) && (patched.card.prompt || patched.card.routineId);
        if (automated && deps.cards) {
          const synced = deps.cards.syncOwn(panel.id, cardId, botId ? { botId } : {});
          if (!synced.ok) return json(res, synced.status, { error: synced.error });
        }
        return json(res, 200, { panel: withAutomations(auth, store.get(panel.id)!) });
      }
      if (method === "DELETE") {
        const removed = store.removeCard(panel.id, cardId);
        if (removed.ok) deps.cards?.removed(removed.panel, removed.card);
        return answer(removed, (done) => ({ panel: withAutomations(auth, done.panel), card: done.card }));
      }
      return json(res, 405, { error: "Use PATCH or DELETE." });
    }

    const one = ONE.exec(path);
    if (!one) return json(res, 404, { error: "No such panel route." });
    const panelId = one[1]!;
    if (method === "GET") {
      const panel = reach(panelId, false);
      return panel ? json(res, 200, { panel: withAutomations(auth, panel) }) : undefined;
    }
    if (method === "PATCH") {
      const panel = reach(panelId, true);
      if (!panel) return;
      const sent = await body(patchBody, "Send title or about.");
      if (!sent) return;
      return answer(store.patch(panel.id, sent), (done) => ({ panel: withAutomations(auth, done.panel) }));
    }
    if (method === "DELETE") {
      const panel = reach(panelId, true);
      if (!panel) return;
      return answer(store.remove(panel.id), (done) => ({ panel: done.panel }));
    }
    return json(res, 405, { error: "Use GET, PATCH or DELETE." });
  };
}
