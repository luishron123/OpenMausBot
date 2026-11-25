// Three cards a bot could keep, offered in New widget without asking any AI: first from the bot's own automations that
// keep no panel yet, then from what the bot is for (its title and description). Nothing to go on, no suggestions.
import type { PanelSchedule, PanelSuggestion } from "../../shared/panels.ts";
import type { Routine } from "../routines.ts";
import { scheduleOf } from "./cards.ts";

export interface SuggestionBot {
  name: string;
  title?: string;
  description?: string;
}

const COUNT = 3;
const firstSentence = (text: string) => text.split(/(?<=[.!?])\s|\n/)[0]!.trim().replace(/[.!?]$/, "");
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function panelSuggestions(bot: SuggestionBot | null, routines: readonly Routine[]): PanelSuggestion[] {
  if (!bot) return [];
  const out: PanelSuggestion[] = [];
  for (const routine of routines) {
    if (out.length >= COUNT) break;
    if (routine.panelId || routine.target !== "bot") continue;
    const schedule: PanelSchedule = scheduleOf(routine) ?? (routine.schedule?.type === "interval" && routine.schedule.everyMinutes <= 60 ? "hour" : "day");
    out.push({ title: clip(routine.name, 60), prompt: clip(`The latest result of "${routine.name}": ${firstSentence(routine.prompt)}`, 300), format: "auto", schedule: schedule === "manual" ? "day" : schedule });
  }
  const about = [bot.title, bot.description].map((text) => text?.trim()).filter((text): text is string => Boolean(text)).map(firstSentence)[0];
  if (!about) return out;
  const role = clip(about, 120);
  const fromRole: PanelSuggestion[] = [
    { title: "Today at a glance", prompt: `The one number that matters most today for ${role}, with the change from yesterday.`, format: "kpi", schedule: "day" },
    { title: "Needs attention", prompt: `Open items that need attention now for ${role}, most urgent first, at most 5.`, format: "checklist", schedule: "hour" },
    { title: "Weekly trend", prompt: `How the main measure for ${role} moved over the last 7 days.`, format: "line", schedule: "week" },
  ];
  for (const one of fromRole) if (out.length < COUNT && !out.some((taken) => taken.title === one.title)) out.push(one);
  return out;
}
