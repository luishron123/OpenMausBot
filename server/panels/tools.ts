// The routes behind a bot's panel tools (agents-panel-tools.ts), for the turn that calls them. Each answers with the
// sentence the bot reads back. A widget goes through the same scrub show_widget's does, so a secret in it is stored masked.
import { z } from "zod";

import { PANEL_CARD_SIZES, PANEL_KEY, PANEL_LIMITS, type Panel, type PanelCard } from "../../shared/panels.ts";
import { canonicalWidget } from "../chat-widgets.ts";
import { redactSecretsInText } from "../redact.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { CardContent, PanelStore } from "./store.ts";
import type { PanelTurnAccess } from "./turn-access.ts";

export const PANEL_TOOL_PATH = "/api/internal/panels";

export interface PanelToolDeps {
  store: PanelStore;
  enabled(): boolean;
  /** Whether this turn may see the panel, or with "change" change it, as the person behind its conversation could; a panel
   * it may not see answers as one that does not exist, one it may only see refuses the change. Without it every panel is
   * seen and changed, as on a server one person uses. */
  sees?: PanelTurnAccess;
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

const listBody = z.object({ panel_id: panelRef.optional() });
const createBody = z.object({
  title: z.string({ error: 'title: required, e.g. {"title":"Daily sales","key":"daily-sales"}.' }).trim().min(1, "title: required.").max(PANEL_LIMITS.title, `title: at most ${PANEL_LIMITS.title} characters.`),
  about: z.string().trim().max(PANEL_LIMITS.about, `about: at most ${PANEL_LIMITS.about} characters.`).optional(),
  key: key("key").optional(),
});
const setBody = z.object({ panel_id: panelRef, card_key: key("card_key").optional(), title: cardTitle, size: size.optional(), widget, fallback_text: fallback.optional() });
const updateBody = z.object({
  panel_id: panelRef,
  card_id: z.string().trim().min(1).max(100).optional(),
  card_key: key("card_key").optional(),
  title: cardTitle.optional(),
  size: size.optional(),
  widget: widget.optional(),
  fallback_text: fallback.optional(),
  failed: z.string().trim().min(1, "failed: say in a sentence why the card could not be updated.").optional(),
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
    const seen = (panel: Panel | undefined) => (panel && (deps.sees?.(caller, panel) ?? true) ? panel : undefined);
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

    switch (path.slice(PANEL_TOOL_PATH.length + 1)) {
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
        const made = store.create({ title: sent.title, ...(sent.about ? { about: sent.about } : {}), ...(sent.key ? { key: sent.key } : {}), createdBy: { botId: caller.botId, threadId: caller.threadId } });
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
        const panel = find(sent.panel_id);
        if (!panel) return failed(404, missing(sent.panel_id));
        if (!changes(panel)) return failed(403, readOnly(panel));
        const scrubbed = content(sent);
        if (!scrubbed.ok) return failed(400, scrubbed.error);
        const set = store.setCard(panel.id, { ...(sent.card_key ? { key: sent.card_key } : {}), title: sent.title, ...(sent.size ? { size: sent.size } : {}), content: scrubbed.content, botId: caller.botId });
        if (!set.ok) return failed(set.status, set.error);
        const ref = set.card.key ? `"card_key":"${set.card.key}"` : `"card_id":"${set.card.id}"`;
        return json(res, 200, {
          cardId: set.card.id,
          text: `${set.created ? "Added" : "Replaced"} card ${set.card.id} on panel ${panel.id}. Change it later with update_panel_widget {"panel_id":"${panel.id}",${ref},…}.${scrubbed.masked ? MASKED : ""}`,
        });
      }
      case "update-card": {
        const sent = read(updateBody);
        if (!sent) return;
        if (!sent.card_id && !sent.card_key) return failed(400, `Name the card with card_id or card_key, e.g. ${EXAMPLE_UPDATE}.`);
        if (sent.title === undefined && !sent.size && !sent.widget && sent.failed === undefined) {
          return failed(400, `Send what changes: widget (new content), title, size, or failed (why it could not be updated), e.g. ${EXAMPLE_UPDATE}.`);
        }
        if (sent.widget && sent.failed !== undefined) return failed(400, "Send widget when you have new content, or failed when you could not get it; not both.");
        const panel = find(sent.panel_id);
        if (!panel) return failed(404, missing(sent.panel_id));
        if (!changes(panel)) return failed(403, readOnly(panel));
        const scrubbed = sent.widget ? content({ widget: sent.widget, ...(sent.fallback_text !== undefined ? { fallback_text: sent.fallback_text } : {}) }) : null;
        if (scrubbed && !scrubbed.ok) return failed(400, scrubbed.error);
        const reason = sent.failed !== undefined ? redactSecretsInText(sent.failed) : undefined;
        const updated = store.updateCard(panel.id, sent.card_id ? { cardId: sent.card_id } : { key: sent.card_key! }, {
          ...(sent.title !== undefined ? { title: sent.title } : {}), ...(sent.size ? { size: sent.size } : {}),
          ...(scrubbed?.ok ? { content: scrubbed.content } : {}), ...(reason !== undefined ? { failed: reason } : {}), botId: caller.botId,
        });
        if (!updated.ok) return failed(updated.status, updated.error);
        const done = sent.failed !== undefined ? " as failed; it keeps its last content" : "";
        return json(res, 200, { cardId: updated.card.id, text: `${sent.failed !== undefined ? "Marked" : "Updated"} card ${updated.card.id} on panel ${panel.id}${done}.${(scrubbed?.ok && scrubbed.masked) || reason !== sent.failed ? MASKED : ""}` });
      }
      default:
        return failed(404, "No such panel tool.");
    }
  };
}
