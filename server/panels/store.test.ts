import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PANEL_LIMITS } from "../../shared/panels.ts";
import type { WidgetRoot } from "../../shared/widget.ts";
import { createPanelStore, PANELS_FILE, panelsEnabled, readPanelsFile, type PanelsChange } from "./store.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function storeIn() {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-panels-store-"));
  dirs.push(dataDir);
  let tick = 0;
  const store = createPanelStore({ dataDir, now: () => new Date(Date.UTC(2026, 10, 25, 11, 0, tick++)) });
  const changes: PanelsChange[] = [];
  store.onChange((change) => changes.push(change));
  return { store, changes, file: join(dataDir, PANELS_FILE) };
}

const widget = (value: string): WidgetRoot => ({ id: "card", type: "Card", children: [{ id: "title", type: "Title", value }] });
const content = (value: string) => ({ widget: widget(value), text: value });
const author = { botId: "scout", threadId: "t1" };

function made<T>(result: { ok: true } & T | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("panels.json", () => {
  it("is on unless features.panels is false", () => {
    expect(panelsEnabled({})).toBe(true);
    expect(panelsEnabled({ features: {} })).toBe(true);
    expect(panelsEnabled({ features: { panels: false } })).toBe(false);
  });

  it("makes a panel once per key, takes the title, about and visibility sent again, and tells who listens", () => {
    const { store, changes } = storeIn();
    const first = made(store.create({ title: "Daily sales", key: "daily-sales", createdBy: author }));
    expect(first.created).toBe(true);
    expect(first.panel.id).toMatch(/^pnl_[a-z0-9]{16}$/);
    const again = made(store.create({ title: "Another title", key: "daily-sales", createdBy: { botId: "other" } }));
    expect(again).toMatchObject({ created: false, panel: { id: first.panel.id, title: "Another title", createdBy: author } });
    expect(store.list()).toHaveLength(1);
    expect(made(store.create({ title: "Another title", key: "daily-sales", visibility: "private", createdBy: author })).panel.visibility).toBe("private");
    expect(made(store.create({ title: "Another title", key: "daily-sales", visibility: "shared", createdBy: author })).panel.visibility).toBeUndefined();
    expect(changes).toHaveLength(4);
    expect(new Set(changes.map((one) => JSON.stringify(one)))).toEqual(new Set([JSON.stringify({ panelId: first.panel.id, botId: "scout" })]));
  });

  it("is written whole, readable only by its owner, and read again when changed on disk", () => {
    const { store, file } = storeIn();
    const { panel } = made(store.create({ title: "Daily sales", createdBy: author }));
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(file, ".."))).toEqual([PANELS_FILE]);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk).toMatchObject({ version: 1, panels: [{ id: panel.id, title: "Daily sales" }] });
    onDisk.panels[0].title = "Seeded by hand";
    onDisk.panels.push({ ...onDisk.panels[0], id: "pnl_seeded", title: "Second", updatedAt: "2030-01-01T00:00:00.000Z" });
    writeFileSync(file, `${JSON.stringify(onDisk)}\n`);
    expect(store.list().map((one) => one.title)).toEqual(["Second", "Seeded by hand"]);
  });

  it("leaves out a panel or card that does not parse and keeps fields a newer version added", () => {
    const { store, file } = storeIn();
    const { panel } = made(store.create({ title: "Daily sales", createdBy: author }));
    made(store.setCard(panel.id, { key: "revenue", title: "Revenue", content: content("$4,210"), botId: "scout" }));
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    onDisk.panels[0].cards.push({ id: "crd_bad", title: "", size: "xl" });
    onDisk.panels[0].lane = "top";
    onDisk.panels.push({ id: "pnl_bad" });
    writeFileSync(file, JSON.stringify(onDisk));
    const read = readPanelsFile(file);
    expect(read.writable).toBe(true);
    expect(read.panels).toHaveLength(1);
    expect(read.panels[0]).toMatchObject({ lane: "top", cards: [{ key: "revenue" }] });
  });

  it("masks a failure's reason saved before failures were masked when it reads the file", () => {
    const { store, file } = storeIn();
    const { panel } = made(store.create({ title: "Daily sales", createdBy: author }));
    made(store.setCard(panel.id, { key: "revenue", title: "Revenue", content: content("$4,210"), botId: "scout" }));
    const key = "sk-ant-api03-" + "f".repeat(40);
    const bearer = "Bearer " + "eyJhbGciOiJIUzI1NiJ9." + "g".repeat(40);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    Object.assign(onDisk.panels[0].cards[0], { status: "failed", failure: `Shopify refused ${key}, ${bearer}`, failedAt: onDisk.panels[0].cards[0].updatedAt });
    writeFileSync(file, JSON.stringify(onDisk));
    const read = JSON.stringify(readPanelsFile(file));
    expect(read).toContain("Shopify refused");
    expect(read).not.toContain(key);
    expect(read).not.toContain("g".repeat(40));
  });

  it("never writes over a file it cannot read whole", () => {
    const { store, file } = storeIn();
    for (const text of ["{not json", JSON.stringify({ version: 2, panels: [] })]) {
      writeFileSync(file, text);
      expect(store.list()).toEqual([]);
      const refused = store.create({ title: "Daily sales", createdBy: author });
      expect(refused).toMatchObject({ ok: false, status: 409 });
      expect(readFileSync(file, "utf8")).toBe(text);
    }
  });

  it("sets a card, replaces it by key in place, and keeps its last content when an update fails", () => {
    const { store } = storeIn();
    const { panel } = made(store.create({ title: "Daily sales", createdBy: author }));
    const set = made(store.setCard(panel.id, { key: "revenue", title: "Revenue", size: "m", content: content("$4,210"), botId: "scout" }));
    expect(set).toMatchObject({ created: true, card: { status: "ok", size: "m", position: 0, text: "$4,210" } });
    made(store.setCard(panel.id, { key: "roas", title: "ROAS", content: content("3.1"), botId: "scout" }));
    const replaced = made(store.setCard(panel.id, { key: "revenue", title: "Revenue yesterday", content: content("$5,000"), botId: "ads" }));
    expect(replaced).toMatchObject({ created: false, card: { id: set.card.id, size: "m", position: 0, botId: "ads", text: "$5,000" } });
    expect(store.get(panel.id)!.cards.map((card) => card.key)).toEqual(["revenue", "roas"]);

    const failed = made(store.updateCard(panel.id, { key: "revenue" }, { failed: "Shopify did not answer.", botId: "scout" }));
    expect(failed.card).toMatchObject({ status: "failed", failure: "Shopify did not answer.", text: "$5,000", widget: widget("$5,000") });
    expect(failed.card.failedAt).toBeDefined();
    const fixed = made(store.updateCard(panel.id, { cardId: set.card.id }, { content: content("$6,000"), botId: "scout" }));
    expect(fixed.card).toMatchObject({ status: "ok", text: "$6,000" });
    expect(fixed.card.failure).toBeUndefined();
    expect(fixed.card.failedAt).toBeUndefined();
    expect(store.get(panel.id)!.updatedAt).toBe(fixed.card.updatedAt);
  });

  it("refuses with a sentence that teaches: unknown panel or card, too many, too big", () => {
    const { store } = storeIn();
    expect(store.setCard("pnl_nope", { title: "x", botId: "scout" })).toMatchObject({ ok: false, status: 404, error: expect.stringContaining("list_panels") });
    const { panel } = made(store.create({ title: "Daily sales", createdBy: author }));
    expect(store.updateCard(panel.id, { key: "nope" }, { title: "x", botId: "scout" })).toMatchObject({ ok: false, status: 404, error: expect.stringContaining(`{"panel_id":"${panel.id}"}`) });
    for (let index = 0; index < PANEL_LIMITS.cardsPerPanel; index += 1) made(store.setCard(panel.id, { title: `Card ${index}`, botId: "scout" }));
    expect(store.setCard(panel.id, { title: "One more", botId: "scout" })).toMatchObject({ ok: false, status: 409 });
    const { panel: other } = made(store.create({ title: "Other", createdBy: author }));
    const huge = { widget: widget("x".repeat(PANEL_LIMITS.cardBytes)), text: "x" };
    expect(store.setCard(other.id, { title: "Huge", content: huge, botId: "scout" })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("KB") });
    expect(store.get(other.id)!.cards).toEqual([]);
  });

  it("removes and puts back panels and cards under their own ids", () => {
    const { store, changes } = storeIn();
    const { panel } = made(store.create({ title: "Daily sales", key: "daily-sales", createdBy: author }));
    const first = made(store.setCard(panel.id, { key: "revenue", title: "Revenue", content: content("$1"), botId: "scout" })).card;
    made(store.setCard(panel.id, { key: "roas", title: "ROAS", botId: "scout" }));
    const removedCard = made(store.removeCard(panel.id, first.id)).card;
    expect(made(store.restoreCard(panel.id, removedCard)).panel.cards.map((card) => card.id)).toEqual([first.id, expect.any(String)]);
    expect(store.restoreCard(panel.id, removedCard)).toMatchObject({ ok: false, status: 409 });

    const removed = made(store.remove(panel.id)).panel;
    expect(changes.at(-1)).toEqual({ panelId: panel.id, botId: "scout", removed: true });
    expect(store.list()).toEqual([]);
    expect(made(store.restore(removed)).panel).toEqual(removed);
    expect(store.get(panel.id)).toEqual(removed);
    expect(store.restore(removed)).toMatchObject({ ok: false, status: 409 });
  });

  it("renames a panel, clears its about, and resizes a card without touching its content", () => {
    const { store } = storeIn();
    const { panel } = made(store.create({ title: "Daily sales", about: "Shopify", createdBy: author }));
    const card = made(store.setCard(panel.id, { title: "Revenue", content: content("$1"), botId: "scout" })).card;
    expect(made(store.patch(panel.id, { title: "Sales", about: "" })).panel).toMatchObject({ title: "Sales" });
    expect(store.get(panel.id)!.about).toBeUndefined();
    const patched = made(store.patchCard(panel.id, card.id, { size: "l" })).card;
    expect(patched).toEqual({ ...card, size: "l" });
  });
});

