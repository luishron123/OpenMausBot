import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Routine, RoutineInput, RoutineRun } from "../routines.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { createPanelAutomations, PANEL_LINK_PATH, type PanelRoutines } from "./automations.ts";
import { createPanelStore } from "./store.ts";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const auth = { kind: "session", scopes: ["chat"] } as unknown as RequestAuth;

function routine(id: string, extra: Partial<Routine> = {}): Routine {
  return { id, name: `Routine ${id}`, prompt: "Count.", target: "bot", botId: "scout", runOn: "maus", enabled: true, nextRunAt: T0 + 86_400_000, ...extra } as Routine;
}

/** Routines held in memory; update keeps what sanitizeInput would for these two fields. */
function fakeRoutines(routines: Routine[], runs: RoutineRun[] = []) {
  const started: string[] = [];
  const manager: PanelRoutines = {
    listRoutines: () => routines,
    listRuns: () => runs,
    update: (id: string, patch: Partial<RoutineInput>) => {
      const found = routines.find((one) => one.id === id);
      if (!found) return null;
      if (patch.panelId) found.panelId = patch.panelId; else delete found.panelId;
      if (patch.cardKey && patch.panelId) found.cardKey = patch.cardKey; else delete found.cardKey;
      return found;
    },
    runNow: (id: string) => {
      if (id === "busy") return null;
      started.push(id);
      return { id: `run-${id}`, routineId: id } as RoutineRun;
    },
  } as PanelRoutines;
  return { manager, started };
}

function setup(routines: Routine[], runs: RoutineRun[] = [], enabled = true, turnSees?: (caller: { botId: string }, panel: { createdBy: { botId: string } }, need?: "see" | "change") => boolean) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-panels-auto-"));
  dirs.push(dataDir);
  let tick = 0;
  const store = createPanelStore({ dataDir, now: () => new Date(T0 + 60_000 * tick++) });
  const made = store.create({ title: "Daily sales", key: "daily-sales", createdBy: { botId: "scout" } });
  if (!made.ok) throw new Error(made.error);
  const fake = fakeRoutines(routines, runs);
  const personal: string[] = [];
  const automations = createPanelAutomations({
    store, enabled: () => enabled, routines: () => fake.manager,
    sees: (_auth, botId) => botId !== "hidden", personStarted: (_auth, run) => personal.push(run.id), ...(turnSees ? { turnSees } : {}),
  });
  return { store, panel: made.panel, automations, started: fake.started, personal };
}

it("lists the automations that keep a panel, with their last run and whether it updated nothing", () => {
  const runs = [
    { id: "r3", routineId: "a", status: "running", startedAt: T0 + 3_600_000 },
    { id: "r2", routineId: "a", status: "completed", startedAt: T0 + 600_000, finishedAt: T0 + 900_000, threadId: "th-2" },
    { id: "r1", routineId: "b", status: "completed", startedAt: T0 - 600_000, finishedAt: T0 - 300_000, threadId: "th-1" },
  ] as RoutineRun[];
  const routines = [routine("a"), routine("b", { cardKey: "revenue" }), routine("c"), routine("d", { botId: "hidden" })];
  const { store, panel, automations } = setup(routines, runs);
  expect(automations.list(auth, panel)).toEqual([]);
  for (const one of [routines[0]!, routines[1]!, routines[3]!]) one.panelId = panel.id;
  // The card was set at T0 + 1 min: after b's last run started, before a's.
  const set = store.setCard(panel.id, { key: "revenue", title: "Revenue", botId: "scout" });
  if (!set.ok) throw new Error(set.error);
  expect(automations.list(auth, store.get(panel.id)!)).toEqual([
    { routineId: "a", name: "Routine a", botId: "scout", enabled: true, nextRunAt: new Date(T0 + 86_400_000).toISOString(), lastRunAt: new Date(T0 + 600_000).toISOString(), lastRunThreadId: "th-2", running: true, lastRunUpdatedNothing: true, cadence: "custom" },
    { routineId: "b", name: "Routine b", botId: "scout", enabled: true, nextRunAt: new Date(T0 + 86_400_000).toISOString(), lastRunAt: new Date(T0 - 600_000).toISOString(), lastRunThreadId: "th-1", running: false, lastRunUpdatedNothing: false, cardKey: "revenue", cadence: "custom" },
  ]);
});

it("runs the linked automations now, tells who started them, and answers 404 or 409 when it cannot", () => {
  const routines: Routine[] = [];
  const { panel, automations, started, personal } = setup(routines);
  expect(automations.refresh(auth, panel)).toEqual({ ok: false, status: 404, error: "No automation keeps this panel." });
  routines.push(routine("a", { panelId: panel.id }), routine("busy", { panelId: panel.id }), routine("d", { panelId: panel.id, botId: "hidden" }));
  expect(automations.refresh(auth, panel)).toEqual({ ok: true });
  expect(started).toEqual(["a"]);
  expect(personal).toEqual(["run-a"]);
  expect(automations.refresh(auth, panel, "busy")).toMatchObject({ ok: false, status: 409 });
  expect(automations.refresh(auth, panel, "d")).toMatchObject({ ok: false, status: 404 });
});

