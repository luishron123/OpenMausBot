import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Bell, ExternalLink, RefreshCw, Trash2, X } from "lucide-react";

import { lastWhen, nextWhen } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  askCardChange, cardAutomation, cardHistory, cardUpdating, clearCardAlert, refreshCard, resolveCard,
  type Panel, type PanelCard as Card, type PanelCardUpdate,
} from "@/lib/panels";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { PanelCard, cardCadence, panelCardState } from "./PanelCard";

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

/** US$ as the person's language writes it, a cent at least, so a tiny run doesn't read as free. */
export function usd(amount: number): string {
  const format = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount > 0 && amount < 0.01 ? t("panels.cost.underCent", { amount: format(0.01) }) : format(amount);
}

const tokens = (count: number) => t("panels.history.tokens", { count: count.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 }) });

const isUrl = (text: string) => /^https?:\/\//i.test(text);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-hairline/40 px-4 py-3.5">
      <h3 className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function History({ panelId, card }: { panelId: string; card: Card }) {
  const [updates, setUpdates] = useState<PanelCardUpdate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    cardHistory(panelId, card.id)
      .then((list) => { if (alive) setUpdates(list); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [panelId, card.id, card.updatedAt, card.failedAt, round]);
  if (failed && !updates) {
    return (
      <p role="alert" className="flex items-center gap-2 text-[13px] text-ink-secondary">
        {t("panels.history.loadFailed")}
        <button type="button" className="ui-button ui-button-sm" onClick={() => setRound(round + 1)}>{t("common.tryAgain")}</button>
      </p>
    );
  }
  if (!updates) return <p className="text-[13px] text-ink-tertiary">{t("panels.history.loading")}</p>;
  if (updates.length === 0) return <p data-panel-history-empty className="text-[13px] text-ink-tertiary">{t("panels.history.empty")}</p>;
  return (
    <ol data-panel-history className="flex flex-col">
      {updates.map((update, index) => {
        const at = Date.parse(update.at);
        const cost = [
          update.costUsd !== undefined ? usd(update.costUsd) : "",
          update.tokens !== undefined ? tokens(update.tokens) : "",
        ].filter(Boolean).join(" · ");
        return (
          <li key={`${update.at}-${index}`} data-panel-history-item className="flex gap-2.5 border-b border-hairline/30 py-2.5 last:border-b-0">
            <span aria-hidden="true" className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", update.status === "failed" ? "bg-danger" : "bg-success")} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p dir="auto" className={cn("text-[13px] leading-[18px]", update.status === "failed" ? "text-danger" : "text-ink")}>
                <span className="sr-only">{update.status === "failed" ? t("panels.history.failed") : t("panels.history.ok")}: </span>
                {update.status === "failed" ? update.failure ?? t("panels.card.failedShort") : update.summary ?? t("panels.history.noSummary")}
              </p>
              {update.change && <p dir="auto" className="text-[12px] leading-4 text-ink-secondary">{t("panels.history.asked", { text: update.change })}</p>}
              {update.alert && (
                <p dir="auto" className="flex items-center gap-1 text-[12px] leading-4 text-ink-secondary">
                  <Bell aria-hidden="true" size={11} className="shrink-0 text-warning" />{update.alert}
                </p>
              )}
              <p className="text-[12px] leading-4 text-ink-tertiary">
                {Number.isFinite(at) ? lastWhen(at) : ""}
                {cost && <span data-panel-history-cost>{Number.isFinite(at) ? " · " : ""}{cost}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A card opened from the panel: shown large, with what keeps it, its alert and sources, its last updates and cost, and
 * Refresh now, Ask for a change and Remove. */
export function CardSidePanel({ panel, card, bots, onClose, onRemove }: {
  panel: Panel;
  card: Card;
  bots: ReadonlyArray<Bot>;
  onClose: () => void;
  onRemove: (card: Card) => void;
}) {
  const [asking, setAsking] = useState("");
  const [busy, setBusy] = useState<"" | "refresh" | "change" | "alert" | "resolve">("");
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState("");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, [card.id]);
  useEffect(() => { setAsking(""); setSaid(""); setProblem(""); }, [card.id]);

  const bot = bots.find((item) => item.id === card.botId);
  const automation = cardAutomation(panel, card);
  const updating = cardUpdating(panel, card);
  const state = panelCardState(card, updating);
  const next = automation?.enabled && automation.nextRunAt ? Date.parse(automation.nextRunAt) : NaN;
  const manual = card.schedule === "manual" || (!card.schedule && !automation);

  const run = async (kind: typeof busy, action: () => Promise<void>, done: string, fallback: string) => {
    setBusy(kind);
    setProblem("");
    setSaid("");
    try {
      await action();
      setSaid(done);
      return true;
    } catch (cause) {
      setProblem(errorText(cause, fallback));
      return false;
    } finally {
      setBusy("");
    }
  };
  const ask = async () => {
    const text = asking.trim();
    if (!text || busy) return;
    if (await run("change", () => askCardChange(panel.id, card.id, text), t("panels.side.changeSent", { name: bot?.name ?? t("panels.side.theBot") }), t("panels.side.changeFailed"))) setAsking("");
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      aria-label={t("panels.side.label", { name: card.title })}
      data-panel-side={card.id}
      onKeyDown={keys}
      className="animate-panel-in flex h-full w-[400px] max-w-full shrink-0 flex-col border-s border-hairline/40 bg-panel max-md:absolute max-md:inset-y-0 max-md:end-0 max-md:z-30"
    >
      <div className="flex items-center gap-2 border-b border-hairline/40 px-4 py-3">
        <h2 dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{card.title}</h2>
        <button ref={close} type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="ui-icon-button ui-button-ghost flex size-8 items-center justify-center">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          <PanelCard
            card={card}
            state={state}
            bot={bot}
            cadence={cardCadence(panel, card)}
            bare
            onResize={() => {}}
            onRemove={() => onRemove(card)}
            onResolve={() => run("resolve", () => resolveCard(panel.id, card.id), t("panels.side.resolved"), t("panels.card.resolveFailed")).then(() => {})}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3.5">
          <button
            type="button"
            data-panel-side-action="refresh"
            disabled={busy !== "" || updating}
            aria-busy={busy === "refresh" || updating || undefined}
            onClick={() => void run("refresh", () => refreshCard(panel.id, card.id), t("panels.side.refreshStarted"), t("panels.refreshFailed"))}
            className="ui-button ui-button-sm inline-flex items-center gap-1.5"
          >
            <RefreshCw aria-hidden="true" size={13} className={cn((busy === "refresh" || updating) && "animate-spin motion-reduce:animate-none")} />
            {updating ? t("panels.card.updating") : t("panels.refreshNow")}
          </button>
          <button type="button" data-panel-side-action="remove" onClick={() => onRemove(card)} className="ui-button ui-button-sm ui-button-ghost inline-flex items-center gap-1.5 text-danger">
            <Trash2 aria-hidden="true" size={13} />
            {t("panels.card.remove")}
          </button>
        </div>
        <p aria-live="polite" className={cn("px-4 text-[12px] leading-4 text-ink-secondary", said ? "pb-3" : "sr-only")}>{said}</p>
        {problem && <p role="alert" className="px-4 pb-3 text-[12px] leading-4 text-danger">{problem}</p>}

        <Section title={t("panels.side.changeTitle")}>
          <textarea
            dir="auto"
            value={asking}
            rows={2}
            maxLength={2000}
            aria-label={t("panels.side.changeTitle")}
            placeholder={t("panels.side.changePlaceholder")}
            onChange={(event) => setAsking(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void ask(); } }}
            className="w-full resize-y rounded-lg border border-hairline/60 bg-app px-3 py-2 text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
          />
          <div className="flex justify-end">
            <button type="button" data-panel-side-action="change" disabled={!asking.trim() || busy !== ""} aria-busy={busy === "change" || undefined} onClick={() => void ask()} className="ui-button ui-button-sm ui-button-primary">
              {busy === "change" ? t("panels.side.changeSending") : t("panels.side.changeSend")}
            </button>
          </div>
        </Section>

        <Section title={t("panels.side.automationTitle")}>
          <div data-panel-side-automation className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] text-ink-secondary">
            {bot && <BotAvatar bot={bot} size={18} />}
            <span className="min-w-0">
              {bot && <bdi dir="auto" className="font-medium text-ink">{bot.name}</bdi>}
              {bot && <span aria-hidden="true"> · </span>}
              {cardCadence(panel, card)}
              <span aria-hidden="true"> · </span>
              {manual
                ? t("panels.side.onlyWhenAsked")
                : Number.isFinite(next) ? t("panels.automation.next", { when: nextWhen(next) }) : t("panels.automation.paused")}
            </span>
          </div>
          {card.prompt && <p dir="auto" className="text-[12px] leading-4 text-ink-tertiary">{t("panels.side.tracks", { prompt: card.prompt })}</p>}
        </Section>

        <Section title={t("panels.side.alertTitle")}>
          {card.alertActive && (
            <div data-panel-side-alert className="flex items-start gap-2 rounded-lg bg-warning/10 px-2.5 py-2 text-[13px] leading-[18px] text-ink">
              <Bell aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-warning" />
              <span dir="auto" className="min-w-0 flex-1">{card.alertActive.text}</span>
              <button
                type="button"
                disabled={busy !== ""}
                onClick={() => void run("alert", () => clearCardAlert(panel.id, card.id), t("panels.side.alertCleared"), t("panels.card.changeFailed"))}
                className="ui-button ui-button-sm shrink-0"
              >
                {t("panels.side.alertClear")}
              </button>
            </div>
          )}
          <p dir="auto" className="text-[13px] leading-[18px] text-ink-secondary">
            {card.alert ? t("panels.side.alertWhen", { condition: card.alert }) : t("panels.side.alertNone")}
          </p>
        </Section>

        {(card.sources ?? []).length > 0 && (
          <Section title={t("panels.side.sourcesTitle")}>
            <ul data-panel-side-sources className="flex flex-col gap-1">
              {card.sources!.map((source) => (
                <li key={source} className="min-w-0 text-[13px] leading-[18px] text-ink-secondary">
                  {isUrl(source) ? (
                    <a href={source} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-accent-text hover:underline">
                      <span className="truncate">{source.replace(/^https?:\/\/(www\.)?/i, "")}</span>
                      <ExternalLink aria-hidden="true" size={11} className="shrink-0" />
                    </a>
                  ) : <span dir="auto" className="break-words">{source}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={t("panels.side.historyTitle")}>
          <History panelId={panel.id} card={card} />
        </Section>
      </div>
    </aside>
  );
}
