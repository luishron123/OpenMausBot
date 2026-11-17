import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { initialState, StoreContext, type AppState, type Bot } from "@/state/store";
import { ChatHeadPill, type ChatHeadPrivacy } from "./ChatHeadPill";

const bot = (threadId: string, title = "New thread"): Bot => ({
  id: "rooms", threadId, mainThreadId: "main", name: "Rooms", title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "claude", model: "test" }, messages: [],
  tasks: [{ threadId: "main", title: "Shared chat", createdAt: 1 }, { threadId: "own", title, createdAt: 2 }],
} as unknown as Bot);
const pill = (of: Bot, privacy: ChatHeadPrivacy) => renderToStaticMarkup(createElement(StoreContext.Provider,
  { value: { state: { ...initialState } as AppState, dispatch: vi.fn(), flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() } as never },
  createElement(ChatHeadPill, { bot: of, avatar: { state: "idle", motion: "none", motionKey: 0, animated: false } as never, privacy, onToggle: vi.fn() })));

it("names the shared chat beside the bot, so the person knows where they are", () => {
  expect(pill(bot("main"), { kind: "shared", team: "Acme" })).toContain("Shared chat");
});

it("says nothing extra off a team, and a private chat keeps its own name", () => {
  expect(pill(bot("main"), null)).not.toContain("Shared chat");
  expect(pill(bot("own"), { kind: "private" })).toContain("Untitled chat");
  expect(pill(bot("own", "Quarter numbers"), { kind: "private" })).toContain("Quarter numbers");
});

it("names it too from another conversation's list, in the person's language", () => {
  const away = { ...bot("main"), mainThreadId: "elsewhere", tasks: [...bot("main").tasks!, { threadId: "elsewhere", title: "Other", createdAt: 3 }] } as Bot;
  expect(pill(away, { kind: "shared", team: "Acme" })).toContain("Shared chat");
});

it("puts the conversations chevron beside the name, as its own button on the same surface", () => {
  const markup = pill(bot("main"), null);
  const shell = markup.match(/^<div[^>]*data-chathead-pill-shell="true"[^>]*>/)![0];
  expect(shell.match(/class="([^"]*)"/)![1]!.split(" ")).toEqual(expect.arrayContaining(["rounded-full", "bg-composer"]));
  const buttons = [...markup.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toContain('data-chathead-pill="true"');
  expect(buttons[0]).toContain('aria-label="Open Rooms&#x27;s profile"');
  expect(buttons[1]).toContain('data-chathead-threads="true"');
  expect(buttons[1]).toContain('aria-haspopup="dialog"');
  expect(buttons[1]).toContain('aria-expanded="false"');
  expect(buttons[1]).toContain('aria-label="Conversations: Rooms"');
  expect(markup).not.toContain("data-chathead-threads-sheet");
});