it("writes the run note for a linked routine only", () => {
  const { store, panel, automations } = setup([]);
  const set = store.setCard(panel.id, { key: "revenue", title: "Revenue", botId: "scout" });
  if (!set.ok) throw new Error(set.error);
  expect(automations.runNote(undefined)).toBeNull();
  expect(automations.runNote(routine("a"))).toBeNull();
  const note = automations.runNote(routine("a", { panelId: panel.id, cardKey: "revenue" }))!;
  expect(note).toContain(`keeps panel "Daily sales" (panel_id ${panel.id})`);
  expect(note).toContain('"Revenue" (card_key revenue)');
  expect(note).toContain("update_panel_widget failed");
  expect(note).toContain("Do not repeat the report in chat.");
  expect(automations.runNote(routine("a", { panelId: "pnl_gone" }))).toContain("was removed. Report in chat");
  const off = setup([], [], false);
  expect(off.automations.runNote(routine("a", { panelId: off.panel.id }))).toBeNull();
});

it("links a bot's own routine to a panel by id or key, unlinks it, and refuses others' routines", async () => {
  const routines = [routine("mine"), routine("theirs", { botId: "other" })];
  const { panel, automations } = setup(routines);
  const route = automations.linkRoute({ botId: "scout", threadId: "t1" });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { passed: true });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const post = async (body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${PANEL_LINK_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, string> };
  };
  expect(await post({ panel_id: "daily-sales" })).toMatchObject({ status: 200 });
  expect((await post({ panel_id: "nope" })).body.error).toContain("list_panels");
  expect((await post({ panel_id: "daily-sales", card_key: "Bad Key" })).status).toBe(400);
  expect(await post({ panel_id: "daily-sales", card_key: "revenue", routine_id: "mine" })).toMatchObject({ status: 200, body: { text: expect.stringContaining(panel.id) } });
  expect(routines[0]).toMatchObject({ panelId: panel.id, cardKey: "revenue" });
  expect((await post({ panel_id: "daily-sales", routine_id: "theirs" })).status).toBe(404);
  expect(routines[1]!.panelId).toBeUndefined();
  expect(await post({ panel_id: "", routine_id: "mine" })).toMatchObject({ status: 200, body: { text: expect.stringContaining("no longer keeps a panel") } });
  expect(routines[0]!.panelId).toBeUndefined();
});

it("names a linked routine's panel once its run has ended, and nothing while it runs or for another routine", () => {
  const routines = [routine("a"), routine("b")];
  const { panel, automations } = setup(routines);
  routines[0]!.panelId = panel.id;
  const run = (routineId: string, status: string) => ({ id: `r-${routineId}`, routineId, status }) as RoutineRun;
  for (const status of ["queued", "running", "waiting"]) expect(automations.runEnded(run("a", status))).toBeNull();
  for (const status of ["completed", "failed", "skipped"]) expect(automations.runEnded(run("a", status))).toEqual({ panelId: panel.id, botId: "scout" });
  expect(automations.runEnded(run("b", "completed"))).toBeNull();
  expect(automations.runEnded(run("gone", "completed"))).toBeNull();
  routines[0]!.panelId = "pnl_removed";
  expect(automations.runEnded(run("a", "completed"))).toBeNull();
  const off = setup([routine("a")], [], false);
  expect(off.automations.runEnded(run("a", "completed"))).toBeNull();
});

it("will not link a routine to a panel this turn may not see", async () => {
  const routines = [routine("mine", { botId: "rival" })];
  const { automations } = setup(routines, [], true, (caller, panel) => panel.createdBy.botId === caller.botId);
  const route = automations.linkRoute({ botId: "rival", threadId: "t2" });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { passed: true });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${PANEL_LINK_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ panel_id: "daily-sales", routine_id: "mine" }) });
  expect(res.status).toBe(404);
  expect(((await res.json()) as { error: string }).error).toContain("No panel daily-sales");
  expect(routines[0]!.panelId).toBeUndefined();
});

it("will not link a routine to a panel this turn may only see", async () => {
  const routines = [routine("mine", { botId: "rival" })];
  const { automations } = setup(routines, [], true, (caller, panel, need) => need !== "change" || panel.createdBy.botId === caller.botId);
  const route = automations.linkRoute({ botId: "rival", threadId: "t2" });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { passed: true });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const link = (body: unknown) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${PANEL_LINK_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const body of [{ panel_id: "daily-sales", routine_id: "mine" }, { panel_id: "daily-sales" }]) {
    const res = await link(body);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("can be read from this conversation but not changed");
  }
  expect(routines[0]!.panelId).toBeUndefined();
});
