import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { PANEL_LIMITS } from "../../shared/panels.ts";
import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Routine, RoutineInput, RoutineRun } from "../routines.ts";
import { dispatchRoutes } from "../routes/table.ts";
import type { PanelRoutines } from "./automations.ts";
import { ALREADY_UPDATED, FAILURES_TO_PAUSE, NO_UPDATE_FAILURE, PAUSED_FAILURE, routineSchedule, scheduleOf } from "./cards.ts";
import type { PanelChats, PinnableMessage } from "./pinnable.ts";
import { createPanels } from "./wiring.ts";

const servers: Server[] = [];
const dirs: string[] = [];
const closers: Array<() => void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const levels: Record<string, BotAccessLevel> = { scout: "chat", viewer: "view", hidden: "none" };

/** The routine manager's part panels use, in memory: every run starts at once, in its own thread. */
function fakeRoutines() {
  const routines: Routine[] = [];
  const runs: RoutineRun[] = [];
  let next = 0;
  const manager: PanelRoutines = {
    listRoutines: () => routines,
    listRuns: () => runs,
    create: (input: RoutineInput) => {
      const routine = { id: `rtn-${++next}`, runOn: "maus", target: "bot", ...input, enabled: input.enabled ?? true } as unknown as Routine;
      routines.push(routine);
      return routine;
    },
    update: (id: string, patch: Partial<RoutineInput>) => {
      const found = routines.find((one) => one.id === id);
      if (!found) return null;
      Object.assign(found, patch);
      if (patch.enabled !== undefined) delete found.heldFor;
      return found;
    },
    remove: (id: string) => {
      const at = routines.findIndex((one) => one.id === id);
      if (at < 0) return false;
      routines.splice(at, 1);
      return true;
    },
    runNow: (id: string) => {
      const routine = routines.find((one) => one.id === id);
      if (!routine) return null;
      const run = { id: `run-${++next}`, routineId: id, botId: routine.botId, status: "running", threadId: `thread-${next}`, scheduledFor: Date.now() } as unknown as RoutineRun;
      runs.unshift(run);
      return run;
    },
  } as unknown as PanelRoutines;
  return { manager, routines, runs };
}

async function serve(options: { messages?: Record<string, PinnableMessage[]> } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-panels-cards-"));
  dirs.push(dataDir);
  const fake = fakeRoutines();
  const notices: Array<{ botId: string; text: string }> = [];
  const started: string[] = [];
  const messages = options.messages ?? {};
  const chats: PanelChats = {
    bots: () => [{ id: "scout", threadId: "chat-scout" }, { id: "hidden", threadId: "chat-hidden" }],
    visible: (_auth, threadId) => threadId !== "chat-hidden",
    messages: (threadId) => messages[threadId] ?? [],
  };
  const panels = createPanels({
    dataDir, enabled: () => true, levelOf: (_auth, botId) => levels[botId] ?? "none", broadcast: () => {},
    routines: () => fake.manager, personStarted: (_auth, run) => started.push(run.id), timeZone: () => "America/Sao_Paulo",
    notice: (botId, text) => notices.push({ botId, text }), chats,
    bot: (botId) => (botId === "scout" ? { name: "Scout", title: "Sales analyst", description: "Watches the Shopify store. Reports daily." } : null),
  });
  closers.push(panels.close);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const thread = req.headers["x-thread"];
    const auth = { kind: thread ? "internal" : "session", scopes: thread ? [] : ["chat"] } as unknown as RequestAuth;
    const routes = thread ? [panels.toolRoutes({ botId: String(req.headers["x-bot"] ?? "scout"), threadId: String(thread) })] : [panels.routes];
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { passed: true });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...headers } });
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  const api = (path: string, method = "GET", body?: unknown) => call(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  /** A panel tool as a bot's turn in `threadId` calls it. */
  const tool = (route: string, body: unknown, threadId = "chat-scout", botId = "scout") =>
    call(`/api/internal/panels/${route}`, { method: "POST", body: JSON.stringify(body) }, { "x-thread": threadId, "x-bot": botId });
  /** Ends a run the way the routine manager reports it. */
  const end = (run: RoutineRun, status: RoutineRun["status"] = "completed", cost?: number) => {
    run.status = status;
    run.finishedAt = Date.now();
    if (cost !== undefined) run.cost = cost;
    panels.runChanged(run);
  };
  return { api, tool, end, store: panels.store, panels, ...fake, notices, started };
}

