// The routes behind a bot's panel tools (agents-panel-tools.ts), for the turn that calls them. Each answers with the
// sentence the bot reads back. A widget goes through the same scrub show_widget's does, so a secret in it is stored masked.
import { z } from "zod";

import { PANEL_CARD_SIZES, PANEL_KEY, PANEL_LIMITS, PANEL_SCHEDULES, PANEL_VISIBILITIES, type Panel, type PanelCard } from "../../shared/panels.ts";
import { canonicalWidget } from "../chat-widgets.ts";
import { redactSecretsInText } from "../redact.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { ALREADY_UPDATED, type PanelCards } from "./cards.ts";
import { freeCardKey, type CardContent, type CardExtra, type PanelStore } from "./store.ts";
import type { PanelTurnAccess } from "./turn-access.ts";

export const PANEL_TOOL_PATH = "/api/internal/panels";

export interface PanelToolDeps {
  store: PanelStore;
  enabled(): boolean;
  /** Whether this turn may see the panel, or with "change" change it, as the person behind its conversation could; a panel
   * it may not see answers as one that does not exist, one it may only see refuses the change. Without it every panel is
   * seen and changed, as on a server one person uses. */
  sees?: PanelTurnAccess;
  /** Cards' own automations: made from a prompt and schedule, and the rules of their update runs. */
  cards?: PanelCards;
}

/** A private panel, which a bot's tools see only when that bot made it or has a card on it. */
export function privateHides(panel: Pick<Panel, "visibility" | "createdBy" | "cards">, botId: string): boolean {
  return panel.visibility === "private" && panel.createdBy.botId !== botId && !panel.cards.some((card) => card.botId === botId);
}

export interface PanelCaller {
  botId: string;
  threadId: string;
}

const MASKED = " Something in it read as a secret and was masked before it was stored. Never put secrets on a panel.";
const KEY_RULE = "lowercase letters, digits and dashes, starting with a letter or digit, at most 64";

const key = (field: string) => z.string().regex(PANEL_KEY, `${field}: use ${KEY_RULE}, e.g. "daily-sales".`);
const panelRef = z.string({ error: 'panel_id: required, the id or key list_panels or create_panel gave, e.g. "pnl_3f9a…" or "daily-sales".' }).trim().min(1).max(100);
const cardTitle = z.string().trim().min(1, "title: required, a few words naming the card.").max(PANEL_LIMITS.title, `title: at most ${PANEL_LIMITS.title} characters.`);
const size = z.enum(PANEL_CARD_SIZES, { error: 'size: one of "s", "m" or "l".' });
const widget = z.record(z.string(), z.unknown(), { error: 'widget: a JSON tree like show_widget\'s, e.g. {"type":"Card","children":[{"type":"Title","value":"$4,210"}]}.' });
const fallback = z.string().max(PANEL_LIMITS.fallbackText, `fallback_text: at most ${PANEL_LIMITS.fallbackText} characters.`);
const prompt = z.string().trim().min(1, "prompt: say what the card tracks, e.g. \"today's revenue from Shopify\".").max(PANEL_LIMITS.prompt, `prompt: at most ${PANEL_LIMITS.prompt} characters.`);
const schedule = z.enum(PANEL_SCHEDULES, { error: 'schedule: one of "half" (every 30 minutes), "hour", "day" (08:00), "week" (Monday 08:00) or "manual".' });
const alert = z.string().trim().min(1).max(PANEL_LIMITS.alert, `alert: at most ${PANEL_LIMITS.alert} characters.`);
const sources = z.array(z.string().trim().min(1).max(PANEL_LIMITS.source, `sources: each at most ${PANEL_LIMITS.source} characters.`), { error: 'sources: a list of short names or URLs, e.g. ["Shopify","https://example.com/report"].' }).max(PANEL_LIMITS.sources, `sources: at most ${PANEL_LIMITS.sources}.`);

const listBody = z.object({ panel_id: panelRef.optional() });
const createBody = z.object({
  title: z.string({ error: 'title: required, e.g. {"title":"Daily sales","key":"daily-sales"}.' }).trim().min(1, "title: required.").max(PANEL_LIMITS.title, `title: at most ${PANEL_LIMITS.title} characters.`),
  about: z.string().trim().max(PANEL_LIMITS.about, `about: at most ${PANEL_LIMITS.about} characters.`).optional(),
  key: key("key").optional(),
  visibility: z.enum(PANEL_VISIBILITIES, { error: 'visibility: "private" (only you and bots with a card on it) or "shared".' }).optional(),
});
const setBody = z.object({
  panel_id: panelRef, card_key: key("card_key").optional(), title: cardTitle, size: size.optional(), widget: widget.optional(), fallback_text: fallback.optional(),
  prompt: prompt.optional(), schedule: schedule.optional(), alert: alert.optional(), sources: sources.optional(),
});
const updateBody = z.object({
  panel_id: panelRef,
  card_id: z.string().trim().min(1).max(100).optional(),
  card_key: key("card_key").optional(),
  title: cardTitle.optional(),
  size: size.optional(),
  widget: widget.optional(),
  fallback_text: fallback.optional(),
  failed: z.string().trim().min(1, "failed: say in a sentence why the card could not be updated.").optional(),
  summary: z.string().trim().min(1).max(PANEL_LIMITS.summary, `summary: one line, at most ${PANEL_LIMITS.summary} characters.`).optional(),
  sources: sources.optional(),
  alert: alert.optional(),
  prompt: prompt.optional(),
  schedule: schedule.optional(),
});

