import { Brain, Folder, Zap } from "lucide-react";

import { t } from "@/lib/i18n";
import { shortPath } from "@/lib/short-path";
import type { Bot } from "@/state/store";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { skillSwitchOn, useManagedSkills } from "../bot-settings/SkillsSection";
import type { SimplePageId } from "./page-registry";
import { Card, NavRow } from "./rows";
import { panelMemoryNotes } from "./memory-notes";
import { useMemoryDoc } from "./use-memory-doc";

export function KeepsCard({ bot, flat, onOpen }: { bot: Bot; flat?: boolean; onOpen: (page: SimplePageId) => void }) {
  const { capabilities } = useDesktopCapabilities();
  const skills = useManagedSkills(bot);
  const memory = useMemoryDoc(bot);
  const skillsOn = skills.skills.filter(skillSwitchOn).length;
  const notes = memory.docs ? panelMemoryNotes(memory.docs).length : null;
  const memoryValue = bot.memoryEnabled === false ? t("botPanel.memory.off")
    : notes === null ? (memory.error ? t("botPanel.memory.nothingYet") : undefined)
    : notes === 0 ? t("botPanel.memory.nothingYet")
    : notes === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count: notes });
  return (
    <Card anchor="keeps" flat={flat}>
      <NavRow data-panel-page="memory" icon={Brain} title={t("botPanel.memoryRow")} value={memoryValue} onClick={() => onOpen("memory")} />
      <NavRow
        data-panel-page="skills"
        icon={Zap}
        title={t("botSettings.simple.skills")}
        value={skills.loading ? undefined : skillsOn > 0 ? skillsOn : t("botPanel.none")}
        onClick={() => onOpen("skills")}
      />
      <NavRow
        data-panel-page="folder"
        icon={Folder}
        title={t("computer.files.folder")}
        value={bot.cwd ? shortPath(bot.cwd, capabilities.host?.homeDir) : t("botPanel.folder.private")}
        onClick={() => onOpen("folder")}
      />
    </Card>
  );
}
