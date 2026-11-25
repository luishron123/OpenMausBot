import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { createPanelStore } from "./store.ts";
import { createPanelToolRoutes, type PanelToolDeps } from "./tools.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function serve(botId = "scout", sees?: PanelToolDeps["sees"]) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-panels-tools-"));
  dirs.push(dataDir);
  const store = createPanelStore({ dataDir });
  let enabled = true;
  const routes = createPanelToolRoutes({ store, enabled: () => enabled, ...(sees ? { sees } : {}) });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "internal", scopes: [] } as unknown as RequestAuth;
    if (!await dispatchRoutes([routes({ botId, threadId: "t1" })], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { passed: true });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tool = async (route: string, body: unknown) => {
    const res = await fetch(`${base}/api/internal/panels/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  return { tool, store, turn: (on: boolean) => { enabled = on; }, base };
}

const widget = (value: string) => ({ type: "Card", children: [{ type: "Title", value }] });

it("makes a panel once per key, as the calling bot, and says how to keep it current", async () => {
  const { tool, store } = await serve();
  const made = await tool("create", { title: "Daily sales", key: "daily-sales", about: "From Shopify" });
  expect(made.status).toBe(200);
  expect(made.body.text).toMatch(/^Made panel pnl_\w+ \(key daily-sales\): "Daily sales"\./);
  expect(made.body.text).toContain(`automation with panel_id "${made.body.panelId}"`);
  expect(store.get(made.body.panelId)).toMatchObject({ createdBy: { botId: "scout", threadId: "t1" }, about: "From Shopify" });
  const again = await tool("create", { title: "Daily sales", key: "daily-sales" });
  expect(again.body).toMatchObject({ panelId: made.body.panelId, text: expect.stringMatching(/^Already had panel/) });
  expect(store.list()).toHaveLength(1);
});

it("sets a card by key on a panel named by its key, replaces it, then lists it", async () => {
  const { tool, store } = await serve();
  const { panelId } = (await tool("create", { title: "Daily sales", key: "daily-sales" })).body;
  const set = await tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", size: "m", widget: widget("$4,210"), fallback_text: "Revenue $4,210" });
  expect(set.body.text).toContain(`Added card ${set.body.cardId} on panel ${panelId}`);
  expect(set.body.text).toContain(`"card_key":"revenue"`);
  const replaced = await tool("set-card", { panel_id: panelId, card_key: "revenue", title: "Revenue", widget: widget("$5,000") });
  expect(replaced.body).toMatchObject({ cardId: set.body.cardId, text: expect.stringMatching(/^Replaced card/) });
  expect(store.get(panelId)!.cards).toMatchObject([{ key: "revenue", size: "m", botId: "scout", text: expect.stringContaining("$5,000") }]);
  const listed = await tool("list", { panel_id: panelId });
  expect(listed.body.text).toContain(`"Revenue" (key revenue, id ${set.body.cardId}, size m`);
  expect((await tool("list", {})).body.text).toContain(`${panelId} (key daily-sales): "Daily sales", 1 card`);
});

it("marks a card failed with its last content kept, and fresh content clears it", async () => {
  const { tool, store } = await serve();
  const { panelId } = (await tool("create", { title: "Daily sales" })).body;
  const { cardId } = (await tool("set-card", { panel_id: panelId, card_key: "revenue", title: "Revenue", widget: widget("$4,210") })).body;
  const failed = await tool("update-card", { panel_id: panelId, card_key: "revenue", failed: "Shopify did not answer." });
  expect(failed.body.text).toBe(`Marked card ${cardId} on panel ${panelId} as failed; it keeps its last content.`);
  expect((await tool("list", { panel_id: panelId })).body.text).toContain("FAILED: Shopify did not answer.");
  expect((await tool("list", {})).body.text).toContain("1 failed");
  await tool("update-card", { panel_id: panelId, card_id: cardId, widget: widget("$6,000"), title: "Revenue today" });
  expect(store.get(panelId)!.cards[0]).toMatchObject({ status: "ok", title: "Revenue today", text: expect.stringContaining("$6,000") });
});

it("masks a secret in a widget and tells the bot", async () => {
  const { tool, store } = await serve();
  const { panelId } = (await tool("create", { title: "Keys" })).body;
  const secret = "sk-ant-api03-" + "b".repeat(40);
  const set = await tool("set-card", { panel_id: panelId, title: "Key", widget: { type: "Card", children: [{ type: "Text", value: `key ${secret}` }] } });
  expect(set.status).toBe(200);
  expect(set.body.text).toContain("masked");
  expect(JSON.stringify(store.get(panelId))).not.toContain(secret);
});

it("refuses with a sentence that teaches what to send", async () => {
  const { tool } = await serve();
  expect((await tool("create", {})).body.error).toContain('{"title":"Daily sales","key":"daily-sales"}');
  expect((await tool("create", { title: "x", key: "Daily Sales" })).body.error).toContain("key: use lowercase letters");
  expect((await tool("set-card", { panel_id: "nope", title: "x", widget: widget("1") }))).toMatchObject({ status: 404, body: { error: expect.stringContaining("list_panels") } });
  const { panelId } = (await tool("create", { title: "Daily sales" })).body;
  expect((await tool("set-card", { panel_id: panelId, title: "x" })).body.error).toContain('"type":"Card"');
  expect((await tool("set-card", { panel_id: panelId, title: "x", size: "xl", widget: widget("1") })).body.error).toBe('size: one of "s", "m" or "l".');
  expect((await tool("set-card", { panel_id: panelId, title: "x", widget: { type: "Nope" } })).status).toBe(400);
  expect((await tool("update-card", { panel_id: panelId, title: "x" })).body.error).toMatch(/^Name the card with card_id or card_key, e\.g\. \{/);
  expect((await tool("update-card", { panel_id: panelId, card_key: "revenue" })).body.error).toMatch(/^Send what changes/);
  expect((await tool("update-card", { panel_id: panelId, card_key: "revenue", widget: widget("1"), failed: "x" })).body.error).toContain("not both");
  expect((await tool("update-card", { panel_id: panelId, card_key: "revenue", title: "x" }))).toMatchObject({ status: 404, body: { error: expect.stringContaining("set_panel_widget") } });
});

it("answers that panels are off, and leaves other routes alone", async () => {
  const { tool, turn, base } = await serve();
  turn(false);
  expect(await tool("list", {})).toEqual({ status: 404, body: { error: "Panels are turned off on this computer. Show the result in chat instead." } });
  expect(await (await fetch(`${base}/api/internal/other`, { method: "POST" })).json()).toEqual({ passed: true });
});

it("treats a panel this turn may not see as one that does not exist, to read and to write", async () => {
  // Another person's bot: it sees only panels its own bot made.
  const { tool, store } = await serve("rival", (caller, panel) => panel.createdBy.botId === caller.botId);
  const made = store.create({ title: "Payroll", key: "payroll", createdBy: { botId: "scout", threadId: "t-mira" } });
  if (!made.ok) throw new Error(made.error);
  const set = store.setCard(made.panel.id, { key: "total", title: "Total", botId: "scout" });
  if (!set.ok) throw new Error(set.error);
  const before = JSON.stringify(store.get(made.panel.id));
  expect((await tool("list", {})).body.text).toBe("There are no panels yet. Make one with create_panel.");
  for (const ref of [made.panel.id, "payroll"]) {
    expect(await tool("list", { panel_id: ref })).toEqual({ status: 404, body: { error: `No panel ${ref}. Call list_panels for the ids, or create_panel first.` } });
    expect((await tool("set-card", { panel_id: ref, card_key: "total", title: "Total", widget: widget("$0") })).status).toBe(404);
    expect((await tool("update-card", { panel_id: ref, card_key: "total", failed: "x" })).status).toBe(404);
    expect((await tool("update-card", { panel_id: ref, card_key: "total", title: "Mine now" })).status).toBe(404);
  }
  expect(await tool("create", { title: "Payroll", key: "payroll" })).toMatchObject({ status: 409, body: { error: expect.stringContaining("Pick another key") } });
  expect(JSON.stringify(store.get(made.panel.id))).toBe(before);
  expect(store.list()).toHaveLength(1);
  const own = await tool("create", { title: "Mine", key: "mine" });
  expect((await tool("list", {})).body.text).toContain(own.body.panelId);
  expect((await tool("list", {})).body.text).not.toContain(made.panel.id);
});

it("masks a secret in a failure's reason before it is stored, and tells the bot", async () => {
  const { tool, store } = await serve();
  const { panelId } = (await tool("create", { title: "Daily sales" })).body;
  await tool("set-card", { panel_id: panelId, card_key: "revenue", title: "Revenue", widget: widget("$4,210") });
  const key = "sk-ant-api03-" + "c".repeat(40);
  const bearer = "Bearer " + "eyJhbGciOiJIUzI1NiJ9." + "d".repeat(40);
  const failed = await tool("update-card", { panel_id: panelId, card_key: "revenue", failed: `Shopify refused key ${key} with header Authorization: ${bearer}` });
  expect(failed.status).toBe(200);
  expect(failed.body.text).toContain("masked");
  const card = store.get(panelId)!.cards[0]!;
  expect(card).toMatchObject({ status: "failed", failure: expect.stringContaining("Shopify refused key") });
  expect(card.failure).not.toContain(key);
  expect(card.failure).not.toContain("d".repeat(40));
  expect((await tool("list", { panel_id: panelId })).body.text).not.toContain(key);
  // The store masks on its own too, for any other caller.
  const direct = store.updateCard(panelId, { key: "revenue" }, { failed: `token ${key}`, botId: "scout" });
  expect(direct.ok && direct.card.failure).not.toContain(key);
  const plain = await tool("update-card", { panel_id: panelId, card_key: "revenue", failed: "Shopify did not answer." });
  expect(plain.body.text).not.toContain("masked");
});
