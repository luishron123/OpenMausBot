// One card of each format New card offers, made of the widget blocks a bot
// already writes. The panel tests and the verification preview read these.
import { parseWidgetInput } from "../../../shared/widget";
import type { PanelCard, PanelCardFormat, PanelCardSize } from "@/lib/panels";

const root = (input: Record<string, unknown>): NonNullable<PanelCard["widget"]> => {
  const parsed = parseWidgetInput(input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value as NonNullable<PanelCard["widget"]>;
};

const week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const series = (values: number[]) => values.map((value, at) => ({ day: week[at], value }));

const check = (label: string, state: "ok" | "warn" | "todo", note: string) => ({
  type: "Row",
  gap: 2,
  align: "center",
  children: [
    { type: "Icon", name: state === "ok" ? "check-circle" : state === "warn" ? "warning" : "empty-circle", color: state === "ok" ? "success" : state === "warn" ? "warning" : "tertiary", size: "sm" },
    { type: "Text", value: label, size: "sm" },
    { type: "Spacer" },
    { type: "Caption", value: note, color: "tertiary" },
  ],
});

export const PANEL_SAMPLE_WIDGETS: Record<Exclude<PanelCardFormat, "auto">, { title: string; size: PanelCardSize; widget: NonNullable<PanelCard["widget"]> }> = {
  kpi: {
    title: "Revenue today",
    size: "s",
    widget: root({
      type: "Card",
      children: [
        { type: "Row", align: "center", gap: 2, children: [{ type: "Title", value: "US$ 4,820", size: "lg" }, { type: "Badge", label: "+12%", color: "success" }] },
        { type: "Caption", value: "vs. yesterday at this hour" },
        { type: "Chart", data: series([3100, 3600, 3400, 4100, 3900, 4500, 4820]), series: [{ type: "line", dataKey: "value" }], xAxis: "day", showGrid: false, height: 80 },
      ],
    }),
  },
  goal: {
    title: "Monthly goal",
    size: "s",
    widget: root({
      type: "Card",
      children: [
        { type: "Row", align: "center", children: [{ type: "Title", value: "68%", size: "lg" }, { type: "Spacer" }, { type: "Caption", value: "US$ 34k of 50k" }] },
        { type: "Progress", value: 0.68, label: "9 days left" },
      ],
    }),
  },
  line: {
    title: "Visitors this week",
    size: "m",
    widget: root({
      type: "Card",
      children: [{ type: "Chart", data: series([820, 940, 910, 1180, 1320, 1010, 1260]), series: [{ type: "area", dataKey: "value", label: "Visitors" }], xAxis: "day", showLegend: false, height: 140 }],
    }),
  },
  bar: {
    title: "Orders by day",
    size: "m",
    widget: root({
      type: "Card",
      children: [{ type: "Chart", data: series([42, 51, 38, 64, 57, 31, 22]), series: [{ type: "bar", dataKey: "value", label: "Orders" }], xAxis: "day", showLegend: false, showValues: true, height: 140 }],
    }),
  },
  checklist: {
    title: "Launch checklist",
    size: "m",
    widget: root({
      type: "Card",
      children: [
        check("Product page live", "ok", "Mon"),
        check("Email to the list", "ok", "Tue"),
        check("Ads approved", "warn", "1 rejected"),
        check("Influencer posts", "todo", "Fri"),
      ],
    }),
  },
  text: {
    title: "Store status",
    size: "s",
    widget: root({
      type: "Card",
      children: [
        { type: "Row", gap: 2, wrap: "wrap", children: [{ type: "Badge", label: "Healthy", color: "success" }, { type: "Badge", label: "2 low stock", color: "warning" }] },
        { type: "Text", value: "Checkout and payments work. Two items will run out this week.", size: "sm" },
      ],
    }),
  },
};
