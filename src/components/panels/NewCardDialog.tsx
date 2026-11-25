import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, ChevronLeft, LoaderCircle, Pin } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import {
  PANEL_CADENCES, PANEL_CARD_FORMATS, PANEL_CARD_SIZES, cardUpdating, keepCard, newCard, pinBlock, pinnableBlocks, removeCard, usePanelList,
  type Panel, type PanelCadence, type PanelCard as Card, type PanelCardFormat, type PanelCardSize, type PanelPinnableBlock,
} from "@/lib/panels";
import type { Bot } from "@/state/store";
import { Select } from "../Select";
import { PanelCard, panelCardState } from "./PanelCard";
import { PanelDialog } from "./PanelDialog";

const FORMAT_LABEL: Record<PanelCardFormat, string> = {
  auto: "panels.format.auto", kpi: "panels.format.kpi", goal: "panels.format.goal", line: "panels.format.line",
  bar: "panels.format.bar", checklist: "panels.format.checklist", text: "panels.format.text",
};
const SIZE_LABEL: Record<PanelCardSize, string> = { s: "panels.card.sizeSmall", m: "panels.card.sizeMedium", l: "panels.card.sizeLarge" };
const CADENCE_LABEL: Record<PanelCadence, string> = {
  "on-request": "panels.cadence.onRequest", hourly: "panels.cadence.hourly", daily: "panels.cadence.daily", weekly: "panels.cadence.weekly",
};
const label = (key: string) => t(key as Parameters<typeof t>[0]);

type Draft = { cardId: string; with: string };

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

/** New card: say what to keep track of, test it here with the bot that will keep it, then add it. Closing before adding
 * drops the test card. */