const widget = (value: string) => ({ type: "Card", children: [{ type: "Title", value }] });

async function salesPanel(harness: Awaited<ReturnType<typeof serve>>) {
  const made = await harness.tool("create", { title: "Daily sales", key: "daily-sales" });
  expect(made.status).toBe(200);
  return made.body.panelId as string;
}

it("maps each card schedule to a routine schedule in the person's time zone, and reads it back", () => {
  const now = Date.UTC(2026, 10, 25, 12);
  expect(routineSchedule("half", "America/Sao_Paulo", now)).toEqual({ type: "interval", everyMinutes: 30, anchorAt: now });
  expect(routineSchedule("hour", "America/Sao_Paulo", now)).toEqual({ type: "interval", everyMinutes: 60, anchorAt: now });
  expect(routineSchedule("day", "America/Sao_Paulo", now)).toEqual({ type: "cron", expression: "0 8 * * *", timeZone: "America/Sao_Paulo" });
  expect(routineSchedule("week", "America/Sao_Paulo", now)).toEqual({ type: "cron", expression: "0 8 * * 1", timeZone: "America/Sao_Paulo" });
  expect(routineSchedule("manual", "America/Sao_Paulo", now)).toEqual({ type: "once", at: now });
  for (const schedule of ["half", "hour", "day", "week"] as const) {
    expect(scheduleOf({ schedule: routineSchedule(schedule, "UTC", now) as Routine["schedule"], enabled: true })).toBe(schedule);
  }
  expect(scheduleOf({ schedule: { type: "once", at: now } as Routine["schedule"], enabled: false })).toBe("manual");
  expect(scheduleOf({ schedule: { type: "interval", everyMinutes: 15 } as Routine["schedule"], enabled: true })).toBeNull();
  expect(scheduleOf({ enabled: true } as Pick<Routine, "schedule" | "enabled">)).toBeNull();
});

it("gives a card with a prompt and schedule its own routine, builds it now without a widget, and removes the routine with the prompt", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  const set = await harness.tool("set-card", { panel_id: "daily-sales", title: "Revenue", prompt: "Today's revenue from Shopify", schedule: "day", alert: "below $1,000", sources: ["Shopify"] });
  expect(set.status).toBe(200);
  expect(set.body.text).toContain('on schedule "day"; the first run has started');
  const card = harness.store.get(panelId)!.cards[0]!;
  expect(card).toMatchObject({ key: "revenue", prompt: "Today's revenue from Shopify", schedule: "day", alert: "below $1,000", sources: ["Shopify"], building: true });
  expect(harness.routines).toHaveLength(1);
  expect(harness.routines[0]).toMatchObject({
    id: card.routineId, name: "Panel card: Revenue", botId: "scout", panelId, cardKey: "revenue", enabled: true,
    schedule: { type: "cron", expression: "0 8 * * *", timeZone: "America/Sao_Paulo" },
  });
  expect(harness.routines[0]!.prompt).toContain('card_key "revenue"');
  expect(harness.runs).toHaveLength(1);

  const manual = await harness.tool("update-card", { panel_id: "daily-sales", card_key: "revenue", schedule: "manual" });
  expect(manual.status).toBe(200);
  expect(harness.routines[0]).toMatchObject({ enabled: false, schedule: { type: "once" } });

  const off = await harness.api(`/api/panels/${panelId}/cards/${card.id}`, "PATCH", { prompt: "" });
  expect(off.status).toBe(200);
  expect(harness.routines).toEqual([]);
  expect(harness.store.get(panelId)!.cards[0]!.routineId).toBeUndefined();
});

