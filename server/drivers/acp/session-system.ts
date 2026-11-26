import { createHash } from "node:crypto";
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

/** Whether session `sessionId` was last given another system prompt than `system`. The native Antigravity CLI (1.5.18)
 * keeps the prompt a session was created with and adds a resume's prompt after it, so resuming that session would show
 * the model both. */
export function heldSystemChanged(scope: string, threadId: string, sessionId: string, turn: SendTurnInput, system: string | undefined): boolean {
  const stable = promptHalves(turn).stable;
  if (system === undefined || stable === null) return false;
  const receipt = readPromptSplitReceipt(scope, JSON.stringify([threadId, sessionId]));
  return receipt !== null && receipt.stable !== promptSplitFingerprints(stable, "").stable;
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
