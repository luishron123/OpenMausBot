import { describe, expect, it } from "vitest";
import { botConversationLines, withoutShownHandoffResults, handoffDuration, requestSummary, withoutMention } from "./bot-conversation";

const peer = { botId: "engineer", name: "Engineer" };
const pepper = { botId: "pepper", name: "Pepper", color: "blue" as const };
const request = (id: string, handoff: string, text: string, at: number) =>
  ({ id, role: "bot" as const, kind: "text" as const, text, at, from: pepper, roomRequest: { id: handoff, phase: "request" as const } });
const reply = (id: string, text: string, at: number, extra: object = {}) =>
  ({ id, role: "bot" as const, kind: "text" as const, text, at, ...extra });

describe("botConversationLines", () => {
  const thread = [
    request("r1", "h1", "@Engineer Check the export.", 1),
    reply("a1", "The export is right.", 2),
    { id: "d1", role: "bot" as const, kind: "digest" as const, text: "digest", at: 3 },
    request("r2", "h2", "@Engineer Deploy the preview.\nUse the staging bucket.", 4),
    { id: "t2", role: "bot" as const, kind: "activity" as const, tool: { name: "Bash", ok: true }, at: 5 },
    reply("a2", "Deploying now.", 6),
    reply("a2b", "Deployed.", 7),
    { id: "u1", role: "user" as const, kind: "text" as const, text: "And the logs?", at: 8 },
    reply("a3", "Here are the logs.", 9),
    request("r3", "h3", "@Engineer Audit the invoices.", 10),
  ];

  it("keeps only the hand-off's own request and its written answers", () => {
    expect(botConversationLines(thread, "h2", peer)).toEqual([
      { id: "r2", from: "requester", text: "Deploy the preview.\nUse the staging bucket.", at: 4 },
      { id: "a2", from: "peer", text: "Deploying now.", at: 6 },
      { id: "a2b", from: "peer", text: "Deployed.", at: 7 },
    ]);
  });

  it("ends at the next request, at the first and at the last hand-off of the thread", () => {
    expect(botConversationLines(thread, "h1", peer).map((line) => line.id)).toEqual(["r1", "a1"]);
    expect(botConversationLines(thread, "h3", peer).map((line) => line.id)).toEqual(["r3"]);
  });

  it("leaves out what the bot wrote to its own person after the hand-off", () => {
    expect(botConversationLines(thread, "h2", peer).some((line) => line.id === "a3")).toBe(false);
  });

  it("is empty for a hand-off the thread does not hold", () => {
    expect(botConversationLines(thread, "missing", peer)).toEqual([]);
  });

  it("follows a reply that names its request past the boundary, and drops one that names another", () => {
    const named = [
      request("r1", "h1", "@Engineer One.", 1),
      request("r2", "h2", "@Engineer Two.", 2),
      reply("a1", "Answer to one.", 3, { requestMessageId: "r1" }),
      reply("a2", "Answer to two.", 4, { requestMessageId: "r2" }),
    ];
    expect(botConversationLines(named, "h1", peer).map((line) => line.id)).toEqual(["r1", "a1"]);
    expect(botConversationLines(named, "h2", peer).map((line) => line.id)).toEqual(["r2", "a2"]);
  });

  it("leaves out another bot's words and empty replies", () => {
    const mixed = [
      request("r1", "h1", "@Engineer One.", 1),
      reply("x", "From someone else.", 2, { from: { botId: "scout", name: "Scout", color: "green" } }),
      reply("e", "   ", 3),
      reply("a", "Mine.", 4, { from: { botId: "engineer", name: "Engineer", color: "green" } }),
    ];
    expect(botConversationLines(mixed, "h1", peer).map((line) => line.id)).toEqual(["r1", "a"]);
  });
});

describe("request text", () => {
  it("drops only the leading mention of the bot that was asked", () => {
    expect(withoutMention("@Engineer Check it.", "Engineer")).toBe("Check it.");
    expect(withoutMention("@Engineering Check it.", "Engineer")).toBe("@Engineering Check it.");
    expect(withoutMention("Ask @Engineer.", "Engineer")).toBe("Ask @Engineer.");
  });

  it("reads the mention as the product does: whole Unicode names, any case, names of several words", () => {
    expect(withoutMention("@Anaïs revise o texto.", "Ana")).toBe("@Anaïs revise o texto.");
    expect(withoutMention("@Anaïs revise o texto.", "Anaïs")).toBe("revise o texto.");
    expect(withoutMention("@José, confira.", "José")).toBe(", confira.");
    expect(withoutMention("@Dev Front ajuste o botão.", "Dev Front")).toBe("ajuste o botão.");
    expect(withoutMention("@Dev Frontend ajuste o botão.", "Dev Front")).toBe("@Dev Frontend ajuste o botão.");
    expect(withoutMention("@dev front ajuste.", "Dev Front")).toBe("ajuste.");
    expect(withoutMention("@Ana2 revise.", "Ana")).toBe("@Ana2 revise.");
    expect(withoutMention("@ revise.", "")).toBe("@ revise.");
  });

  it("is the request's first line, on one line", () => {
    expect(requestSummary(botConversationLines([request("r", "h", "@Engineer \n  Deploy   the preview.\nThen tell me.", 1)], "h", peer))).toBe("Deploy the preview.");
    expect(requestSummary([])).toBe("");
  });
});

describe("handoffDuration", () => {
  it("says nothing under a minute, then whole minutes, then whole hours", () => {
    expect(handoffDuration(0, 59_999)).toBeNull();
    expect(handoffDuration(0, 60_000)).toEqual({ unit: "minutes", count: 1 });
    expect(handoffDuration(0, 59 * 60_000)).toEqual({ unit: "minutes", count: 59 });
    expect(handoffDuration(0, 150 * 60_000)).toEqual({ unit: "hours", count: 2 });
    expect(handoffDuration(10, 5)).toBeNull();
  });
});

describe("withoutShownHandoffResults", () => {
  const bots = [{ id: "pepper" }, { id: "engineer" }];
  const from = { botId: "pepper", name: "Pepper", color: "orange" };
  const threadRef = { botId: "engineer", threadId: "t1", title: "work" };
  const sent = (id: string, extra: object = {}) => ({ id: `sent-${id}`, from, threadRef, handoff: { id, state: "done" as const, at: 2 }, ...extra });
  const result = (id: string, extra: object = {}) => ({ id: `result-${id}`, threadRef, roomRequest: { id, phase: "result" as const }, ...extra });
  const said = { id: "said" };

  it("drops the result row of a hand-off that already has its conversation line", () => {
    const rows = [sent("a"), said, result("a")];
    expect(withoutShownHandoffResults(rows, bots).map((row) => row.id)).toEqual(["sent-a", "said"]);
  });

  it("keeps a result that carries files, and results of hand-offs drawn the old way", () => {
    const withFiles = result("a", { attachments: [{ id: "f", name: "report.pdf", kind: "file" }] });
    const direct = sent("b", { sentDirectly: { name: "Engineer" } });
    const unseen = sent("c", { threadRef: { botId: "hidden", threadId: "t2", title: "x" } });
    const rows = [sent("a"), withFiles, direct, result("b"), unseen, result("c"), result("d")];
    expect(withoutShownHandoffResults(rows, bots).map((row) => row.id)).toEqual(["sent-a", "result-a", "sent-b", "result-b", "sent-c", "result-c", "result-d"]);
  });

  it("returns the same list when no hand-off has a conversation line", () => {
    const rows = [said, result("a")];
    expect(withoutShownHandoffResults(rows, bots)).toBe(rows);
  });
});
