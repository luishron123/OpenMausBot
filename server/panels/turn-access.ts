// Which panels a bot's turn may see on a Team Cloud: the ones the person behind its conversation could see in Panels.
// Security invariant: a panel's cards are only ever read or written from a conversation whose readers could already read
// them there. In a conversation private to a person, that person's own level on the bot that made the panel decides, as
// the HTTP routes do for their session (routes.ts); the panel's own conversation must also be readable from this one
// (audience.ts mayRead). In a shared conversation or a room everyone who sees the calling bot reads what it writes, so
// the panel's maker must be seen by at least that whole audience. Off a team every panel is seen, as before.
// Changing a panel (a card, a failure, a key taken over, an automation link) asks more than seeing it, as the routes do:
// in a private conversation the person needs chat or edit on the maker; in a shared one the maker itself may change its
// own panel, and another bot only when the maker's sharing lets everyone in the calling bot's audience chat with it.
import { atLeast, type BotAccessLevel } from "../../shared/bot-access.ts";
import type { Panel } from "../../shared/panels.ts";
import { accessOf, audienceWithin, memberLevel, storedVisibility, type AccessBot } from "../bot-visibility.ts";
import type { PanelCaller } from "./tools.ts";

/** What a turn wants with a panel: to read it, or to change it. */
export type PanelNeed = "see" | "change";
export type PanelTurnAccess = (caller: PanelCaller, panel: Panel, need?: PanelNeed) => boolean;

export interface PanelTurnAccessDeps {
  team: boolean;
  /** The read rule from this conversation to another (cloud-team-host.ts readableFrom). */
  readableFrom(threadId: string): (other: string) => boolean;
  /** The person key a conversation is private to; null for a shared one, a room's, and anywhere off a team. */
  privateTo(threadId: string): string | null;
  /** What that person may do with a bot, as their own session would. */
  personLevel(person: string, botId: string): BotAccessLevel;
  bot(botId: string): (AccessBot & { id: string }) | undefined;
}

/** Whether everyone who sees `from` may chat with `maker`; admins always may. */
function audienceMayChat(from: AccessBot, maker: AccessBot): boolean {
  const audience = storedVisibility(from.visibility);
  if (audience === "admins") return true;
  const access = accessOf(maker);
  if (atLeast(access.everyone, "chat")) return true;
  if (audience === "everyone") return false;
  return audience.people.every((entry) => entry.startsWith("@") ? atLeast(access.people[entry], "chat") : atLeast(memberLevel(maker, entry), "chat"));
}

export function createPanelTurnAccess(deps: PanelTurnAccessDeps): PanelTurnAccess {
  return (caller, panel, need = "see") => {
    if (!deps.team) return true;
    const origin = panel.createdBy.threadId;
    if (origin && !deps.readableFrom(caller.threadId)(origin)) return false;
    const person = deps.privateTo(caller.threadId);
    if (person) return atLeast(deps.personLevel(person, panel.createdBy.botId), need === "change" ? "chat" : "view");
    const from = deps.bot(caller.botId);
    const maker = deps.bot(panel.createdBy.botId);
    if (!from || !maker) return false;
    if (from.id === maker.id) return true;
    return audienceWithin(from.visibility, maker.visibility) && (need === "see" || audienceMayChat(from, maker));
  };
}