const EXAMPLE_UPDATE = '{"panel_id":"daily-sales","card_key":"revenue","widget":{"type":"Card","children":[{"type":"Title","value":"$4,210"}]}}';

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "That input could not be read.";
  return issue.message.includes(":") ? issue.message : `${issue.path.join(".") || "input"}: ${issue.message}`;
}

function cardLine(card: PanelCard): string {
  const ref = card.key ? `key ${card.key}, id ${card.id}` : `id ${card.id}`;
  const failed = card.status === "failed" ? `, FAILED: ${card.failure ?? "no reason given"}` : "";
  return `- "${card.title}" (${ref}, size ${card.size}, updated ${card.updatedAt} by ${card.botId}${failed})`;
}

function panelLine(panel: Panel): string {
  const failed = panel.cards.filter((card) => card.status === "failed").length;
  return `- ${panel.id}${panel.key ? ` (key ${panel.key})` : ""}: "${panel.title}", ${panel.cards.length} card${panel.cards.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}, updated ${panel.updatedAt}`;
}

/** The scrubbed widget, or the sentence that says what to fix. */
function content(input: { widget: Record<string, unknown>; fallback_text?: string }): { ok: true; content: CardContent; masked: boolean } | { ok: false; error: string } {
  const made = canonicalWidget({ widget: input.widget, ...(input.fallback_text !== undefined ? { fallback_text: input.fallback_text } : {}) });
  return made.ok ? { ok: true, content: { widget: made.root, text: made.text }, masked: made.masked } : { ok: false, error: made.error };
}