it("refuses a schedule without a prompt, and content without widget or prompt, with the fix", async () => {
  const harness = await serve();
  await salesPanel(harness);
  const neither = await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue" });
  expect(neither.status).toBe(400);
  expect(neither.body.error).toContain('"widget":');
  expect(neither.body.error).toContain('"prompt":');
  const bare = await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: widget("$1"), schedule: "hour" });
  expect(bare.status).toBe(400);
  expect(bare.body.error).toContain("schedule needs prompt");
});

it(`stops at ${PANEL_LIMITS.scheduledCards} cards that update by themselves, and still takes manual ones`, async () => {
  const harness = await serve();
  for (let panel = 0; panel < 3; panel++) {
    const made = harness.store.create({ title: `P${panel}`, createdBy: { botId: "scout" } });
    if (!made.ok) throw new Error(made.error);
    for (let card = 0; card < 20; card++) {
      const set = harness.store.setCard(made.panel.id, { key: `c${card}`, title: `C${card}`, botId: "scout", content: { widget: widget("1") as never, text: "1" }, extra: { prompt: "x", schedule: "week" } });
      if (!set.ok) throw new Error(set.error);
    }
  }
  await salesPanel(harness);
  const over = await harness.tool("set-card", { panel_id: "daily-sales", card_key: "one-more", title: "One more", prompt: "Orders", schedule: "hour" });
  expect(over.status).toBe(409);
  expect(over.body.error).toContain('Use schedule "manual"');
  const manual = await harness.tool("set-card", { panel_id: "daily-sales", card_key: "one-more", title: "One more", prompt: "Orders", schedule: "manual" });
  expect(manual.status).toBe(200);
  const panelId = harness.store.byKey("daily-sales")!.id;
  expect((await harness.api(`/api/panels/${panelId}/cards/new`, "POST", { prompt: "Refunds", format: "kpi", size: "s", botId: "scout", schedule: "hour", notify: false, test: false })).status).toBe(409);
});

it("lets a card's own run update only its card, once, and refuses every other panel tool", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "orders", title: "Orders", widget: widget("12") });
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", prompt: "Today's revenue", schedule: "hour" });
  const run = harness.runs[0]!;
  const asRun = (route: string, body: unknown) => harness.tool(route, body, run.threadId!);

  for (const [route, body] of [["list", {}], ["create", { title: "Other" }], ["set-card", { panel_id: "daily-sales", title: "X", widget: widget("1") }], ["link", { panel_id: "daily-sales" }]] as const) {
    const refused = await asRun(route, body);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toContain('card_key "revenue"');
  }
  const other = await asRun("update-card", { panel_id: "daily-sales", card_key: "orders", widget: widget("13") });
  expect(other.status).toBe(403);
  const done = await asRun("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("$4,210"), summary: "Up 3%" });
  expect(done.status).toBe(200);
  expect(done.body.text).toContain("this run's one update");
  const again = await asRun("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("$4,300") });
  expect(again).toMatchObject({ status: 409, body: { error: ALREADY_UPDATED } });

  const card = harness.store.get(panelId)!.cards.find((one) => one.key === "revenue")!;
  expect(card.building).toBeUndefined();
  harness.end(run, "completed", 0.0123);
  const history = await harness.api(`/api/panels/${panelId}/cards/${card.id}/history`);
  expect(history.body.updates).toHaveLength(1);
  expect(history.body.updates[0]).toMatchObject({ status: "ok", summary: "Up 3%", runId: run.id, threadId: run.threadId, costUsd: 0.0123 });
  expect(harness.store.get(panelId)!.cards.find((one) => one.key === "revenue")!.status).toBe("ok");
});