export function NewCardDialog({ panel, bots, onClose }: { panel: Panel; bots: ReadonlyArray<Bot>; onClose: () => void }) {
  const suggested = bots.some((bot) => bot.id === panel.createdBy.botId) ? panel.createdBy.botId : bots[0]?.id ?? "";
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<PanelCardFormat>("auto");
  const [size, setSize] = useState<PanelCardSize>("m");
  const [botId, setBotId] = useState(suggested);
  const [cadence, setCadence] = useState<PanelCadence>("hourly");
  const [notify, setNotify] = useState(false);
  const [target, setTarget] = useState(panel.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [pinning, setPinning] = useState(false);
  const { panels } = usePanelList();
  const field = useRef<HTMLTextAreaElement>(null);
  const kept = useRef(false);
  const live = useRef<Draft | null>(null);
  live.current = draft;
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => () => {
    if (live.current && !kept.current) void removeCard(panel.id, live.current.cardId).catch(() => undefined);
  }, [panel.id]);

  const request = { prompt: prompt.trim(), ...(title.trim() ? { title: title.trim() } : {}), format, size, botId, cadence, notify };
  const asked = JSON.stringify(request);
  const tested = draft !== null && draft.with === asked;
  const draftCard: Card | undefined = draft ? panel.cards.find((card) => card.id === draft.cardId) : undefined;
  const botName = bots.find((bot) => bot.id === botId)?.name ?? "";

  const test = async () => {
    if (!request.prompt || !botId || busy) return;
    setBusy(true);
    setProblem("");
    try {
      if (draft) await removeCard(panel.id, draft.cardId).catch(() => undefined);
      setDraft(null);
      const result = await newCard(panel.id, { ...request, test: true });
      setDraft({ cardId: result.card.id, with: asked });
    } catch (cause) {
      setProblem(errorText(cause, t("panels.new.testFailed")));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setProblem("");
    try {
      await keepCard(panel.id, draft.cardId, target);
      kept.current = true;
      onClose();
    } catch (cause) {
      setBusy(false);
      setProblem(errorText(cause, t("panels.new.addFailed")));
    }
  };

  const targets = panels && panels.some((item) => item.id === panel.id) ? panels : [{ id: panel.id, title: panel.title }];
  const footer = (
    <>
      <label className="flex min-w-0 items-center gap-2 text-[13px] text-ink-secondary">
        <span className="shrink-0">{t("panels.new.addTo")}</span>
        <Select variant="pill" size="sm" value={target} onChange={(event) => setTarget(event.target.value)} className="min-w-0 max-w-[200px]" aria-label={t("panels.new.addTo")}>
          {targets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </Select>
      </label>
      <div className="ms-auto flex gap-2">
        <button type="button" className="ui-button ui-button-md" onClick={onClose}>{t("common.cancel")}</button>
        {tested ? (
          <button type="button" data-panel-new="add" className="ui-button ui-button-md ui-button-primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void add()}>
            {busy ? t("panels.new.adding") : t("panels.new.add")}
          </button>
        ) : (
          <button type="button" data-panel-new="test" className="ui-button ui-button-md ui-button-primary" disabled={busy || !request.prompt || !botId} aria-busy={busy || undefined} onClick={() => void test()}>
            {busy ? t("panels.new.testing") : draft ? t("panels.new.testAgain") : t("panels.new.test")}
          </button>
        )}
      </div>
    </>
  );

  if (pinning) return <PinView panel={panel} target={target} size={size} bots={bots} onBack={() => setPinning(false)} onClose={onClose} />;

  return (
    <PanelDialog title={t("panels.new.title")} onClose={onClose} footer={footer} wide>
      <p className="mb-3 text-[13px] leading-[18px] text-ink-secondary">{t("panels.new.subtitle")}</p>
      <div data-panel-new-draft className="flex flex-col gap-3 rounded-xl border border-hairline/40 bg-card p-4">
        <div className="flex min-w-0 items-center gap-2">
          <input
            dir="auto"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            aria-label={t("panels.new.titleLabel")}
            placeholder={botName ? t("panels.new.titlePlaceholder", { name: botName }) : t("panels.new.titleLabel")}
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-[18px] text-ink outline-none placeholder:text-ink-tertiary"
          />
          <button
            type="button"
            aria-pressed={notify}
            data-panel-new-notify
            onClick={() => setNotify(!notify)}
            title={t("panels.new.notifyHint")}
            className={cn("ui-button ui-button-sm ui-button-ghost inline-flex shrink-0 items-center gap-1.5", notify && "text-ink")}
          >
            {notify ? <Bell size={14} aria-hidden="true" /> : <BellOff size={14} aria-hidden="true" />}
            {t("panels.new.notify")}
          </button>
        </div>
        <textarea
          ref={field}
          dir="auto"
          rows={2}
          value={prompt}
          maxLength={2000}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void (tested ? add() : test()); } }}
          aria-label={t("panels.new.promptLabel")}
          placeholder={t("panels.new.promptLabel")}
          className="min-h-12 w-full resize-none bg-transparent text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-tertiary"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select variant="pill" size="sm" value={format} onChange={(event) => setFormat(event.target.value as PanelCardFormat)} aria-label={t("panels.new.format")}>
            {PANEL_CARD_FORMATS.map((item) => <option key={item} value={item}>{label(FORMAT_LABEL[item])}</option>)}
          </Select>
          <Select variant="pill" size="sm" value={size} onChange={(event) => setSize(event.target.value as PanelCardSize)} aria-label={t("panels.card.size")}>
            {PANEL_CARD_SIZES.map((item) => <option key={item} value={item}>{label(SIZE_LABEL[item])}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select variant="pill" size="sm" value={botId} onChange={(event) => setBotId(event.target.value)} aria-label={t("panels.new.bot")}>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>{bot.id === suggested ? t("panels.new.botSuggested", { name: bot.name }) : bot.name}</option>
            ))}
          </Select>
          <Select variant="pill" size="sm" value={cadence} onChange={(event) => setCadence(event.target.value as PanelCadence)} aria-label={t("panels.new.cadence")}>
            {PANEL_CADENCES.map((item) => <option key={item} value={item}>{label(CADENCE_LABEL[item])}</option>)}
          </Select>
        </div>
      </div>
      {draft && (
        <section aria-label={t("panels.new.preview")} data-panel-new-preview className="mt-4 flex flex-col gap-2">
          <h3 className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("panels.new.preview")}</h3>
          {draftCard ? (
            <PanelCard
              card={draftCard}
              state={panelCardState(draftCard, cardUpdating(panel, draftCard))}
              bot={bots.find((bot) => bot.id === draftCard.botId)}
              cadence={label(CADENCE_LABEL[cadence])}
              bare
              onResize={() => undefined}
              onRemove={() => undefined}
            />
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-ink-tertiary">
              <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              {t("panels.card.waiting")}
            </p>
          )}
          {!tested && <p className="text-[12px] leading-4 text-ink-tertiary">{t("panels.new.changedSinceTest")}</p>}
        </section>
      )}
      {problem && <p role="alert" className="mt-3 text-[13px] text-danger">{problem}</p>}
      <button type="button" data-panel-new-pin onClick={() => setPinning(true)} className="ui-button ui-button-sm ui-button-ghost mx-auto mt-4 inline-flex items-center gap-1.5">
        <Pin size={14} aria-hidden="true" />
        {t("panels.new.pinInstead")}
      </button>
    </PanelDialog>
  );
}

