import { X } from "lucide-react";
import type { Message } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/relative-time";
import { hasUnreadContextContent, unreadContextCitations, unreadContextContent, type UnreadContextAttachment } from "@/lib/unread-context";

function attachmentLabel(kind: UnreadContextAttachment): string {
  if (kind === "images") return t("chat.unreadContext.images");
  if (kind === "files") return t("chat.unreadContext.files");
  return `${t("chat.unreadContext.images")} / ${t("chat.unreadContext.files")}`;
}

/** The message that started the turn waiting above the unread divider, shown at the top of the conversation. */
export function UnreadContextCard({
  message,
  onJump,
  onClose,
}: {
  message: Message;
  onJump: () => void;
  onClose: () => void;
}) {
  const content = unreadContextContent(message);
  if (!hasUnreadContextContent(content)) return null;
  const { shown: citations, hidden: hiddenCitations } = unreadContextCitations(content.citations);
  return (
    <div className="w-full px-4" data-unread-context-card data-testid="unread-context-card">
      <div data-unread-context-surface className="chat-column mb-2 rounded-xl border border-hairline/40 bg-panel px-3 py-2">
        <div className="flex items-center gap-2">
          <div data-unread-context-header className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate text-[12px] leading-4 font-medium text-ink-secondary">{t("chat.unreadContext.title")}</span>
            <span className="shrink-0 text-[12px] leading-4 text-ink-tertiary">{localizedRelativeTime(message.at, activeLocale())}</span>
          </div>
          <div data-unread-context-actions className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onJump} className="ui-button ui-button-sm touch:min-h-10">
              {t("chat.citation.goToSource")}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              title={t("common.close")}
              className="ui-icon-button size-6 min-h-0 p-0 touch:size-10"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* Each part carries its own line limit, so the card grows to fit them instead of cutting a citation in half. */}
        <div className="mt-0.5" data-unread-context-body>
          {content.text && (
            <div dir="auto" data-unread-context-text className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-[18px] text-ink">
              {content.text}
            </div>
          )}
          {citations.map((citation) => (
            <div key={citation.id} className="mt-1.5 rounded-md border border-accent/20 bg-accent/[0.05] px-2.5 py-1.5" data-unread-context-citation>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{t("chat.citation.quoted")}</div>
              <div dir="auto" data-unread-context-quote className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink">{citation.quote}</div>
              {citation.comment && (
                <div data-unread-context-comment className="mt-1 line-clamp-2 text-[12px] text-ink-secondary">
                  <span className="font-semibold">{t("chat.citation.comment")}</span> {citation.comment}
                </div>
              )}
            </div>
          ))}
          {content.attachment && (
            <div className="mt-1 text-[13px] text-ink-secondary">{attachmentLabel(content.attachment)}</div>
          )}
        </div>
        {hiddenCitations > 0 && (
          <div className="mt-1 text-[12px] leading-4 text-ink-tertiary">{t("chat.unreadContext.moreCitations", { count: hiddenCitations })}</div>
        )}
      </div>
    </div>
  );
}