it("fails a card whose own run ended without an update, and pauses its routine after five in a row", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: widget("$1"), prompt: "Revenue", schedule: "hour" });
  const routine = harness.routines[0]!;
  const card = () => harness.store.get(panelId)!.cards[0]!;
  expect(harness.runs).toEqual([]);

  const cancelled = harness.manager.runNow(routine.id)!;
  harness.end(cancelled, "cancelled");
  expect(card().status).toBe("ok");

  for (let failure = 1; failure < FAILURES_TO_PAUSE; failure++) {
    harness.end(harness.manager.runNow(routine.id)!, "completed");
    expect(card()).toMatchObject({ status: "failed", failure: NO_UPDATE_FAILURE, text: "$1" });
    expect(routine.enabled).toBe(true);
  }
  harness.end(harness.manager.runNow(routine.id)!, "failed");
  expect(routine.enabled).toBe(false);
  expect(card()).toMatchObject({ status: "failed", failure: PAUSED_FAILURE });

  const resolved = await harness.api(`/api/panels/${panelId}/cards/${card().id}/resolve`, "POST", {});
  expect(resolved.status).toBe(202);
  expect(routine.enabled).toBe(true);
  expect(harness.started).toEqual([harness.runs[0]!.id]);
});

it("tells the person about an alert and, when they asked, a changed card; clears the alert", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: widget("$1") });
  const cardId = harness.store.get(panelId)!.cards[0]!.id;
  await harness.tool("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("$2") });
  expect(harness.notices).toEqual([]);
  await harness.api(`/api/panels/${panelId}/cards/${cardId}`, "PATCH", { notify: true });
  await harness.tool("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("$2") });
  expect(harness.notices).toEqual([]);
  await harness.tool("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("$3"), summary: "Up $1" });
  expect(harness.notices).toEqual([{ botId: "scout", text: '"Revenue" on Daily sales changed: Up $1' }]);

  await harness.tool("update-card", { panel_id: "daily-sales", card_key: "revenue", alert: "Revenue is below $1,000." });
  expect(harness.notices[1]).toEqual({ botId: "scout", text: 'Alert on "Revenue" (Daily sales): Revenue is below $1,000.' });
  const alerts = await harness.api("/api/panels/alerts");
  expect(alerts.body.alerts).toEqual([expect.objectContaining({ panelId, cardId, cardTitle: "Revenue", text: "Revenue is below $1,000." })]);
  expect((await harness.api(`/api/panels/${panelId}/cards/${cardId}/alert/clear`, "POST", {})).status).toBe(200);
  expect((await harness.api("/api/panels/alerts")).body.alerts).toEqual([]);
});

it("keeps a routine a bot linked by panel_id and card_key working exactly as before", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: widget("$1") });
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "orders", title: "Orders", widget: widget("12") });
  expect(harness.routines).toEqual([]);
  const linked = harness.manager.create({ name: "Central report", prompt: "Update the central panel.", botId: "scout", schedule: { type: "interval", everyMinutes: 60 }, panelId, cardKey: "revenue" } as RoutineInput);
  const run = harness.manager.runNow(linked.id)!;

  const note = harness.panels.runNote(linked)!;
  expect(note).toContain(`keeps panel "Daily sales" (panel_id ${panelId})`);
  expect(note).toContain("Do not repeat the report in chat.");
  expect(note).not.toContain("update run for one panel card");

  const asRun = (route: string, body: unknown) => harness.tool(route, body, run.threadId!);
  expect((await asRun("list", {})).status).toBe(200);
  expect((await asRun("update-card", { panel_id: "daily-sales", card_key: "orders", widget: widget("13") })).status).toBe(200);
  expect((await asRun("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("$2") })).status).toBe(200);
  expect((await asRun("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("$3") })).status).toBe(200);
  expect((await asRun("set-card", { panel_id: "daily-sales", card_key: "new", title: "New", widget: widget("1") })).status).toBe(200);

  harness.end(run, "completed");
  const panel = harness.store.get(panelId)!;
  expect(panel.cards.find((card) => card.key === "revenue")).toMatchObject({ status: "ok", text: "$3" });
  expect(panel.cards.every((card) => card.routineId === undefined)).toBe(true);
  expect(harness.routines).toEqual([linked]);
  expect(linked).toMatchObject({ enabled: true, panelId, cardKey: "revenue", prompt: "Update the central panel." });

  const shown = await harness.api(`/api/panels/${panelId}`);
  expect(shown.body.panel.automations).toEqual([expect.objectContaining({ routineId: linked.id, cardKey: "revenue", cadence: "hourly" })]);
  expect((await harness.api(`/api/panels/${panelId}/cards/${panel.cards[0]!.id}/refresh`, "POST", {})).status).toBe(202);
  expect(harness.runs[0]!.routineId).toBe(linked.id);
});

it("hides a private panel from other bots' tools", async () => {
  const harness = await serve();
  await harness.tool("create", { title: "Mine", key: "mine", visibility: "private" });
  expect((await harness.tool("list", {}, "chat-other", "other")).body.text).toContain("no panels yet");
  expect((await harness.tool("list", { panel_id: "mine" }, "chat-other", "other")).status).toBe(404);
  expect((await harness.tool("list", {})).body.text).toContain('"Mine"');
});

it("orders a panel's cards for a person who can chat with its bot, and not for a viewer", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  for (const key of ["a", "b"]) await harness.tool("set-card", { panel_id: "daily-sales", card_key: key, title: key, widget: widget(key) });
  const [a, b] = harness.store.get(panelId)!.cards;
  const ordered = await harness.api(`/api/panels/${panelId}/order`, "POST", { cardIds: [b!.id, a!.id] });
  expect(ordered.status).toBe(200);
  expect(ordered.body.panel.cards.map((card: { key: string }) => card.key)).toEqual(["b", "a"]);
  expect((await harness.api(`/api/panels/${panelId}/order`, "POST", { cardIds: [b!.id] })).status).toBe(400);
  const watched = harness.store.create({ title: "Watched", createdBy: { botId: "viewer" } });
  if (!watched.ok) throw new Error(watched.error);
  expect((await harness.api(`/api/panels/${watched.panel.id}/order`, "POST", { cardIds: [] })).status).toBe(403);
});

it("makes a test draft from New widget, keeps it on another panel with its routine, and sweeps a draft left alone", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  const made = await harness.api(`/api/panels/${panelId}/cards/new`, "POST", { prompt: "Refunds this week", format: "kpi", size: "m", botId: "scout", schedule: "week", notify: true, test: true });
  expect(made.status).toBe(202);
  expect(made.body.card).toMatchObject({ title: "Refunds this week", key: "refunds-this-week", draft: true, building: true, format: "kpi", notify: true, schedule: "week" });
  expect(harness.routines[0]).toMatchObject({ id: made.body.routineId, enabled: false, panelId });
  expect(harness.started).toEqual([harness.runs[0]!.id]);
  expect((await harness.api(`/api/panels/${panelId}/cards/new`, "POST", { prompt: "x", format: "kpi", size: "m", botId: "hidden", schedule: "day", notify: false, test: false })).status).toBe(403);

  const other = await harness.tool("create", { title: "Weekly", key: "weekly" });
  const kept = await harness.api(`/api/panels/${panelId}/cards/${made.body.card.id}/keep`, "POST", { panelId: other.body.panelId });
  expect(kept.status).toBe(200);
  expect(kept.body.panel.cards[0]).toMatchObject({ id: made.body.card.id });
  expect(kept.body.panel.cards[0].draft).toBeUndefined();
  expect(harness.routines[0]).toMatchObject({ enabled: true, panelId: other.body.panelId, schedule: { type: "cron", expression: "0 8 * * 1" } });

  const draft = await harness.api(`/api/panels/${panelId}/cards/new`, "POST", { prompt: "Stock left", format: "auto", size: "s", botId: "scout", cadence: "daily", notify: false, test: true });
  expect(draft.status).toBe(202);
  expect(harness.routines).toHaveLength(2);
  const stale = harness.store.patchCard(panelId, draft.body.card.id, { extra: { draftAt: new Date(Date.now() - PANEL_LIMITS.draftMs - 1000).toISOString() } });
  expect(stale.ok).toBe(true);
  const read = await harness.api(`/api/panels/${panelId}`);
  expect(read.body.panel.cards).toEqual([]);
  expect(harness.routines).toHaveLength(1);
});

it("removes a draft's routine with it, and pauses a kept card's routines until Undo", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: widget("$1"), prompt: "Revenue", schedule: "hour" });
  const linked = harness.manager.create({ name: "Linked", prompt: "p", botId: "scout", schedule: { type: "interval", everyMinutes: 60 }, panelId, cardKey: "revenue" } as RoutineInput);
  const own = harness.routines[0]!;
  const card = harness.store.get(panelId)!.cards[0]!;
  const removed = await harness.api(`/api/panels/${panelId}/cards/${card.id}`, "DELETE");
  expect(removed.status).toBe(200);
  expect([own.enabled, linked.enabled]).toEqual([false, false]);
  expect((await harness.api(`/api/panels/${panelId}/cards/restore`, "POST", { card: removed.body.card })).status).toBe(200);
  expect([own.enabled, linked.enabled]).toEqual([true, true]);

  const draft = await harness.api(`/api/panels/${panelId}/cards/new`, "POST", { prompt: "Stock", format: "auto", size: "s", botId: "scout", schedule: "day", notify: false, test: true });
  await harness.api(`/api/panels/${panelId}/cards/${draft.body.card.id}`, "DELETE");
  expect(harness.routines.map((one) => one.id)).toEqual([own.id, linked.id]);
});