export function createPanelToolRoutes(deps: PanelToolDeps) {
  const { store } = deps;
  const missing = (ref: string) => `No panel ${ref}. Call list_panels for the ids, or create_panel first.`;
  const readOnly = (panel: Panel) => `Panel ${panel.id} can be read from this conversation but not changed: only people who can chat with the bot that made it (${panel.createdBy.botId}) may change it. Report in chat instead, or make your own panel with create_panel.`;

  return (caller: PanelCaller): RouteHandler => async ({ req, res, path, method, json, readBody }) => {
    if (!path.startsWith(`${PANEL_TOOL_PATH}/`)) return PASS;
    const seen = (panel: Panel | undefined) => (panel && !privateHides(panel, caller.botId) && (deps.sees?.(caller, panel) ?? true) ? panel : undefined);
    const find = (ref: string) => seen(store.get(ref)) ?? seen(store.byKey(ref));
    const changes = (panel: Panel) => deps.sees?.(caller, panel, "change") ?? true;
    if (method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!deps.enabled()) return json(res, 404, { error: "Panels are turned off on this computer. Show the result in chat instead." });
    const raw = await readBody(req);
    const read = <T>(schema: z.ZodType<T>): T | null => {
      const parsed = schema.safeParse(raw ?? {});
      if (parsed.success) return parsed.data;
      json(res, 400, { error: firstIssue(parsed.error) });
      return null;
    };
    const failed = (status: number, error: string) => json(res, status, { error });
    const route = path.slice(PANEL_TOOL_PATH.length + 1);
    const own = deps.cards?.ownRun(caller.threadId) ?? null;
    const bound = own ? `This update run may only call update_panel_widget for its own card: panel_id "${own.panel.id}", card_key "${own.card.key}".` : "";
    if (own && route !== "update-card") return failed(403, bound);

    switch (route) {
      case "list": {
        const sent = read(listBody);
        if (!sent) return;
        if (!sent.panel_id) {
          const panels = store.list().filter((panel) => seen(panel));
          if (!panels.length) return json(res, 200, { text: "There are no panels yet. Make one with create_panel." });
          return json(res, 200, { text: `Panels, the most recently updated first:\n${panels.map(panelLine).join("\n")}` });
        }
        const panel = find(sent.panel_id);
        if (!panel) return failed(404, missing(sent.panel_id));
        const cards = [...panel.cards].sort((a, b) => a.position - b.position);
        return json(res, 200, {
          text: `${panelLine(panel).slice(2)}${panel.about ? `\nAbout: ${panel.about}` : ""}\n${cards.length ? `Cards:\n${cards.map(cardLine).join("\n")}` : "No cards yet. Add one with set_panel_widget."}`,
        });
      }
      case "create": {
        const sent = read(createBody);
        if (!sent) return;
        const taken = sent.key ? store.byKey(sent.key) : undefined;
        if (taken && !seen(taken)) return failed(409, `key: "${sent.key}" is taken by a panel this conversation cannot see. Pick another key.`);
        if (taken && !changes(taken)) return failed(403, readOnly(taken));
        const made = store.create({ title: sent.title, ...(sent.about ? { about: sent.about } : {}), ...(sent.key ? { key: sent.key } : {}), ...(sent.visibility ? { visibility: sent.visibility } : {}), createdBy: { botId: caller.botId, threadId: caller.threadId } });
        if (!made.ok) return failed(made.status, made.error);
        const { panel } = made;
        return json(res, 200, {
          panelId: panel.id,
          text: `${made.created ? "Made" : "Already had"} panel ${panel.id}${panel.key ? ` (key ${panel.key})` : ""}: "${panel.title}". Add cards with set_panel_widget {"panel_id":"${panel.id}","card_key":"…","title":"…","widget":{…}}. For a report that must stay current, create an automation with panel_id "${panel.id}" that updates its cards.`,
        });
      }
      case "set-card": {
        const sent = read(setBody);
        if (!sent) return;
        if (!sent.widget && !sent.prompt) return failed(400, 'Send widget (what the card shows now), e.g. {"panel_id":"daily-sales","card_key":"revenue","title":"Revenue","widget":{"type":"Card","children":[{"type":"Title","value":"$4,210"}]}}, or prompt (what it tracks; a first run builds the card), e.g. {"panel_id":"daily-sales","card_key":"revenue","title":"Revenue","prompt":"Today\'s revenue from Shopify","schedule":"hour"}, or both.');
        if (sent.schedule && sent.schedule !== "manual" && !sent.prompt && !(sent.card_key && find(sent.panel_id)?.cards.find((card) => card.key === sent.card_key)?.prompt)) {
          return failed(400, "schedule needs prompt: say what the card tracks, so each run knows what to fetch.");
        }
        const panel = find(sent.panel_id);
        if (!panel) return failed(404, missing(sent.panel_id));
        if (!changes(panel)) return failed(403, readOnly(panel));
        const scrubbed = sent.widget ? content({ widget: sent.widget, ...(sent.fallback_text !== undefined ? { fallback_text: sent.fallback_text } : {}) }) : null;
        if (scrubbed && !scrubbed.ok) return failed(400, scrubbed.error);
        const cardKey = sent.card_key ?? (sent.prompt ? freeCardKey(panel, sent.title) : undefined);
        const before = cardKey ? panel.cards.find((card) => card.key === cardKey) : undefined;
        const refusal = deps.cards?.limitRefusal(before?.id, sent.schedule);
        if (refusal) return failed(409, refusal);
        const extra: CardExtra = {
          ...(sent.prompt ? { prompt: redactSecretsInText(sent.prompt) } : {}), ...(sent.schedule ? { schedule: sent.schedule } : {}),
          ...(sent.alert ? { alert: sent.alert } : {}), ...(sent.sources ? { sources: sent.sources } : {}),
          ...(!scrubbed && !before?.widget ? { building: true as const } : {}),
        };
        const set = store.setCard(panel.id, { ...(cardKey ? { key: cardKey } : {}), title: sent.title, ...(sent.size ? { size: sent.size } : {}), ...(scrubbed?.ok ? { content: scrubbed.content } : {}), botId: caller.botId, extra });
        if (!set.ok) return failed(set.status, set.error);
        if (scrubbed?.ok) deps.cards?.updatedCard(set.panel, set.previous, set.card, {});
        let automation = "";
        if (deps.cards && (set.card.prompt || set.card.routineId)) {
          const synced = deps.cards.syncOwn(panel.id, set.card.id, { botId: caller.botId, run: !scrubbed });
          if (!synced.ok) return failed(synced.status, `The card was saved, but its automation was not: ${synced.error}`);
          if (synced.routineId) {
            const when = set.card.schedule && set.card.schedule !== "manual" ? `on schedule "${set.card.schedule}"` : "only when the person asks (schedule manual)";
            automation = ` Its own automation ${synced.routineId} keeps it current ${when}${synced.runId ? "; the first run has started and builds the card" : ""}.`;
          }
        }
        const ref = set.card.key ? `"card_key":"${set.card.key}"` : `"card_id":"${set.card.id}"`;
        return json(res, 200, {
          cardId: set.card.id,
          text: `${set.created ? "Added" : "Replaced"} card ${set.card.id} on panel ${panel.id}.${automation} Change it later with update_panel_widget {"panel_id":"${panel.id}",${ref},…}.${scrubbed?.ok && scrubbed.masked ? MASKED : ""}`,
        });
      }
      case "update-card": {
        const sent = read(updateBody);
        if (!sent) return;
        if (!sent.card_id && !sent.card_key) return failed(400, `Name the card with card_id or card_key, e.g. ${EXAMPLE_UPDATE}.`);
        const asks = [sent.title, sent.size, sent.widget, sent.failed, sent.summary, sent.sources, sent.alert, sent.prompt, sent.schedule];
        if (asks.every((one) => one === undefined)) {
          return failed(400, `Send what changes: widget (new content) with a one-line summary, title, size, sources, alert, prompt, schedule, or failed (why it could not be updated), e.g. ${EXAMPLE_UPDATE}.`);
        }
        if (sent.widget && sent.failed !== undefined) return failed(400, "Send widget when you have new content, or failed when you could not get it; not both.");
        const panel = find(sent.panel_id);
        if (!panel) return failed(404, missing(sent.panel_id));
        if (own) {
          const mine = panel.id === own.panel.id && (sent.card_id ? sent.card_id === own.card.id : sent.card_key === own.card.key);
          if (!mine) return failed(403, bound);
          if (deps.cards?.hasUpdated(own.run.id)) return failed(409, ALREADY_UPDATED);
        }
        if (!changes(panel)) return failed(403, readOnly(panel));
        const target = panel.cards.find((card) => (sent.card_id ? card.id === sent.card_id : card.key === sent.card_key));
        const refusal = target ? deps.cards?.limitRefusal(target.id, sent.schedule) : null;
        if (refusal) return failed(409, refusal);
        const scrubbed = sent.widget ? content({ widget: sent.widget, ...(sent.fallback_text !== undefined ? { fallback_text: sent.fallback_text } : {}) }) : null;
        if (scrubbed && !scrubbed.ok) return failed(400, scrubbed.error);
        const reason = sent.failed !== undefined ? redactSecretsInText(sent.failed) : undefined;
        const summary = sent.summary !== undefined ? redactSecretsInText(sent.summary) : undefined;
        const alertText = sent.alert !== undefined ? redactSecretsInText(sent.alert) : undefined;
        const at = new Date().toISOString();
        const extra: CardExtra = {
          ...(sent.sources ? { sources: sent.sources } : {}), ...(alertText ? { alertActive: { text: alertText, at } } : {}),
          ...(sent.prompt ? { prompt: redactSecretsInText(sent.prompt) } : {}), ...(sent.schedule ? { schedule: sent.schedule } : {}),
        };
        const updated = store.updateCard(panel.id, sent.card_id ? { cardId: sent.card_id } : { key: sent.card_key! }, {
          ...(sent.title !== undefined ? { title: sent.title } : {}), ...(sent.size ? { size: sent.size } : {}),
          ...(scrubbed?.ok ? { content: scrubbed.content } : {}), ...(reason !== undefined ? { failed: reason } : {}), botId: caller.botId, extra,
        });
        if (!updated.ok) return failed(updated.status, updated.error);
        if (scrubbed?.ok || reason !== undefined || own) {
          deps.cards?.updatedCard(updated.panel, updated.previous, updated.card, { ...(summary ? { summary } : {}), ...(alertText ? { alert: alertText } : {}), ...(own ? { run: own.run } : {}) });
        } else if (alertText) {
          deps.cards?.updatedCard(updated.panel, updated.previous, updated.card, { alert: alertText });
        }
        if (deps.cards && (sent.prompt || sent.schedule) && (updated.card.prompt || updated.card.routineId)) {
          const synced = deps.cards.syncOwn(panel.id, updated.card.id, own ? {} : { botId: caller.botId });
          if (!synced.ok) return failed(synced.status, `The card was updated, but its automation was not: ${synced.error}`);
        }
        const done = sent.failed !== undefined ? " as failed; it keeps its last content" : "";
        const masked = (scrubbed?.ok && scrubbed.masked) || reason !== sent.failed || summary !== sent.summary || alertText !== sent.alert;
        return json(res, 200, { cardId: updated.card.id, text: `${sent.failed !== undefined ? "Marked" : "Updated"} card ${updated.card.id} on panel ${panel.id}${done}.${own ? " That was this run's one update; stop here." : ""}${masked ? MASKED : ""}` });
      }
      default:
        return failed(404, "No such panel tool.");
    }
  };
}
