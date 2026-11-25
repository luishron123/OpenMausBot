import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** A dialog over the panel: title and close at the top, the body, and a footer of actions. */
export function PanelDialog({ title, onClose, footer, wide = false, label, children }: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  label?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalDialog(dialog, onClose);
  return createPortal(
    <div className="ui-scrim fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title}
        tabIndex={-1}
        className={cn("ui-modal flex max-h-[calc(100dvh-2rem)] w-full flex-col text-ink outline-none animate-pop-in motion-reduce:animate-none", wide ? "max-w-[620px]" : "max-w-[440px]")}
      >
        <header className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-4">
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="ui-icon-button ui-button-ghost -me-2 flex size-8 items-center justify-center">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <>
            <div className="ui-modal-divider shrink-0" />
            <footer className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-3">{footer}</footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