it("runs Refresh and Ask for a change on the card's routine, tells the run what was asked, and says when nothing keeps a card", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "plain", title: "Plain", widget: widget("1") });
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: widget("$1"), prompt: "Revenue", schedule: "day" });
  const [plain, revenue] = harness.store.get(panelId)!.cards;
  expect((await harness.api(`/api/panels/${panelId}/cards/${plain!.id}/refresh`, "POST", {})).status).toBe(404);
  expect((await harness.api(`/api/panels/${panelId}/cards/${revenue!.id}/refresh`, "POST", {})).status).toBe(202);
  expect((await harness.api(`/api/panels/${panelId}/cards/${revenue!.id}/change`, "POST", { text: "Show it in BRL" })).status).toBe(202);
  const own = harness.routines[0]!;
  const note = harness.panels.runNote(own)!;
  expect(note).toContain("update run for one panel card");
  expect(note).toContain('The person asked for this change: "Show it in BRL"');
  expect(harness.started).toHaveLength(2);
  const run = harness.runs[0]!;
  await harness.tool("update-card", { panel_id: "daily-sales", card_key: "revenue", widget: widget("R$5"), summary: "In BRL now" }, run.threadId!);
  expect((await harness.api(`/api/panels/${panelId}/cards/${revenue!.id}/history`)).body.updates[0]).toMatchObject({ change: "Show it in BRL", summary: "In BRL now" });
  expect(harness.panels.runNote(own)).not.toContain("asked for this change");
});

