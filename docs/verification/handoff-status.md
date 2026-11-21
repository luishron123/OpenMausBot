# Hand-off status: who's working on what

When a bot hands work to another bot, the row in the asking conversation carries a small status that updates
live: **Claimed**, **Working**, **Waiting on <bot>** or **Waiting on you**, then **Done** or
**Failed: <one line why>**. The conversation that does the work carries the same status, so its row in the
Inbox's active list says the same words. The status is display only and never holds the work up.

In the asking bot's own chat the row is one line, "<bot> helping <asking bot> · View conversation", with the
status under it. **View conversation** opens a read-only dialog over the chat: that hand-off's request and
written answers only, kept current while the work runs, the same status at the end, **Open thread** to go to
the conversation that did the work and **Talk to <asking bot>** to close it and write in the chat. Work a
person stopped reads **Stopped** there (with how long it ran, from a minute up) and names nobody, because who
stopped it is not recorded. A conversation the viewer cannot read shows the two bots, the status and one
neutral line.

Everywhere else the row stays the "Sent to …" pill with the status chip beside it, and the pill itself opens
the conversation with the result: in a room (work sent down a lane has a thread of its own), for work sent to
a bot directly because it is not in the room, in a bot's own thread, and when the viewer cannot see the other
bot.

The status is read from the assignment records each time they are written (`server/host/handoff-status.ts`);
no field is added to them. The rows it follows are kept in `handoff-lines.json` until they end, so a restart
picks them up again.

On a Team Cloud the status also names whose request it is ("Working · for Mira") and the person a question waits
on. When the work runs in a member's private chat and the row is somewhere that member doesn't own, it says
only "for Mira (private)": no failure words, nothing about a stop, and the row's link loses the private chat's
title. Everywhere else the status names no person.

Hand-offs into a room (its `comm` rows) keep their own room status and get no chip.

## Automated checks

```sh
pnpm exec vitest run server/host/handoff-status.test.ts src/components/HandoffStatusChip.test.ts src/components/ThreadChip.test.ts src/components/SidebarBotActivity.test.ts
pnpm exec vitest run src/lib/bot-conversation.test.ts src/state/bot-conversation.test.ts src/components/BotConversationDialog.test.ts src/components/BotConversationRow.dom.test.ts
OMB_TEST_PORTS=20900-20999 pnpm exec vitest run server/handoff-status.e2e.test.ts
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/bot-conversation-ui.e2e.test.ts
```

The screen test drives the real chat on the scripted engine: it reads the line, opens the dialog while the other
bot is still working, sees the answer and **Done** arrive in the open dialog, closes it with Escape and checks
the focus returns to the button, then uses **Talk to** and checks the composer has the focus.

The e2e test uses the scripted engine: Lead hands Coder a page, Coder hands Writer the copy, and Lead's row moves
through working, waiting on Writer and done while Coder's work conversation shows the same; nobody presses anything.

**What it does not prove:** phones (they show the row's English words), a Team Cloud end to end (the unit
tests cover its names and the private case), and on screen a conversation the viewer cannot read (unit tests
only).
