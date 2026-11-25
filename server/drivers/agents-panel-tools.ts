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

export const PANEL_TOOL_DEFINITIONS = [
  {
    name: "list_panels",
    description: "List the panels, or with panel_id one panel's cards.",
    inputSchema: { type: "object", additionalProperties: false, properties: { panel_id: PANEL_ID } },
  },
  {
    name: "create_panel",
    description:
      "Make a panel: cards you keep up to date, for numbers the person checks again. A key makes it idempotent. For a report that must stay current, also create an automation with panel_id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: 120 },
        about: { type: "string", maxLength: 400 },
        key: KEY,
      },
      required: ["title"],
    },
  },
  {
    name: "set_panel_widget",
    description: "Add a card to a panel, or replace the one with this card_key.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { panel_id: PANEL_ID, card_key: KEY, title: { type: "string", maxLength: 120 }, size: SIZE, widget: WIDGET, fallback_text: FALLBACK },
      required: ["panel_id", "title", "widget"],
    },
  },
  {
    name: "update_panel_widget",
    description:
      "Change one card (card_id or card_key). If you could not get fresh data, send failed with the reason instead of widget; the card keeps its last content.",
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
      },
      required: ["panel_id"],
    },
  },
];
