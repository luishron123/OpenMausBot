// Which panels a bot's turn may see on a Team Cloud: the ones the person behind its conversation could see in Panels.
// Security invariant: a panel's cards are only ever read or written from a conversation whose readers could already read
// them there. In a conversation private to a person, that person's own level on the bot that made the panel decides, as
// the HTTP routes do for their session (routes.ts); the panel's own conversation must also be readable from this one
// (audience.ts mayRead). In a shared conversation or a room everyone who sees the calling bot reads what it writes, so
// the panel's maker must be seen by at least that whole audience. Off a team every panel is seen, as before.
import type { BotAccessLevel } from "../../shared/bot-access.ts";
import type { Panel } from "../../shared/panels.ts";
import { audienceWithin } from "../bot-visibility.ts";
import type { PanelCaller } from "./tools.ts";

export interface PanelTurnAccessDeps {
  team: boolean;
  /** The read rule from this conversation to another (cloud-team-host.ts readableFrom). */
  readableFrom(threadId: string): (other: string) => boolean;
  /** The person key a conversation is private to; null for a shared one, a room's, and anywhere off a team. */
  privateTo(threadId: string): string | null;
  /** What that person may do with a bot, as their own session would. */
  personLevel(person: string, botId: string): BotAccessLevel;
  bot(botId: string): { id: string; visibility?: unknown } | undefined;
}

export function createPanelTurnAccess(deps: PanelTurnAccessDeps): (caller: PanelCaller, panel: Panel) => boolean {
  return (caller, panel) => {
    if (!deps.team) return true;
    const origin = panel.createdBy.threadId;
    if (origin && !deps.readableFrom(caller.threadId)(origin)) return false;
    const person = deps.privateTo(caller.threadId);
    if (person) return deps.personLevel(person, panel.createdBy.botId) !== "none";
    const from = deps.bot(caller.botId);
    const maker = deps.bot(panel.createdBy.botId);
    return Boolean(from && maker) && (from!.id === maker!.id || audienceWithin(from!.visibility, maker!.visibility));
  };
}
