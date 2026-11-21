import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));

(enabled ? it : it.skip)("shows two bots' conversation in a read-only dialog that follows the work live", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "omb-bot-conversation-ui-"));
  const planPath = join(temporary, "plan.json");
  writeFileSync(planPath, "{}");
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/control-omb.ts", "ui", "launch"], {
    cwd: ROOT, env: { ...process.env, FAKE_CLAUDE_ROOM_PLAN: planPath }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let error = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { error += String(chunk); });
  child.on("error", caught => { error += caught.message; });
  let info: { ui: string; url: string; botId: string; logPath: string };
  try {
    await expect.poll(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(error);
      try { info = JSON.parse(output); return Boolean(info.ui); } catch { return false; }
    }, { timeout: 180_000, interval: 250 }).toBe(true);
    const api = async (path: string, body?: unknown, method = "POST") => {
      const response = await fetch(info.url + path, body === undefined ? {} : {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result;
    };
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<any>;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result as unknown;
    const dialog = () => evaluate(`document.querySelector("[data-bot-conversation]")?.textContent ?? ""`) as Promise<string>;
    const click = async (name: string, role = "button") => {
      const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
      const match = Object.entries(refs).find(([, entry]) => entry.role === role && entry.name.endsWith(name));
      expect(match).toBeDefined();
      return ui("click", "--ref", "@" + match![0]);
    };
    await expect.poll(snapshot, { timeout: 15_000 }).toContain('textbox "Message Pepper"');
    const engineer = (await api("/api/bots", { name: "Engineer", title: "Implementation", section: "" })).bot;
    const gateFile = join(temporary, "finish-teammate");
    writeFileSync(planPath, JSON.stringify({
      [info.botId]: { steps: [{ arguments: { bot_ids: [engineer.id], request_key: "review", message: "Check the fixture CSV export" } }], reply: "Assigned", resumeReply: "Engineer checked the fixture CSV export" },
      [engineer.id]: { gateFile, reply: "CSV export checked in my separate task" },
    }));
    await ui("flag", "--set", "features.showToolCalls=false");
    await ui("type", "--name", "Message Pepper", "--text", "Please have Engineer check the CSV export and report back");
    await ui("press", "--keys", "Enter");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain("Teammates working");

    // The compact line: who helps whom and its state, with the way in.
    const row = () => evaluate(`document.querySelector("[data-bot-conversation-row]")?.textContent ?? ""`) as Promise<string>;
    await expect.poll(row, { timeout: 15_000 }).toMatch(/^Engineer\s*helping\s*Pepper·View conversation(Claimed|Working)$/);
    expect(await snapshot()).not.toContain("Sent to Engineer");
    await evaluate(`(window.__botConversationPage = "same page", true)`);
    await ui("screenshot", "--out", info.logPath + ".bot-conversation-row.png");

    await click("View conversation");
    await expect.poll(dialog, { timeout: 15_000 }).toContain("Check the fixture CSV export");
    const working = await dialog();
    expect(working).toContain("Pepper ⇄ Engineer");
    expect(working).toContain("Conversation between bots · 1 message");
    expect(working).toContain("Pepper made a request to Engineer");
    expect(working).toContain("Read only. To change course, talk to Pepper.");
    expect(working).not.toContain("CSV export checked in my separate task");
    expect(await evaluate(`document.querySelector("[data-bot-conversation] [data-handoff-status]")?.dataset.handoffStatus`)).toMatch(/claimed|working/);
    expect(await evaluate(`document.querySelectorAll("[data-bot-conversation] textarea, [data-bot-conversation] input").length`)).toBe(0);
    await ui("screenshot", "--out", info.logPath + ".bot-conversation-working.png");

    // The teammate finishes while the dialog is open: its reply and the new state arrive in it.
    writeFileSync(gateFile, "complete fixture work");
    await expect.poll(dialog, { timeout: 60_000 }).toContain("CSV export checked in my separate task");
    await expect.poll(() => evaluate(`document.querySelector("[data-bot-conversation] [data-handoff-status]")?.dataset.handoffStatus`), { timeout: 30_000 }).toBe("done");
    expect(await dialog()).toContain("Conversation between bots · 2 messages");
    expect(await evaluate(`window.__botConversationPage`)).toBe("same page");
    await ui("screenshot", "--out", info.logPath + ".bot-conversation-done.png");

    // Closing leaves the person in the chat they were in, on the row that opened the dialog.
    await ui("press", "--keys", "Escape");
    await expect.poll(dialog, { timeout: 15_000 }).toBe("");
    expect(await evaluate(`document.activeElement?.hasAttribute("data-bot-conversation-open")`)).toBe(true);
    expect(await snapshot()).toContain('textbox "Message Pepper"');
    await click("View conversation");
    await expect.poll(dialog, { timeout: 15_000 }).toContain("CSV export checked in my separate task");
    await click("Talk to Pepper");
    await expect.poll(dialog, { timeout: 15_000 }).toBe("");
    await expect.poll(() => evaluate(`document.activeElement?.closest('[data-tour="composer"]') !== null`), { timeout: 15_000 }).toBe(true);
    const selected = (await api("/api/bots?messages=0")).bots.find((bot: any) => bot.id === engineer.id);
    expect(selected.threadId).toBe(engineer.threadId);
  } finally {
    await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
    await removeTempDir(temporary);
  }
}, 300_000);
