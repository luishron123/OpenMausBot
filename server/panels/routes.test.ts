import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import type { BotAccessLevel } from "../../shared/bot-access.ts";
import type { PanelsChangedFrame } from "../../shared/panels.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { createPanelRoutes, type PanelRouteDeps } from "./routes.ts";
import { createPanels } from "./wiring.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const levels: Record<string, BotAccessLevel> = { scout: "chat", viewer: "view", hidden: "none" };

async function serve(options: { scopes?: readonly string[]; enabled?: boolean; extra?: Partial<PanelRouteDeps> } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-panels-routes-"));
  dirs.push(dataDir);
  const frames: PanelsChangedFrame[] = [];
  let enabled = options.enabled ?? true;
  const panels = createPanels({ dataDir, enabled: () => enabled, levelOf: (_auth, botId) => levels[botId] ?? "none", broadcast: (frame) => frames.push(frame as unknown as PanelsChangedFrame) });
  const routes = options.extra
    ? [createPanelRoutes({ store: panels.store, enabled: () => enabled, levelOf: (_auth, botId) => levels[botId] ?? "none", ...options.extra })]
    : [panels.routes];
  const scopes = options.scopes ?? ["chat"];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: scopes.includes("admin") ? "loopback" : "session", scopes } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { passed: true });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, init);
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  return { api, store: panels.store, frames, turn: (on: boolean) => { enabled = on; } };
}

const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const widget = { id: "card", type: "Card", children: [{ id: "title", type: "Title", value: "$4,210" }] };

function seed(store: Awaited<ReturnType<typeof serve>>["store"], botId: string, title = "Daily sales") {
  const made = store.create({ title, createdBy: { botId } });
  if (!made.ok) throw new Error(made.error);
  const card = store.setCard(made.panel.id, { key: "revenue", title: "Revenue", content: { widget: widget as never, text: "$4,210" }, botId });
  if (!card.ok) throw new Error(card.error);
  return { panel: made.panel, card: card.card };
}

it("lists only the panels whose bot this person can see, and hides the rest as not found", async () => {
  const { api, store } = await serve();
  const mine = seed(store, "scout", "Mine");
  seed(store, "viewer", "Watched");
  const hidden = seed(store, "hidden", "Hidden");
  const listed = await api("/api/panels");
  expect(listed.status).toBe(200);
  expect(listed.body.panels.map((panel: { title: string }) => panel.title).sort()).toEqual(["Mine", "Watched"]);
  expect(listed.body.panels.find((panel: { id: string }) => panel.id === mine.panel.id)).toMatchObject({ cardCount: 1 });
  expect((await api(`/api/panels/${hidden.panel.id}`)).status).toBe(404);
  expect((await api(`/api/panels/${hidden.panel.id}`, send("DELETE"))).status).toBe(404);
  const one = await api(`/api/panels/${mine.panel.id}`);
  expect(one.body.panel).toMatchObject({ id: mine.panel.id, automations: [], cards: [{ key: "revenue", text: "$4,210" }] });
});

