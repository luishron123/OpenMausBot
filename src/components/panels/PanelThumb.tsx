import { cn } from "@/lib/cn";
import type { PanelCardSize, PanelSummary, PanelThumbKind } from "@/lib/panels";

const SPAN: Record<PanelCardSize, string> = { s: "", m: "col-span-2", l: "col-span-2 row-span-2" };

/** A few strokes of what the block shows, not its data. */
function Glyph({ kind }: { kind: PanelThumbKind }) {
  const ink = "bg-ink/25";
  switch (kind) {
    case "kpi":
      return <span className="flex h-full flex-col justify-center gap-[2px] px-[3px]"><span className={cn("h-[3px] w-3/5 rounded-full", ink)} /><span className="h-[2px] w-2/5 rounded-full bg-ink/15" /></span>;
    case "goal":
      return <span className="flex h-full items-center px-[3px]"><span className="h-[3px] w-full overflow-hidden rounded-full bg-ink/10"><span className={cn("block h-full w-2/3", ink)} /></span></span>;
    case "bar":
      return <span className="flex h-full items-end justify-center gap-[2px] px-[3px] pb-[3px]">{[50, 80, 35, 65].map((height, index) => <span key={index} className={cn("w-[3px] rounded-t-[1px]", ink)} style={{ height: `${height}%` }} />)}</span>;
    case "line":
      return (
        <svg viewBox="0 0 24 12" preserveAspectRatio="none" className="size-full p-[3px] text-ink/30">
          <polyline points="0,9 6,6 11,8 17,3 24,4" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      );
    case "checklist":
      return <span className="flex h-full flex-col justify-center gap-[2px] px-[3px]">{[0, 1].map((row) => <span key={row} className="flex items-center gap-[2px]"><span className={cn("size-[3px] rounded-full", ink)} /><span className="h-[2px] flex-1 rounded-full bg-ink/15" /></span>)}</span>;
    case "text":
      return <span className="flex h-full flex-col justify-center gap-[2px] px-[3px]"><span className="h-[2px] w-full rounded-full bg-ink/15" /><span className="h-[2px] w-3/4 rounded-full bg-ink/15" /></span>;
    default:
      return null;
  }
}

/** The panel's layout in miniature: its first cards at their sizes, each with the shape of its main block. */
export function PanelThumb({ panel }: { panel: Pick<PanelSummary, "thumb"> }) {
  const blocks = panel.thumb ?? [];
  return (
    <span aria-hidden="true" data-panel-thumb className="grid h-12 w-[72px] shrink-0 grid-flow-row-dense auto-rows-[1fr] grid-cols-4 grid-rows-2 gap-[2px] overflow-hidden rounded-lg border border-hairline/40 bg-app p-[3px]">
      {blocks.length === 0
        ? <span className="col-span-4 row-span-2 rounded-[3px] border border-dashed border-hairline/60" />
        : blocks.map((block, index) => (
          <span key={index} data-panel-thumb-block={block.kind} className={cn("min-h-0 min-w-0 overflow-hidden rounded-[3px] bg-card", SPAN[block.size])}>
            <Glyph kind={block.kind} />
          </span>
        ))}
    </span>
  );
}
