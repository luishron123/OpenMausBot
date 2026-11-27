// The agents catalog's panel tools and the internal route behind each. Left out when `features.panels` is false.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

const PANEL_TOOL_ROUTES: Readonly<Record<string, string>> = {
  list_panels: "list",
  create_panel: "create",
  set_panel_widget: "set-card",
  update_panel_widget: "update-card",
};
export const PANEL_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(PANEL_TOOL_ROUTES));

export async function callPanelTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(`/api/internal/panels/${PANEL_TOOL_ROUTES[name]}`, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? "Done.") } : { text: String(body.error ?? "The panel could not be changed. Try again shortly."), isError: true };
}

const PANEL_ID = { type: "string", description: "The panel's id or key." };
const KEY = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$", description: "A stable name, e.g. \"daily-sales\"." };
const SIZE = { type: "string", enum: ["s", "m", "l"], description: "Width; s by default." };
const WIDGET = { type: "object", additionalProperties: true, description: "One JSON tree like show_widget's, without buttons or forms." };
const FALLBACK = { type: "string" };
const PROMPT = { type: "string", maxLength: 2000, description: "What the card tracks; each update run reads it." };
const SCHEDULE = { type: "string", enum: ["half", "hour", "day", "week", "manual"], description: "Self-update cadence, person's time zone: half=30 min, day=08:00, week=Mon 08:00, manual=on Refresh." };
const SOURCES = { type: "array", maxItems: 8, items: { type: "string", maxLength: 300 }, description: "Names or URLs you read." };

export const PANEL_TOOL_DEFINITIONS = [
  {
    name: "list_panels",
    description: "List the panels, or with panel_id one panel's cards.",
    inputSchema: { type: "object", additionalProperties: false, properties: { panel_id: PANEL_ID } },
  },
  {
    name: "create_panel",
    description:
      "Make a panel of cards you keep current. A key makes it idempotent (an existing key updates title, about, visibility). For a live card give set_panel_widget a prompt and schedule, or create an automation with panel_id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: 120 },
        about: { type: "string", maxLength: 400 },
        key: KEY,
        visibility: { type: "string", enum: ["private", "shared"], description: "private: only you and its card bots see it. Default shared." },
      },
      required: ["title"],
    },
  },
  {
    name: "set_panel_widget",
    description:
      "Add a card, or replace the one with this card_key. Send widget, prompt or both; prompt+schedule gives it its own updating automation (prompt alone builds it in a run now). Max 60 scheduled cards.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        panel_id: PANEL_ID, card_key: KEY, title: { type: "string", maxLength: 120 }, size: SIZE, widget: WIDGET, fallback_text: FALLBACK,
        prompt: PROMPT, schedule: SCHEDULE,
        alert: { type: "string", maxLength: 300, description: "Condition to warn the person about." },
        sources: SOURCES,
      },
      required: ["panel_id", "title"],
    },
  },
  {
    name: "update_panel_widget",
    description:
      "Change one card (card_id or card_key): widget plus a one-line summary. Without fresh data send failed with the reason instead; the card keeps its content.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        panel_id: PANEL_ID,
        card_id: { type: "string" },
        card_key: KEY,
        title: { type: "string", maxLength: 120 },
        size: SIZE,
        widget: WIDGET,
        fallback_text: FALLBACK,
        failed: { type: "string", maxLength: 400 },
        summary: { type: "string", maxLength: 300, description: "What changed." },
        sources: SOURCES,
        alert: { type: "string", maxLength: 300, description: "Only when the alert condition is met: one sentence for the person." },
        prompt: PROMPT,
        schedule: SCHEDULE,
      },
      required: ["panel_id"],
    },
  },
];
