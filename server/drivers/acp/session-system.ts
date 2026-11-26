import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../atomic.ts";
import { DATA_DIR } from "../../config.ts";
import type { SendTurnInput } from "../../contracts.ts";
import { promptHalves, promptSplitFingerprints, readPromptSplitReceipt, splitSessionNote, splitSessionPrompt, type PromptSplitReceipt } from "../prompt-split.ts";
import type { AcpDriverHooks } from "./driver-hooks.ts";

type SystemHooks = Pick<AcpDriverHooks, "sessionSystemPrompt">;

/** The system prompt the session holds, or undefined when the prompt text carries it. */
export function sessionSystem(support: SystemHooks, init: unknown, instanceId: string, turn: SendTurnInput): string | undefined {
  if (!support.sessionSystemPrompt?.(init, instanceId)) return undefined;
  return promptHalves(turn).stable ?? turn.system ?? "";
}

/** What a live session must match for a turn to reuse it: a session holding another system prompt is loaded again. */
export function liveSessionKey(sessionKey: string, system: string | undefined): string {
  return system === undefined ? sessionKey : JSON.stringify([sessionKey, createHash("sha256").update(system).digest("hex")]);
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const heldSystemPath = (scope: string, threadId: string, sessionId: string) =>
  join(DATA_DIR, "session-system", digest(JSON.stringify([scope, threadId, sessionId])) + ".json");

/** The live-session key of a session just created or resumed with `system`, which is recorded as the prompt that session holds. */
export function newSessionKey(scope: string, threadId: string, sessionId: string | null, sessionKey: string, system: string | undefined): string {
  if (sessionId !== null && system !== undefined) {
    mkdirSync(join(DATA_DIR, "session-system"), { recursive: true });
    writeFileAtomic(heldSystemPath(scope, threadId, sessionId), JSON.stringify({ system: digest(system) }), { mode: 0o600 });
  }
  return liveSessionKey(sessionKey, system);
}

function recordedSystem(scope: string, threadId: string, sessionId: string): string | null {
  try {
    const record = JSON.parse(readFileSync(heldSystemPath(scope, threadId, sessionId), "utf8")) as { system?: unknown };
    return typeof record.system === "string" ? record.system : null;
  } catch {
    return null;
  }
}

/** Whether session `sessionId` holds another system prompt than `system`. The native Antigravity CLI (1.5.18) keeps the
 * prompt a session was created with and adds a resume's prompt after it, so resuming that session would show the model
 * both. A session created before its prompt was recorded is judged by the prompt-split receipt of its last turn, and
 * one with neither is taken as holding another: a new session is opened once and recorded. */
export function heldSystemChanged(scope: string, threadId: string, sessionId: string, turn: SendTurnInput, system: string | undefined): boolean {
  if (system === undefined) return false;
  const recorded = recordedSystem(scope, threadId, sessionId);
  if (recorded !== null) return recorded !== digest(system);
  const stable = promptHalves(turn).stable;
  if (stable === null) return true;
  const receipt = readPromptSplitReceipt(scope, JSON.stringify([threadId, sessionId]));
  return receipt === null || receipt.stable !== promptSplitFingerprints(stable, "").stable;
}

/** A turn that starts a new session for a revised system prompt with no conversation to rebuild it from. */
export function withoutHistoryNote(text: string): string {
  return `${text}\n\n(Your instructions changed, so this conversation continues in a new session: earlier messages are not in it.)`;
}

export interface TurnPrompt {
  input: SendTurnInput;
  /** Sent as the prompt's last block: Antigravity 1.5.14 reads commands only in a prompt's first block. */
  note: string;
  split: { key: string; receipt: PromptSplitReceipt; previous: PromptSplitReceipt | null } | null;
}

export function turnPrompt(
  scope: string,
  key: { threadId: string; sessionId: string },
  turn: SendTurnInput,
  promptTurn: SendTurnInput,
  system: string | undefined,
  reAnchorAfterTurns: number,
): TurnPrompt {
  const halves = promptHalves(turn);
  if (halves.stable === null) return { input: system === undefined ? promptTurn : { ...promptTurn, system: "" }, note: "", split: null };
  const receiptKey = JSON.stringify([key.threadId, key.sessionId]);
  const previous = readPromptSplitReceipt(scope, receiptKey);
  const perTurnVolatile = Boolean(turn.mentionTurn);
  if (system !== undefined) {
    const { note, receipt } = splitSessionNote(halves.stable, halves.volatile, previous, perTurnVolatile, reAnchorAfterTurns);
    return { input: { ...promptTurn, system: "" }, note, split: { key: receiptKey, receipt, previous } };
  }
  const composed = splitSessionPrompt(halves.stable, halves.volatile, previous, promptTurn.system, promptTurn.text, perTurnVolatile, reAnchorAfterTurns);
  return { input: { ...promptTurn, system: "", text: composed.text }, note: "", split: { key: receiptKey, receipt: composed.receipt, previous } };
}