it("shows a card held while its routine waits on something outside the app", async () => {
  const harness = await serve();
  const panelId = await salesPanel(harness);
  await harness.tool("set-card", { panel_id: "daily-sales", card_key: "revenue", title: "Revenue", widget: widget("$1"), prompt: "Revenue", schedule: "day" });
  harness.routines[0]!.heldFor = "no_engine";
  expect((await harness.api(`/api/panels/${panelId}`)).body.panel.cards[0].held).toEqual({ reason: "no_engine" });
  expect(harness.store.get(panelId)!.cards[0]!.held).toBeUndefined();
});

it("lists and pins only widgets a bot showed in chats the person can see", async () => {
  const bot = (id: string, at: number, extra: Partial<PinnableMessage> = {}): PinnableMessage => ({ id, kind: "widget", role: "bot", at, text: `Sales ${id}\nmore`, widget: { root: { id: "c", type: "Card", children: [{ id: "t", type: "Title", value: id }] } as never }, ...extra });
  const harness = await serve({
    messages: {
      "chat-scout": [bot("m1", 1_000), bot("m2", 2_000), bot("server", 3_000, { serverCard: true }), { id: "text", kind: "text", role: "bot", at: 4_000, text: "hi" }],
      "chat-hidden": [bot("secret", 5_000)],
    },
  });
  const panelId = await salesPanel(harness);
  const listed = await harness.api("/api/panels/pinnable?limit=10");
  expect(listed.body.blocks.map((block: { messageId: string }) => block.messageId)).toEqual(["m2", "m1"]);
  expect(listed.body.blocks[0]).toMatchObject({ threadId: "chat-scout", botId: "scout", title: "Sales m2" });
  expect((await harness.api(`/api/panels/${panelId}/cards/pin`, "POST", { threadId: "chat-hidden", messageId: "secret" })).status).toBe(404);
  expect((await harness.api(`/api/panels/${panelId}/cards/pin`, "POST", { threadId: "chat-scout", messageId: "server" })).status).toBe(404);
  const pinned = await harness.api(`/api/panels/${panelId}/cards/pin`, "POST", { threadId: "chat-scout", messageId: "m1" });
  expect(pinned.status).toBe(200);
  expect(pinned.body.card).toMatchObject({ title: "Sales m1", size: "m", botId: "scout", pinnedFrom: { threadId: "chat-scout", messageId: "m1" } });
  expect(pinned.body.card.widget).toBeDefined();
});

