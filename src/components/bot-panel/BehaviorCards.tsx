import { Bell, ChevronRight, FileText, MessageSquareText, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { requestNotificationPermission } from "@/lib/notify";
import { firstSentence } from "@/lib/soul";
import { currentTaskBot, useStore, type Bot } from "@/state/store";
import type { ApprovalMode } from "../../../shared/approval-mode";
import { REPLY_STYLES, type ReplyStyle } from "../../../shared/reply-style";
import { ApprovalChip } from "../ComposerPlusMenu";
import { SoulField } from "../SoulField";
import { REPLY_STYLE_LABELS } from "../bot-settings/ReplyStyleField";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { useThreadApproval } from "../thread-approval";
import { SoulChanges } from "./SoulChanges";
import { buttonCls, Card, ColRow, RowIcon, rowCls, RowText, Segmented, SwitchRow, TrashButton, type SegmentOption } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

const ACTS_LABEL: Record<ApprovalMode, () => string> = {
  ask: () => t("botSettings.simple.ask"),
  full: () => t("botSettings.simple.justDoIt"),
  auto: () => t("botSettings.simple.decide"),
  edits: () => t("approvalMode.edits.label"),
  custom: () => t("botPanel.acts.custom"),
};

export function InstructionsCard({ bot, derived, editing = false, onEdit }: {
  bot: Bot;
  derived: Derived;
  editing?: boolean;
  onEdit?: (open: boolean) => void;
}) {
  const { flushBotPatches } = useStore();
  const name = bot.name;
  const soulOpen = editing || Boolean(bot.soulDrift);
  return (
    <Card anchor="instructions" flat>
      {soulOpen ? (
        <ColRow data-panel-row="soul">
          <SoulField
            bot={bot}
            onPatch={derived.patch}
            simple={{
              label: t("botSettings.simple.instructions"),
              placeholder: t("botSettings.simple.instructionsPlaceholder", { name }),
            }}
          />
          <SoulChanges bot={bot} />
          {editing && (
            <div className="flex justify-end">
              <button type="button" data-panel-done="soul" onClick={() => { void flushBotPatches(bot.id); onEdit?.(false); }} className={buttonCls}>
                {t("botSettings.simple.done")}
              </button>
            </div>
          )}
        </ColRow>
      ) : (
        <button
          type="button"
          data-panel-edit="soul"
          aria-label={`${t("botSettings.simple.edit")}: ${t("botSettings.simple.instructions")}`}
          onClick={() => onEdit?.(true)}
          className={cn(rowCls, "w-full text-left hover:bg-ink/[0.04]")}
        >
          <RowIcon icon={FileText} />
          <RowText
            title={t("botSettings.simple.instructions")}
            hint={<span className="line-clamp-1">{firstSentence(bot.soul ?? "") || t("botPanel.instructionsHint", { name })}</span>}
          />
          <ChevronRight size={15} className="shrink-0 text-ink-tertiary rtl:-scale-x-100" aria-hidden="true" />
        </button>
      )}
    </Card>
  );
}

export function ApprovalCard({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { dispatch } = useStore();
  const approval = useThreadApproval(currentTaskBot(bot));
  const { patch, approvalMode, engine } = derived;
  const name = bot.name;

  // Antigravity's old Auto still executes as Ask: show that without changing the saved mode or granting Full.
  const displayedMode: ApprovalMode = engine?.driverKind === "antigravityAgent" && approvalMode === "auto" ? "ask" : approvalMode;
  const actsOptions: SegmentOption<ApprovalMode>[] = [
    { value: "ask", label: ACTS_LABEL.ask(), tooltip: t("botSettings.simple.askHint") },
    { value: "full", label: ACTS_LABEL.full(), tooltip: t("botSettings.simple.fullHint") },
    ...(displayedMode === "ask" || displayedMode === "full"
      ? []
      : [{ value: displayedMode, label: ACTS_LABEL[displayedMode](), disabled: true, tooltip: displayedMode === "custom" ? t("botPanel.acts.customHint") : undefined }]),
  ];
  const chooseActs = (mode: ApprovalMode) => {
    if (mode === approvalMode || (mode !== "ask" && mode !== "full")) return;
    dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: mode, applyToAllThreads: true } });
  };
  const alwaysAllow = bot.alwaysAllow ?? [];

  return (
    <Card anchor="approval" flat>
      <ColRow data-panel-row="approval">
        <div className="flex items-center gap-2.5">
          <RowIcon icon={ShieldCheck} />
          <RowText title={t("botSettings.simple.beforeActs", { name })} hint={bot.busy ? t("approvalMode.whileWorking") : undefined} />
        </div>
        <div className="pl-[38px]">
          <Segmented
            attr="data-approval-choice"
            label={t("botSettings.simple.beforeActs", { name })}
            value={displayedMode}
            onChange={chooseActs}
            options={actsOptions}
          />
        </div>
        {approval.choice && (
          <div data-panel-row="thread-approval" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-[38px]">
            <span className="text-[13px] text-ink-secondary">{t("botPanel.thisConversation")}</span>
            <span className="ms-auto flex">
              <ApprovalChip choice={approval.choice} />
            </span>
          </div>
        )}
        {alwaysAllow.length > 0 && (
          <div data-panel-row="always-allow" className="flex min-w-0 flex-col gap-1 pl-[38px]">
            <span className="text-[13px] text-ink-secondary">{t("botAccess.always.title")}</span>
            {alwaysAllow.map((entry) => (
              <div key={entry} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{entry}</span>
                <TrashButton
                  data-panel-action={`always-allow:${entry}`}
                  label={t("botAccess.always.remove", { entry })}
                  onClick={() => patch({ alwaysAllow: alwaysAllow.filter((key) => key !== entry) })}
                />
              </div>
            ))}
          </div>
        )}
      </ColRow>
      {approval.dialogs}
    </Card>
  );
}

export function RepliesCard({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { patch } = derived;
  const replyOptions: SegmentOption<ReplyStyle>[] = REPLY_STYLES.map((style) => ({
    value: style,
    label: t(REPLY_STYLE_LABELS[style][0]),
    tooltip: t(REPLY_STYLE_LABELS[style][1]),
  }));
  const toggleNotifications = () => {
    const enabled = !bot.notifications;
    if (enabled) void requestNotificationPermission();
    patch({ notifications: enabled });
  };
  return (
    <Card anchor="replies" flat>
      <ColRow data-panel-row="reply-style">
        <div className="flex items-center gap-2.5">
          <RowIcon icon={MessageSquareText} />
          <RowText title={t("botSettings.replyStyle.title")} />
        </div>
        <div className="pl-[38px]">
          <Segmented
            attr="data-reply-style"
            label={t("botSettings.replyStyle.title")}
            value={bot.replyStyle ?? "default"}
            onChange={(style) => patch({ replyStyle: style })}
            options={replyOptions}
          />
        </div>
      </ColRow>
      <SwitchRow
        data-panel-row="notifications"
        icon={Bell}
        title={t("voice.notifications.title")}
        color={bot.color}
        checked={bot.notifications}
        onChange={toggleNotifications}
      />
    </Card>
  );
}
