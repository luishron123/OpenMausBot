import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isTypeaheadKey, typeaheadMatch, typeaheadText, type Typeahead } from "@/lib/menu-keys";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import type { Bot } from "@/state/store";
import { BotConversations } from "./bot-panel/Conversations";
import { ELEVATED_TINT } from "./elevated";
import { MENU_SHEET } from "./menu-recipe";
import { useHeldMenuMotion } from "./MenuMotion";

const SHEET_WIDTH = 320;
const EDGE = 8;
const GAP = 6;
/** A request older than this was for a header that never came on screen. */
const REQUEST_MS = 5000;
/** What the arrow keys walk, in the order the list shows them. */
const STOPS = "[data-conversations-query], [data-conversations-new], [data-sidebar-thread-row], [data-conversations-more], [data-conversations-archived]";
/** A conversation row's own menu and its delete confirmation are drawn outside the list, and belong to it. */
const OWN_OVERLAYS = "[data-thread-overlay], [role=alertdialog]";

type Place = { left: number; top: number; width: number };
type Request = { botId: string; at: number };

let request: Request | null = null;
const watchers = new Set<() => void>();
const subscribe = (watch: () => void) => {
  watchers.add(watch);
  return () => { watchers.delete(watch); };
};
const snapshot = () => request;

/** Opens the conversations list on the chat header of `botId`, once that header is on screen. */
export function showBotConversations(botId: string): void {
  request = { botId, at: Date.now() };
  for (const watch of Array.from(watchers)) watch();
}

export function threadsPlace(pill: Pick<DOMRect, "left" | "width" | "bottom">, viewport: { width: number }): Place {
  const width = Math.min(SHEET_WIDTH, viewport.width - EDGE * 2);
  const left = pill.left + pill.width / 2 - width / 2;
  return { left: Math.max(EDGE, Math.min(left, viewport.width - width - EDGE)), top: pill.bottom + GAP, width };
}

/** The chevron at the end of the chat header's bot pill, and the list of the bot's conversations it opens. */
export function ChatHeadThreads({ bot, className }: { bot: Bot; className?: string }) {
  const [place, setPlace] = useState<Place | null>(null);
  const motion = useHeldMenuMotion(place);
  const anchor = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const focusSheet = useRef(false);
  const typed = useRef<Typeahead | null>(null);
  const asked = useSyncExternalStore(subscribe, snapshot, () => null);
  const listed = useRef(bot.id);
  const open = place !== null;

  const close = () => setPlace(null);
  const show = () => {
    const pill = anchor.current?.parentElement;
    if (pill) setPlace(threadsPlace(pill.getBoundingClientRect(), { width: window.innerWidth }));
  };
  const dismiss = () => {
    if (sheet.current?.contains(document.activeElement)) anchor.current?.focus();
    close();
  };

  // One effect, in this order: a request that arrives with the switch to its bot must open after the switch closes.
  useEffect(() => {
    if (listed.current !== bot.id) { listed.current = bot.id; close(); }
    if (!asked || asked !== request || asked.botId !== bot.id) return;
    request = null;
    if (Date.now() - asked.at < REQUEST_MS) show();
  }, [asked, bot.id]);
  useEffect(() => {
    if (!open) return;
    if (focusSheet.current) { focusSheet.current = false; sheet.current?.querySelector<HTMLElement>(STOPS)?.focus(); }
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);
  const root = useRef({
    contains: (target: unknown) => target instanceof Node
      && Boolean(sheet.current?.contains(target) || anchor.current?.contains(target) || (target instanceof Element && target.closest(OWN_OVERLAYS))),
  });
  usePopoverDismiss(open, root, dismiss);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(OWN_OVERLAYS)) return;
    const typing = target instanceof HTMLInputElement;
    if (typing && !target.matches("[data-conversations-query]")) return;
    const stops = Array.from(sheet.current?.querySelectorAll<HTMLElement>(STOPS) ?? []);
    const at = stops.indexOf(target);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      stops[(at + (event.key === "ArrowDown" ? 1 : stops.length - 1)) % stops.length]?.focus();
    } else if (event.key === "Tab") {
      anchor.current?.focus();
      close();
    } else if (typing) {
      return;
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      stops[event.key === "Home" ? 0 : stops.length - 1]?.focus();
    } else if (isTypeaheadKey(event)) {
      typed.current = typeaheadText(typed.current, event.key, event.timeStamp);
      const rows = stops.filter((stop) => !stop.matches("[data-conversations-query]"));
      const match = typeaheadMatch(rows.map((row) => row.textContent ?? ""), rows.indexOf(target), typed.current.text);
      if (match !== null) {
        event.preventDefault();
        rows[match]?.focus();
      }
    }
  };

  const label = t("botPanel.conversations.title");
  const shown = motion.value;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-chathead-threads
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${bot.name}`}
        title={open ? undefined : label}
        onClick={(event) => {
          if (open) { close(); return; }
          focusSheet.current = event.detail === 0;
          show();
        }}
        className={cn("flex shrink-0 items-center justify-center self-stretch rounded-full ps-1 pe-2.5 text-ink-tertiary hover:text-ink aria-expanded:text-ink", ELEVATED_TINT, className)}
      >
        <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {motion.shown && shown && createPortal(
        <div
          ref={sheet}
          role="dialog"
          aria-label={`${label}: ${bot.name}`}
          data-chathead-threads-sheet={bot.id}
          style={{ left: shown.left, top: shown.top, width: shown.width, maxHeight: `calc(100vh - ${shown.top + EDGE}px)` }}
          onKeyDown={onKeyDown}
          className={cn(MENU_SHEET, "fixed z-[60] gap-0 overflow-y-auto", motion.className)}
          {...motion.exitProps}
        >
          <BotConversations bot={bot} popover onPick={dismiss} />
        </div>,
        document.body,
      )}
    </>
  );
}
