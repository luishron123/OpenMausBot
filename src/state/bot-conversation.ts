// The thread behind the open "View conversation" dialog: loaded once, then kept current by the same frames the chat gets.
import { useSyncExternalStore } from "react";
import { loadFullThread } from "./message-history";
import type { Message } from "./store";

export interface BotConversationState {
  threadId: string;
  loadId: number;
  messages: Message[];
  /** `denied`: the thread could not be read, so nothing of it is shown, live rows included. */
  status: "loading" | "ready" | "denied";
}

export type BotConversationEvent =
  | { type: "open"; threadId: string; loadId: number }
  | { type: "loaded"; threadId: string; loadId: number; messages: Message[] }
  | { type: "loadFailed"; threadId: string; loadId: number }
  | { type: "message"; threadId: string; message: Message; patch?: true }
  | { type: "close" };

export function reduceBotConversation(state: BotConversationState | null, event: BotConversationEvent): BotConversationState | null {
  switch (event.type) {
    case "open":
      return { threadId: event.threadId, loadId: event.loadId, messages: [], status: "loading" };
    case "loaded": {
      if (state?.threadId !== event.threadId || state.loadId !== event.loadId) return state;
      const live = new Map(state.messages.map((message) => [message.id, message]));
      const loaded = new Set(event.messages.map((message) => message.id));
      return { ...state, status: "ready", messages: [...event.messages.map((message) => live.get(message.id) ?? message),
        ...state.messages.filter((message) => !loaded.has(message.id))] };
    }
    case "loadFailed":
      return state?.threadId === event.threadId && state.loadId === event.loadId ? { ...state, status: "denied", messages: [] } : state;
    case "message": {
      if (state?.threadId !== event.threadId || state.status === "denied") return state;
      if (state.messages.some((message) => message.id === event.message.id)) {
        return { ...state, messages: state.messages.map((message) => message.id === event.message.id ? event.message : message) };
      }
      // A patch of a row the loaded thread does not hold is not a new row.
      return event.patch && state.status === "ready" ? state : { ...state, messages: [...state.messages, event.message] };
    }
    case "close":
      return null;
  }
}

let current: BotConversationState | null = null;
let loads = 0;
const listeners = new Set<() => void>();

function apply(event: BotConversationEvent): void {
  const next = reduceBotConversation(current, event);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function openBotConversation(threadId: string, load: typeof loadFullThread = loadFullThread): void {
  const loadId = ++loads;
  apply({ type: "open", threadId, loadId });
  void load(threadId).then(
    ({ messages }) => apply({ type: "loaded", threadId, loadId, messages }),
    () => apply({ type: "loadFailed", threadId, loadId }),
  );
}

export function closeBotConversation(): void {
  apply({ type: "close" });
}

export function noteBotConversationFrame(frame: { kind: string; threadId?: string; message?: unknown }): void {
  if (!current || frame.threadId !== current.threadId || !frame.message) return;
  if (frame.kind === "message") apply({ type: "message", threadId: frame.threadId, message: frame.message as Message });
  else if (frame.kind === "message.patch") apply({ type: "message", threadId: frame.threadId, message: frame.message as Message, patch: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function heldBotConversation(): BotConversationState | null {
  return current;
}

export function useBotConversation(): BotConversationState | null {
  return useSyncExternalStore(subscribe, heldBotConversation, () => null);
}