describe("cards beyond one panel", () => {
  it("keeps a private panel's visibility, and drops the field when it is shared again", () => {
    const { store, file } = storeIn();
    const panel = made(store.create({ title: "Mine", visibility: "private", createdBy: author })).panel;
    expect(store.get(panel.id)!.visibility).toBe("private");
    made(store.patch(panel.id, { visibility: "shared" }));
    expect(store.get(panel.id)!.visibility).toBeUndefined();
    expect(readFileSync(file, "utf8")).not.toContain("visibility");
  });

  it("orders the cards the person sends, keeps drafts after them, and teaches what is wrong", () => {
    const { store } = storeIn();
    const panel = made(store.create({ title: "Sales", createdBy: author })).panel;
    const [a, b, c] = ["a", "b", "c"].map((key) => made(store.setCard(panel.id, { key, title: key, content: content(key), botId: "scout" })).card);
    const draft = made(store.setCard(panel.id, { key: "d", title: "d", botId: "scout", extra: { draft: true, draftAt: new Date().toISOString(), building: true } })).card;
    const ordered = made(store.order(panel.id, [c!.id, a!.id, b!.id])).panel;
    expect(ordered.cards.map((card) => card.key)).toEqual(["c", "a", "b", "d"]);
    expect(ordered.cards.map((card) => card.position)).toEqual([0, 1, 2, 3]);
    expect(store.order(panel.id, [c!.id, a!.id])).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("every card") });
    expect(store.order(panel.id, [c!.id, c!.id, a!.id, b!.id])).toMatchObject({ ok: false, status: 400 });
    expect(store.order(panel.id, [c!.id, a!.id, b!.id, "card_nope"])).toMatchObject({ ok: false, status: 400 });
    expect(store.order(panel.id, [draft.id, c!.id, a!.id, b!.id]).ok).toBe(true);
  });

  it("moves a card to another panel under a free key, and tells both panels", () => {
    const { store, changes } = storeIn();
    const one = made(store.create({ title: "One", createdBy: author })).panel;
    const two = made(store.create({ title: "Two", createdBy: author })).panel;
    const card = made(store.setCard(one.id, { key: "revenue", title: "Revenue", content: content("$1"), botId: "scout", extra: { draft: true, draftAt: new Date().toISOString() } })).card;
    made(store.setCard(two.id, { key: "revenue", title: "Revenue", content: content("$2"), botId: "scout" }));
    changes.splice(0);
    const moved = made(store.moveCard(one.id, card.id, two.id, { draft: null, draftAt: null }));
    expect(moved.card).toMatchObject({ id: card.id, key: "revenue-2" });
    expect(moved.card.draft).toBeUndefined();
    expect(store.get(one.id)!.cards).toEqual([]);
    expect(store.get(two.id)!.cards.map((one) => one.key)).toEqual(["revenue", "revenue-2"]);
    expect(changes.map((change) => change.panelId).sort()).toEqual([one.id, two.id].sort());
  });

  it("writes tests apart from a panel's cards, reads them back as drafts, and keeps one in place only with room", () => {
    const { store, file } = storeIn();
    const panel = made(store.create({ title: "Sales", createdBy: author })).panel;
    made(store.setCard(panel.id, { key: "test", title: "Test", botId: "scout", extra: { draft: true, draftAt: "2026-11-25T10:30:00.000Z" } }));
    made(store.setCard(panel.id, { key: "kept", title: "Kept", content: content("1"), botId: "scout" }));
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk.panels[0].cards.map((card: { key: string }) => card.key)).toEqual(["kept"]);
    expect(onDisk.drafts).toEqual([{ panelId: panel.id, card: expect.objectContaining({ key: "test", draft: true }) }]);
    expect(readPanelsFile(file).panels[0]!.cards.map((card) => [card.key, card.draft ?? false])).toEqual([["kept", false], ["test", true]]);
    for (let more = 1; more < PANEL_LIMITS.cardsPerPanel; more++) made(store.setCard(panel.id, { key: `c${more}`, title: `C${more}`, content: content("1"), botId: "scout" }));
    const test = store.get(panel.id)!.cards.find((card) => card.draft)!;
    expect(store.keepDraft(panel.id, test.id)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("Remove one first") });
    made(store.removeCard(panel.id, store.get(panel.id)!.cards.find((card) => card.key === "c1")!.id));
    expect(made(store.keepDraft(panel.id, test.id)).card.draft).toBeUndefined();
    expect(JSON.parse(readFileSync(file, "utf8")).drafts).toBeUndefined();
  });

  it("sweeps only drafts made before the cutoff", () => {
    const { store } = storeIn();
    const panel = made(store.create({ title: "Sales", createdBy: author })).panel;
    made(store.setCard(panel.id, { key: "old", title: "Old", botId: "scout", extra: { draft: true, draftAt: "2026-11-25T08:00:00.000Z" } }));
    made(store.setCard(panel.id, { key: "new", title: "New", botId: "scout", extra: { draft: true, draftAt: "2026-11-25T10:30:00.000Z" } }));
    made(store.setCard(panel.id, { key: "kept", title: "Kept", content: content("1"), botId: "scout" }));
    const gone = store.sweepDrafts(Date.parse("2026-11-25T10:00:00.000Z"));
    expect(gone.map((one) => one.card.key)).toEqual(["old"]);
    expect(store.get(panel.id)!.cards.map((card) => card.key)).toEqual(["new", "kept"]);
    expect(store.sweepDrafts(Date.parse("2026-11-25T10:00:00.000Z"))).toEqual([]);
  });

  it("keeps a card's content when it is set again with only a prompt", () => {
    const { store } = storeIn();
    const panel = made(store.create({ title: "Sales", createdBy: author })).panel;
    made(store.setCard(panel.id, { key: "revenue", title: "Revenue", content: content("$1"), botId: "scout" }));
    const again = made(store.setCard(panel.id, { key: "revenue", title: "Revenue", botId: "scout", extra: { prompt: "Revenue", schedule: "hour" } }));
    expect(again.card).toMatchObject({ text: "$1", prompt: "Revenue", schedule: "hour" });
    expect(again.previous?.text).toBe("$1");
  });
});
