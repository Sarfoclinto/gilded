import { cedis } from "@/features/calculator/format";
import type { Figures, Performance, PerformanceBranch } from "./api";

export type Metric = "paid" | "pounds" | "count";
export interface MetricDef {
  value: Metric;
  label: string;
  short: string;
  unit: (n: number) => string;
  axis: (n: number) => string;
  one: string;
}

export const poundsText = (n: number) =>
  `${n.toLocaleString("en-GH", { maximumFractionDigits: 2 })} lb`;

/** Big figures on an axis: 1.2k, 3.4M. */
export function compactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("en-GH", { maximumFractionDigits: 1 })}M`;
  if (Math.abs(n) >= 1_000)
    return `${(n / 1_000).toLocaleString("en-GH", { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString("en-GH", { maximumFractionDigits: 2 });
}

export const METRICS: MetricDef[] = [
  {
    value: "paid",
    label: "Cedis paid for gold",
    short: "Paid out",
    unit: cedis,
    axis: (n) => compactNumber(n),
    one: "GHS",
  },
  {
    value: "pounds",
    label: "Weight bought",
    short: "Weight",
    unit: poundsText,
    axis: (n) => compactNumber(n),
    one: "lb",
  },
  {
    value: "count",
    label: "Number of purchases",
    short: "Purchases",
    unit: (n) =>
      `${Math.round(n).toLocaleString("en-GH")} purchase${Math.round(n) === 1 ? "" : "s"}`,
    axis: (n) => compactNumber(n),
    one: "purchases",
  },
];
export const metricDef = (m: Metric): MetricDef =>
  METRICS.find((x) => x.value === m) ?? METRICS[0]!;

export const PERIODS: {
  days: number;
  label: string;
  short: string;
  long: string;
}[] = [
  { days: 7, label: "7 days", short: "7d", long: "the last 7 days" },
  { days: 14, label: "14 days", short: "14d", long: "the last 14 days" },
  { days: 30, label: "30 days", short: "30d", long: "the last 30 days" },
  {
    days: 90,
    label: "3 months",
    short: "3m",
    long: "the last 3 months, by week",
  },
  {
    days: 365,
    label: "12 months",
    short: "12m",
    long: "the last 12 months, by month",
  },
];

/**
 * One colour per branch, in a fixed order that never changes when a line is hidden (validated for colour-blind readers,
 * dataviz palette: blue, orange, aqua, yellow, violet, pink, green, red). A ninth branch repeats from the start with a dashed line.
 */
export const SERIES_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#6250d6",
  "#e87ba4",
  "#008300",
  "#e34948",
] as const;
export const colorOf = (index: number) =>
  SERIES_COLORS[index % SERIES_COLORS.length]!;
export const dashedAt = (index: number) => index >= SERIES_COLORS.length;

export const figure = (f: Figures, m: Metric): number =>
  m === "count" ? f.count : Number(m === "paid" ? f.paid : f.pounds);

export interface Change {
  pct: number | null;
  dir: "up" | "down" | "flat";
}
/** Percent change from the period before; null when there was nothing before (so "new"). */
export function changeOf(now: number, before: number): Change {
  if (before === 0) return { pct: null, dir: now > 0 ? "up" : "flat" };
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  parse(iso)
    .toLocaleDateString("en-GB", { ...o, timeZone: "UTC" })
    .replace(/,/g, "");

/** The x-axis label for a bucket: "Mon 3 Nov" for days, "3 Nov" (the Monday) for weeks, "Nov" for months. */
export function tickLabel(
  iso: string,
  grain: Performance["grain"],
  withYear = false,
): string {
  if (grain === "month")
    return fmt(
      iso,
      withYear ? { month: "short", year: "2-digit" } : { month: "short" },
    );
  if (grain === "week") return fmt(iso, { day: "numeric", month: "short" });
  return fmt(iso, { weekday: "short", day: "numeric" });
}
/** The full name of a bucket for the read-out: "Monday 3 Nov 2026", "Week of Mon 3 Nov", "November 2026". */
export function bucketTitle(
  iso: string,
  grain: Performance["grain"],
  partial = false,
): string {
  const tail = partial ? " (so far)" : "";
  if (grain === "month")
    return fmt(iso, { month: "long", year: "numeric" }) + tail;
  if (grain === "week")
    return (
      `Week of ${fmt(iso, { weekday: "short", day: "numeric", month: "short" })}` +
      tail
    );
  return fmt(iso, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export const isWeekend = (iso: string) => {
  const d = parse(iso).getUTCDay();
  return d === 0 || d === 6;
};

/** A round top for the y axis: 0 → 1, 870 → 1000, 2300 → 2500, 13 → 15. */
export function niceTop(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const n = max / mag;
  const step =
    n <= 1
      ? 1
      : n <= 1.5
        ? 1.5
        : n <= 2
          ? 2
          : n <= 2.5
            ? 2.5
            : n <= 3
              ? 3
              : n <= 4
                ? 4
                : n <= 5
                  ? 5
                  : n <= 6
                    ? 6
                    : n <= 8
                      ? 8
                      : 10;
  return step * mag;
}

/** How many x labels fit: at least one every `every` buckets, the last always shown. */
export function tickEvery(
  buckets: number,
  width: number,
  labelWidth: number,
): number {
  return Math.max(
    1,
    Math.ceil(buckets / Math.max(Math.floor(width / labelWidth), 2)),
  );
}

export interface Line {
  branch: PerformanceBranch;
  index: number;
  color: string;
  dashed: boolean;
  values: number[];
  total: number;
  before: number;
  change: Change;
}

/** The lines of the chart: every branch with its values for the metric, in the server's (stable) order. */
export function linesOf(p: Performance, metric: Metric): Line[] {
  return p.branches.map((b, index) => ({
    branch: b,
    index,
    color: colorOf(index),
    dashed: dashedAt(index),
    values: b.points.map((pt) => figure(pt, metric)),
    total: figure(b.total, metric),
    before: figure(b.previous, metric),
    change: changeOf(figure(b.total, metric), figure(b.previous, metric)),
  }));
}

/** The company's figures: the sum over the visible lines, bucket by bucket. */
export function sumOf(lines: Line[], buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  for (const l of lines)
    l.values.forEach((v, i) => {
      out[i] = (out[i] ?? 0) + v;
    });
  return out;
}

/** The read-out at one bucket: visible branches, biggest first; zeros last. */
export function readout(
  lines: Line[],
  i: number,
): { line: Line; value: number }[] {
  return lines
    .map((line) => ({ line, value: line.values[i] ?? 0 }))
    .sort((a, b) => b.value - a.value);
}