it("lets view see but not change, and chat rename, resize, remove and undo", async () => {
  const { api, store, frames } = await serve();
  const watched = seed(store, "viewer");
  expect((await api(`/api/panels/${watched.panel.id}`)).status).toBe(200);
  expect((await api(`/api/panels/${watched.panel.id}`, send("PATCH", { title: "Mine now" }))).status).toBe(403);
  expect((await api(`/api/panels/${watched.panel.id}/cards/${watched.card.id}`, send("DELETE"))).status).toBe(403);

  const { panel, card } = seed(store, "scout");
  frames.length = 0;
  const renamed = await api(`/api/panels/${panel.id}`, send("PATCH", { title: "Sales", about: "From Shopify" }));
  expect(renamed).toMatchObject({ status: 200, body: { panel: { title: "Sales", about: "From Shopify" } } });
  expect(frames).toEqual([{ kind: "panels.changed", panelId: panel.id, botId: "scout" }]);
  expect((await api(`/api/panels/${panel.id}`, send("PATCH", { title: "" }))).status).toBe(400);
  expect((await api(`/api/panels/${panel.id}`, send("PATCH", { owner: "me" }))).status).toBe(400);

  const resized = await api(`/api/panels/${panel.id}/cards/${card.id}`, send("PATCH", { size: "l" }));
  expect(resized.body.panel.cards[0]).toMatchObject({ id: card.id, size: "l" });
  const cardGone = await api(`/api/panels/${panel.id}/cards/${card.id}`, send("DELETE"));
  expect(cardGone.body.panel.cards).toEqual([]);
  const cardBack = await api(`/api/panels/${panel.id}/cards/restore`, send("POST", { card: cardGone.body.card }));
  expect(cardBack.body.panel.cards).toMatchObject([{ id: card.id, text: "$4,210" }]);

  const gone = await api(`/api/panels/${panel.id}`, send("DELETE"));
  expect(gone.status).toBe(200);
  expect(frames.at(-1)).toEqual({ kind: "panels.changed", panelId: panel.id, botId: "scout", removed: true });
  expect((await api(`/api/panels/${panel.id}`)).status).toBe(404);
  const back = await api("/api/panels/restore", send("POST", { panel: gone.body.panel }));
  expect(back).toMatchObject({ status: 200, body: { panel: { id: panel.id, title: "Sales" } } });
  expect((await api("/api/panels/restore", send("POST", { panel: gone.body.panel }))).status).toBe(409);
});

it("scrubs a card put back by Undo like a widget a bot sends, and refuses one that is not a card", async () => {
  const { api, store } = await serve();
  const { panel, card } = seed(store, "scout");
  await api(`/api/panels/${panel.id}/cards/${card.id}`, send("DELETE"));
  const secret = "sk-ant-api03-" + "a".repeat(40);
  const sneaky = { ...card, widget: { type: "Card", children: [{ type: "Text", value: `key ${secret}` }] }, text: `key ${secret}` };
  const back = await api(`/api/panels/${panel.id}/cards/restore`, send("POST", { card: sneaky }));
  expect(back.status).toBe(200);
  expect(JSON.stringify(back.body)).not.toContain(secret);
  expect(JSON.stringify(store.get(panel.id))).not.toContain(secret);
  expect((await api(`/api/panels/${panel.id}/cards/restore`, send("POST", { card: { id: "crd_x" } }))).status).toBe(400);
  expect((await api("/api/panels/restore", send("POST", { panel: { id: "pnl_x" } }))).status).toBe(400);
});

it("masks a failure's reason in a card or panel put back by Undo", async () => {
  const { api, store } = await serve();
  const { panel, card } = seed(store, "scout");
  const key = "sk-ant-api03-" + "b".repeat(40);
  const bearer = "Bearer " + "eyJhbGciOiJIUzI1NiJ9." + "e".repeat(40);
  const failure = `Shopify refused ${key} with Authorization: ${bearer}`;
  await api(`/api/panels/${panel.id}/cards/${card.id}`, send("DELETE"));
  const cardBack = await api(`/api/panels/${panel.id}/cards/restore`, send("POST", { card: { ...card, status: "failed", failure, failedAt: card.updatedAt } }));
  expect(cardBack.status).toBe(200);
  expect(store.get(panel.id)!.cards[0]).toMatchObject({ status: "failed", failure: expect.stringContaining("Shopify refused") });
  for (const text of [JSON.stringify(cardBack.body), JSON.stringify(store.get(panel.id))]) {
    expect(text).not.toContain(key);
    expect(text).not.toContain("e".repeat(40));
  }
  const gone = await api(`/api/panels/${panel.id}`, send("DELETE"));
  const sneaky = { ...gone.body.panel, cards: gone.body.panel.cards.map((one: Record<string, unknown>) => ({ ...one, failure })) };
  const back = await api("/api/panels/restore", send("POST", { panel: sneaky }));
  expect(back.status).toBe(200);
  for (const text of [JSON.stringify(back.body), JSON.stringify(store.get(panel.id))]) {
    expect(text).not.toContain(key);
    expect(text).not.toContain("e".repeat(40));
  }
});