/** A widget a bot already posted in a chat, put on the panel as it is. */
function PinView({ panel, target, size, bots, onBack, onClose }: {
  panel: Panel;
  target: string;
  size: PanelCardSize;
  bots: ReadonlyArray<Bot>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [blocks, setBlocks] = useState<PanelPinnableBlock[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const load = () => {
    setFailed(false);
    pinnableBlocks().then(setBlocks).catch(() => setFailed(true));
  };
  useEffect(load, []);
  const pin = async (block: PanelPinnableBlock) => {
    setBusy(`${block.threadId}/${block.messageId}`);
    setProblem("");
    try {
      await pinBlock(target || panel.id, block, size);
      onClose();
    } catch (cause) {
      setBusy("");
      setProblem(errorText(cause, t("panels.pin.failed")));
    }
  };
  return (
    <PanelDialog
      title={t("panels.pin.title")}
      onClose={onClose}
      wide
      footer={(
        <button type="button" className="ui-button ui-button-md inline-flex items-center gap-1" onClick={onBack}>
          <ChevronLeft size={16} aria-hidden="true" className="rtl:-scale-x-100" />
          {t("panels.pin.back")}
        </button>
      )}
    >
      {problem && <p role="alert" className="mb-3 text-[13px] text-danger">{problem}</p>}
      {failed ? (
        <div role="alert" className="py-8 text-center">
          <p className="text-[13px] text-ink-secondary">{t("panels.pin.loadFailed")}</p>
          <button type="button" className="ui-button mt-3" onClick={load}>{t("common.tryAgain")}</button>
        </div>
      ) : blocks === null ? (
        <p className="flex items-center gap-2 py-8 text-[13px] text-ink-tertiary"><LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />{t("panels.pin.loading")}</p>
      ) : blocks.length === 0 ? (
        <p data-panel-pin-empty className="py-8 text-center text-[13px] text-ink-secondary">{t("panels.pin.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={t("panels.pin.title")}>
          {blocks.map((block) => {
            const key = `${block.threadId}/${block.messageId}`;
            const at = Date.parse(block.at);
            const bot = bots.find((item) => item.id === block.botId);
            return (
              <li key={key}>
                <button
                  type="button"
                  data-panel-pin={key}
                  disabled={busy !== ""}
                  aria-busy={busy === key || undefined}
                  onClick={() => void pin(block)}
                  className="flex w-full min-w-0 flex-col gap-0.5 rounded-xl border border-hairline/40 px-3.5 py-2.5 text-start transition-colors hover:bg-ink/[0.04] disabled:opacity-50 motion-reduce:transition-none"
                >
                  <bdi dir="auto" className="truncate text-[13px] font-medium leading-[18px] text-ink">{block.title}</bdi>
                  {block.text && <span dir="auto" className="line-clamp-2 text-[12px] leading-4 text-ink-secondary">{block.text}</span>}
                  <span className="truncate text-[12px] leading-4 text-ink-tertiary">
                    {[bot?.name, Number.isFinite(at) ? relativeTime(at) : ""].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelDialog>
  );
}
