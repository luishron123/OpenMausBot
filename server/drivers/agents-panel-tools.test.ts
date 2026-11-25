import { describe, expect, it } from "vitest";

import type { ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { callPanelTool, PANEL_TOOL_DEFINITIONS, PANEL_TOOL_NAMES } from "./agents-panel-tools.ts";

const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "scout", ...env })).map((tool) => tool.name);

describe("the panel tools on the wire", () => {
  it("are listed unless OMB_PANELS is 0", () => {
    const panelTools = ["list_panels", "create_panel", "set_panel_widget", "update_panel_widget"];
    expect(names({})).toEqual(expect.arrayContaining(panelTools));
    expect(names({ OMB_PANELS: "1" })).toEqual(expect.arrayContaining(panelTools));
    expect(names({ OMB_PANELS: "0" }).filter((name) => PANEL_TOOL_NAMES.has(name))).toEqual([]);
  });

  it("keep flat, closed schemas", () => {
    expect(PANEL_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.inputSchema.additionalProperties, tool.inputSchema.required ?? []])).toEqual([
      ["list_panels", false, []],
      ["create_panel", false, ["title"]],
      ["set_panel_widget", false, ["panel_id", "title", "widget"]],
      ["update_panel_widget", false, ["panel_id"]],
    ]);
    expect(JSON.stringify(PANEL_TOOL_DEFINITIONS)).not.toMatch(/"(oneOf|anyOf|allOf|const|format)"/);
    expect(PANEL_TOOL_DEFINITIONS.find((tool) => tool.name === "create_panel")!.description).toContain("automation with panel_id");
  });
});

describe("a panel tool call", () => {
  const calling = (answer: { ok: boolean; body: Record<string, unknown> }) => {
    const sent: Array<{ path: string; init: RequestInit }> = [];
    const context = { client: { apiResponse: async (path: string, init: RequestInit) => (sent.push({ path, init }), answer) } } as unknown as ToolCallContext;
    return { sent, context };
  };

  it("posts its arguments to the route of that tool and returns the server's sentence", async () => {
    const { sent, context } = calling({ ok: true, body: { text: "Added card crd_1 on panel pnl_1." } });
    const args = { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: { type: "Card", children: [] } };
    expect(await callPanelTool("set_panel_widget", args, context)).toEqual({ text: "Added card crd_1 on panel pnl_1." });
    expect(sent).toEqual([{ path: "/api/internal/panels/set-card", init: { method: "POST", body: JSON.stringify(args) } }]);
    for (const [tool, route] of [["list_panels", "list"], ["create_panel", "create"], ["update_panel_widget", "update-card"]]) {
      await callPanelTool(tool!, {}, context);
      expect(sent.at(-1)!.path).toBe(`/api/internal/panels/${route}`);
    }
  });

  it("hands the server's refusal back as an error the bot reads", async () => {
    const { context } = calling({ ok: false, body: { error: "No panel nope. Call list_panels for the ids, or create_panel first." } });
    expect(await callPanelTool("update_panel_widget", { panel_id: "nope" }, context)).toEqual({ text: "No panel nope. Call list_panels for the ids, or create_panel first.", isError: true });
    expect(await callPanelTool("list_panels", {}, calling({ ok: false, body: {} }).context)).toMatchObject({ isError: true, text: expect.stringContaining("Try again") });
  });
});