it("does not let a person put back a panel for a bot they cannot chat with", async () => {
  const { api, store } = await serve();
  const { panel } = seed(store, "viewer");
  const removed = store.remove(panel.id);
  if (!removed.ok) throw new Error(removed.error);
  expect((await api("/api/panels/restore", send("POST", { panel: removed.panel }))).status).toBe(403);
  expect(store.get(panel.id)).toBeUndefined();
});

it("gives an admin every panel, and answers 404 everywhere when panels are off", async () => {
  const { api, store, turn } = await serve({ scopes: ["admin"] });
  const hidden = seed(store, "hidden");
  expect((await api("/api/panels")).body.panels).toHaveLength(1);
  expect((await api(`/api/panels/${hidden.panel.id}`, send("PATCH", { title: "Renamed" }))).status).toBe(200);
  turn(false);
  expect(await api("/api/panels")).toEqual({ status: 404, body: { error: "Panels are turned off." } });
  expect((await api(`/api/panels/${hidden.panel.id}`)).status).toBe(404);
  expect((await api("/api/other")).body).toEqual({ passed: true });
});

it("fills the automations on one panel and runs one now when asked", async () => {
  const ran: (string | undefined)[] = [];
  const { api, store } = await serve({
    extra: {
      present: (_auth, panel) => ({ ...panel, automations: [{ routineId: "rtn_1", name: "Morning sales", botId: "scout", enabled: true, nextRunAt: null, lastRunAt: null, running: false, lastRunUpdatedNothing: false }] }),
      refresh: (_auth, _panel, routineId) => (routineId === "rtn_nope" ? { ok: false, status: 404, error: "No such automation on this panel." } : (ran.push(routineId), { ok: true })),
    },
  });
  const { panel } = seed(store, "scout");
  expect((await api(`/api/panels/${panel.id}`)).body.panel.automations).toMatchObject([{ routineId: "rtn_1", name: "Morning sales" }]);
  expect(await api(`/api/panels/${panel.id}/refresh`, send("POST", {}))).toEqual({ status: 202, body: { ok: true } });
  expect((await api(`/api/panels/${panel.id}/refresh`, send("POST", { routineId: "rtn_nope" }))).status).toBe(404);
  expect(ran).toEqual([undefined]);
  const watched = seed(store, "viewer");
  expect((await api(`/api/panels/${watched.panel.id}/refresh`, send("POST", {}))).status).toBe(403);
});

it("says a panel changed when a run of the automation that keeps it ends, though it changed no card", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-panels-runs-"));
  dirs.push(dataDir);
  const frames: PanelsChangedFrame[] = [];
  const routines = [{ id: "a", botId: "scout", target: "bot", panelId: "" }, { id: "b", botId: "scout", target: "bot" }];
  const manager = { listRoutines: () => routines, listRuns: () => [], update: () => null, runNow: () => null };
  const panels = createPanels({
    dataDir, enabled: () => true, levelOf: () => "chat", broadcast: (frame) => frames.push(frame as unknown as PanelsChangedFrame),
    routines: () => manager as unknown as NonNullable<ReturnType<NonNullable<Parameters<typeof createPanels>[0]["routines"]>>>,
  });
  const made = panels.store.create({ title: "Daily sales", createdBy: { botId: "scout" } });
  if (!made.ok) throw new Error(made.error);
  routines[0]!.panelId = made.panel.id;
  frames.length = 0;
  panels.runChanged({ id: "r1", routineId: "a", status: "running" } as never);
  panels.runChanged({ id: "r2", routineId: "b", status: "completed" } as never);
  expect(frames).toEqual([]);
  panels.runChanged({ id: "r1", routineId: "a", status: "completed" } as never);
  expect(frames).toEqual([{ kind: "panels.changed", panelId: made.panel.id, botId: "scout" }]);
});
