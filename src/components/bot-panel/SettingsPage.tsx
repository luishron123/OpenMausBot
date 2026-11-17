import { useState } from "react";
import { AppWindow, AudioLines, ExternalLink, Eye, Slack, Tag } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { CALL_MODES, callModeHint, effectiveCallMode, setCallMode, useCallMode, type CallMode } from "@/lib/call-mode";
import { callCapabilityHelp } from "@/lib/call-capability";
import { fishListeningReady, listensHere, speechBridge } from "@/lib/speech";
import { useStore, type Bot } from "@/state/store";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { DefaultBotHideRow } from "../DefaultBotControls";
import { BotApiCard } from "../bot-settings/BotApiCard";
import { PackageProvenance } from "../bot-settings/PackageProvenance";
import { useChoosesVisibility, visibilityLabel } from "../bot-settings/VisibilitySection";
import { useBotApps } from "../bot-settings/useBotApps";
import { useSlackManagementUrl } from "../bot-settings/useSlackManagement";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { AdvancedSettingsRow } from "./AdvancedSettingsRow";
import { BackupAis } from "./BackupAis";
import { ComputerSection } from "./ComputerSection";
import { HeavyBotRow } from "./HeavyBotRow";
import type { SimplePageId } from "./page-registry";
import { Card, ColRow, NavRow, RowIcon, rowCls, RowText, Segmented, type SegmentOption } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

export function SettingsPage({ bot, derived, onOpen }: {
  bot: Bot;
  derived: Derived;
  onOpen?: (page: SimplePageId) => void;
}) {
  const { state } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const apps = useBotApps(bot);
  const { servers: allServers } = useMcpServers();
  const storedCallMode = useCallMode();
  const slackUrl = useSlackManagementUrl(bot.id);
  const choosesVisibility = useChoosesVisibility();
  const [jobDraft, setJobDraft] = useState<string | null>(null);
  const { patch } = derived;
  const commitJob = () => {
    if (jobDraft !== null && jobDraft.trim() !== bot.title.trim()) patch({ title: jobDraft.trim() });
    setJobDraft(null);
  };

  // As the call button: where this device cannot listen in turns, a call is always Live.
  const turnsHere = !ready || listensHere(capabilities, state.config);
  const callMode = effectiveCallMode(storedCallMode, { turnsHere, canLive: true });
  const turnsHelp = turnsHere ? null : callCapabilityHelp(capabilities, Boolean(speechBridge()?.speechStart), fishListeningReady(state.config));
  const callOptions: SegmentOption<CallMode>[] = CALL_MODES.map((entry) => ({
    value: entry.id,
    label: t(entry.label),
    disabled: entry.id === "turns" && turnsHelp !== null,
    tooltip: entry.id === "turns" && turnsHelp ? `${turnsHelp.label}. ${turnsHelp.reason}` : entry.id === "live" ? t("call.mode.liveHint") : callModeHint("turns"),
  }));

  const enabledApps = [
    ...apps.apps.filter((app) => app.scope !== null).map((app) => app.label),
    ...(allServers ? mcpServersForBot(allServers, bot.mcpServers, bot.id).map((server) => server.name) : []),
  ];

  return (
    <div data-panel-settings>
      <PackageProvenance bot={bot} />
      <ComputerSection bot={bot} derived={derived} onOpen={onOpen} />

      <HeavyBotRow bot={bot} />

      <BackupAis bot={bot} onChange={(fallback) => patch({ fallback })} />

      <Card anchor="call">
        <ColRow data-panel-row="call-mode">
          <div className="flex items-center gap-2.5">
            <RowIcon icon={AudioLines} />
            <RowText title={t("call.mode.menu")} />
          </div>
          <div className="pl-[38px]">
            <Segmented attr="data-call-mode" label={t("call.mode.menu")} value={callMode} onChange={setCallMode} options={callOptions} />
          </div>
        </ColRow>
      </Card>

      <Card anchor="uses">
        <NavRow
          data-panel-page="apps"
          icon={AppWindow}
          title={t("botPanel.appsRow")}
          value={enabledApps.length > 0 ? enabledApps.join(", ") : t("botPanel.appsNoneYet")}
          onClick={() => onOpen?.("apps")}
        />
        <label data-panel-row="job" className={cn(rowCls, "cursor-text")}>
          <RowIcon icon={Tag} />
          <span className="shrink-0 text-[14px] font-medium text-ink">{t("botSettings.simple.job")}</span>
          <input
            data-panel-job
            value={jobDraft ?? bot.title}
            placeholder={t("botSettings.simple.jobPlaceholder")}
            aria-label={t("botSettings.simple.job")}
            maxLength={BOT_PROFILE_LIMITS.title}
            onChange={(event) => setJobDraft(event.target.value)}
            onBlur={commitJob}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape" && jobDraft !== null) {
                event.preventDefault();
                event.stopPropagation();
                setJobDraft(null);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-right text-[13px] text-ink-secondary outline-none placeholder:text-ink-tertiary focus:text-ink"
          />
        </label>
        {slackUrl && (
          <a data-panel-row="slack" href={slackUrl} target="_blank" rel="noopener noreferrer" className={cn(rowCls, "hover:bg-ink/[0.03]")}>
            <RowIcon icon={Slack} />
            <RowText title={t("botPanel.page.slack")} hint={t("botSlack.manage")} />
            <ExternalLink size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          </a>
        )}
        {choosesVisibility && (
          <NavRow
            data-panel-page="visibility"
            icon={Eye}
            title={t("botSettings.visibility.title")}
            value={visibilityLabel(bot.visibility)}
            onClick={() => onOpen?.("visibility")}
          />
        )}
      </Card>

      <AdvancedSettingsRow />

      <BotApiCard bot={bot} webhooksLink className="mt-3.5" />

      <DefaultBotHideRow bot={bot} />
    </div>
  );
}
