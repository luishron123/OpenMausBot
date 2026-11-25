import { expect, it } from "vitest";

import type { BotAccessLevel } from "../../shared/bot-access.ts";
import type { Panel } from "../../shared/panels.ts";
import { createPanelTurnAccess, type PanelTurnAccessDeps } from "./turn-access.ts";

// Mira and Joe on a team. Each thread's audience: a person's own ("mira", "joe") or the team's ("team").
const audience: Record<string, string> = { "t-mira": "mira", "t-mira-2": "mira", "t-joe": "joe", "t-team": "team", "t-shared": "team" };
const levels: Record<string, Record<string, BotAccessLevel>> = { mira: { payroll: "chat", scout: "chat" }, joe: { scout: "chat" } };
const bots: Record<string, { id: string; visibility: unknown }> = {
  payroll: { id: "payroll", visibility: "admins" },
  scout: { id: "scout", visibility: "everyone" },
  helper: { id: "helper", visibility: "everyone" },
};

function access(team = true) {
  const deps: PanelTurnAccessDeps = {
    team,
    readableFrom: (threadId) => (other) => audience[other] === "team" || audience[other] === audience[threadId],
    privateTo: (threadId) => (audience[threadId] === "team" ? null : audience[threadId] ?? null),
    personLevel: (person, botId) => levels[person]?.[botId] ?? "none",
    bot: (botId) => bots[botId],
  };
  return createPanelTurnAccess(deps);
}

const panel = (botId: string, threadId?: string) => ({ id: "pnl_1", createdBy: { botId, ...(threadId ? { threadId } : {}) } }) as Panel;

it("lets a person's own conversation see the panels that person could see, and none from another person's", () => {
  const sees = access();
  expect(sees({ botId: "scout", threadId: "t-mira" }, panel("payroll", "t-mira-2"))).toBe(true);
  expect(sees({ botId: "scout", threadId: "t-joe" }, panel("payroll", "t-team"))).toBe(false);
  expect(sees({ botId: "scout", threadId: "t-joe" }, panel("scout", "t-mira"))).toBe(false);
  expect(sees({ botId: "scout", threadId: "t-joe" }, panel("scout", "t-team"))).toBe(true);
  expect(sees({ botId: "scout", threadId: "t-joe" }, panel("scout"))).toBe(true);
});

it("lets a shared conversation see a panel only when everyone reading it may see the panel's bot", () => {
  const sees = access();
  expect(sees({ botId: "scout", threadId: "t-shared" }, panel("payroll", "t-team"))).toBe(false);
  expect(sees({ botId: "scout", threadId: "t-shared" }, panel("helper", "t-team"))).toBe(true);
  expect(sees({ botId: "payroll", threadId: "t-shared" }, panel("payroll", "t-team"))).toBe(true);
  expect(sees({ botId: "scout", threadId: "t-shared" }, panel("helper", "t-mira"))).toBe(false);
  expect(sees({ botId: "scout", threadId: "t-shared" }, panel("gone", "t-team"))).toBe(false);
});

it("sees every panel off a team", () => {
  expect(access(false)({ botId: "scout", threadId: "t-joe" }, panel("payroll", "t-mira"))).toBe(true);
});
