import { useState } from "react";
import { Lock, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { setPanelVisibility, type Panel, type PanelVisibility } from "@/lib/panels";
import { PanelDialog } from "./PanelDialog";

export const panelVisibility = (panel: Pick<Panel, "visibility">): PanelVisibility => panel.visibility ?? "shared";

export function VisibilityChip({ visibility }: { visibility: PanelVisibility }) {
  const Icon = visibility === "private" ? Lock : Users;
  return (
    <span data-panel-visibility={visibility} className="ui-chip bg-ink/[0.06] text-ink-secondary">
      <Icon size={12} aria-hidden="true" />
      {visibility === "private" ? t("panels.visibility.private") : t("panels.visibility.shared")}
    </span>
  );
}

/** Who sees the panel: only the person and the bots on it, or everyone who sees the bot that made it. */
export function ShareDialog({ panel, makerName, onClose }: { panel: Panel; makerName?: string; onClose: () => void }) {
  const [choice, setChoice] = useState<PanelVisibility>(panelVisibility(panel));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const save = async () => {
    if (choice === panelVisibility(panel)) return onClose();
    setSaving(true);
    setProblem("");
    try {
      await setPanelVisibility(panel.id, choice);
      onClose();
    } catch (cause) {
      setSaving(false);
      setProblem(cause instanceof Error && cause.message ? cause.message : t("panels.share.failed"));
    }
  };
  const options: Array<{ value: PanelVisibility; label: string; hint: string; Icon: typeof Lock }> = [
    { value: "private", label: t("panels.visibility.private"), hint: t("panels.share.privateHint"), Icon: Lock },
    {
      value: "shared",
      label: t("panels.visibility.shared"),
      hint: makerName ? t("panels.share.sharedHint", { name: makerName }) : t("panels.share.sharedHintNoBot"),
      Icon: Users,
    },
  ];
  return (
    <PanelDialog
      title={t("panels.share.title")}
      onClose={onClose}
      footer={(
        <>
          {problem && <p role="alert" className="min-w-0 flex-1 text-[13px] text-danger">{problem}</p>}
          <div className="ms-auto flex gap-2">
            <button type="button" className="ui-button ui-button-md" onClick={onClose}>{t("common.cancel")}</button>
            <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={saving} aria-busy={saving || undefined} onClick={() => void save()}>
              {saving ? t("panels.share.saving") : t("common.save")}
            </button>
          </div>
        </>
      )}
    >
      <div role="radiogroup" aria-label={t("panels.share.title")} className="flex flex-col gap-2">
        {options.map(({ value, label, hint, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice === value}
            data-panel-share={value}
            onClick={() => setChoice(value)}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              setChoice(value === "private" ? "shared" : "private");
              (event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-panel-share="${value === "private" ? "shared" : "private"}"]`))?.focus();
            }}
            tabIndex={choice === value ? 0 : -1}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-start transition-colors hover:bg-ink/[0.04] motion-reduce:transition-none",
              choice === value ? "border-accent" : "border-hairline/40",
            )}
          >
            <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-medium leading-[18px] text-ink">{label}</span>
              <span className="text-[12px] leading-4 text-ink-tertiary">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    </PanelDialog>
  );
}