it("estimates a schedule's daily cost from the bot's recent runs, and says when there is nothing to go on", async () => {
  const harness = await serve();
  expect((await harness.api("/api/panels/estimate?botId=scout&schedule=hour")).body).toEqual({ perDayUsd: null, basis: "none" });
  for (const cost of [0.01, 0.03]) harness.runs.push({ id: `r${cost}`, routineId: "x", botId: "scout", status: "completed", finishedAt: 1, cost } as unknown as RoutineRun);
  expect((await harness.api("/api/panels/estimate?botId=scout&schedule=hour")).body).toEqual({ perDayUsd: 0.48, basis: "recent-runs" });
  expect((await harness.api("/api/panels/estimate?botId=scout&schedule=manual")).body).toEqual({ perDayUsd: 0, basis: "recent-runs" });
  expect((await harness.api("/api/panels/estimate?botId=hidden&schedule=hour")).status).toBe(404);
  expect((await harness.api("/api/panels/estimate?botId=scout")).status).toBe(400);
});

it("suggests cards from the bot's automations first, then from what the bot is for, without asking any AI", async () => {
  const harness = await serve();
  harness.manager.create({ name: "Morning orders", prompt: "Count the orders since midnight. Then post.", botId: "scout", schedule: { type: "interval", everyMinutes: 30 } } as RoutineInput);
  const suggested = await harness.api("/api/panels/suggestions?botId=scout");
  expect(suggested.body.suggestions).toEqual([
    { title: "Morning orders", prompt: 'The latest result of "Morning orders": Count the orders since midnight', format: "auto", schedule: "half" },
    { title: "Today at a glance", prompt: "The one number that matters most today for Sales analyst, with the change from yesterday.", format: "kpi", schedule: "day" },
    { title: "Needs attention", prompt: "Open items that need attention now for Sales analyst, most urgent first, at most 5.", format: "checklist", schedule: "hour" },
  ]);
  expect((await harness.api("/api/panels/suggestions?botId=hidden")).status).toBe(404);
});
