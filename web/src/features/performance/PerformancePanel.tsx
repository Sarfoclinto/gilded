import { useEffect, useMemo, useState } from "react";
import { Segmented } from "antd";
import {
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  TableIcon,
  TrendingUpIcon,
} from "lucide-react";
import { useBranchPerformance } from "./api";
import { PerformanceChart } from "./PerformanceChart";
import {
  bucketTitle,
  changeOf,
  linesOf,
  METRICS,
  metricDef,
  PERIODS,
  type Change,
  type Line,
  type Metric,
} from "./model";

const KEY = "gold.performance.v1";
const remembered = (): { metric: Metric; days: number } => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
      metric?: Metric;
      days?: number;
    } | null;
    const metric = METRICS.some((m) => m.value === raw?.metric)
      ? raw!.metric!
      : "paid";
    const days = PERIODS.some((p) => p.days === raw?.days) ? raw!.days! : 30;
    return { metric, days };
  } catch {
    return { metric: "paid", days: 30 };
  }
};

function Trend({ change, muted }: { change: Change; muted?: boolean }) {
  const Icon =
    change.dir === "up"
      ? ArrowUpRightIcon
      : change.dir === "down"
        ? ArrowDownRightIcon
        : ArrowRightIcon;
  const tone = muted
    ? "text-muted-foreground"
    : change.dir === "up"
      ? "text-emerald-700"
      : change.dir === "down"
        ? "text-red-700"
        : "text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {change.pct === null
        ? change.dir === "up"
          ? "new"
          : "—"
        : `${change.pct > 0 ? "+" : ""}${change.pct}%`}
    </span>
  );
}

/**
 * Branch performance over time (B58). Directors and managers see one coloured line per branch and can hide or single out a
 * branch; a teller gets just their own branch. Switch between cedis paid for gold, weight bought and the number of purchases,
 * over 7 days to 12 months. The choice is remembered on the device.
 */
export function PerformancePanel({
  onlyBranchId,
  title = "Branch performance",
}: {
  onlyBranchId?: string | null;
  title?: string;
}) {
  const [state, setState] = useState(remembered);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [table, setTable] = useState(false);
  const metric = metricDef(state.metric);
  const period = PERIODS.find((p) => p.days === state.days) ?? PERIODS[2]!;
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* a private window */
    }
  }, [state]);

  const q = useBranchPerformance(state.days);
  const data = q.data;
  const all = useMemo(
    () =>
      data
        ? linesOf(data, state.metric).filter(
            (l) => !onlyBranchId || l.branch.branchId === onlyBranchId,
          )
        : [],
    [data, state.metric, onlyBranchId],
  );
  const single = !!onlyBranchId || all.length === 1;
  const lines = useMemo(
    () => all.filter((l) => !hidden.has(l.branch.branchId)),
    [all, hidden],
  );
  const shownTotal = lines.reduce((s, l) => s + l.total, 0);
  const change = changeOf(
    shownTotal,
    lines.reduce((s, l) => s + l.before, 0),
  );
  const best = useMemo(() => {
    if (!data || lines.length === 0) return null;
    let bi = -1,
      bv = 0;
    data.buckets.forEach((_, i) => {
      const v = lines.reduce((s, l) => s + (l.values[i] ?? 0), 0);
      if (v > bv) {
        bv = v;
        bi = i;
      }
    });
    return bi >= 0
      ? { title: bucketTitle(data.buckets[bi]!, data.grain), value: bv }
      : null;
  }, [data, lines]);

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else if (n.size < all.length - 1) n.add(id);
      return n;
    });
  const only = (id: string) =>
    setHidden((h) =>
      h.size === all.length - 1 && !h.has(id)
        ? new Set()
        : new Set(
            all
              .filter((l) => l.branch.branchId !== id)
              .map((l) => l.branch.branchId),
          ),
    );

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUpIcon className="size-4 text-brand" aria-hidden />
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {metric.label} · {period.long}
            {single && lines[0] ? ` · ${lines[0].branch.name}` : ""}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Segmented<Metric>
            size="small"
            value={state.metric}
            onChange={(metric) => setState((s) => ({ ...s, metric }))}
            options={METRICS.map((m) => ({ value: m.value, label: m.short }))}
            aria-label="What to show"
          />
          <Segmented<number>
            size="small"
            value={state.days}
            onChange={(days) => setState((s) => ({ ...s, days }))}
            options={PERIODS.map((p) => ({
              value: p.days,
              label: (
                <>
                  <span className="sm:hidden">{p.short}</span>
                  <span className="hidden sm:inline">{p.label}</span>
                </>
              ),
            }))}
            aria-label="Period"
          />
        </div>
      </div>

      <div
        className={`px-3 pb-3 pt-3 sm:px-4 ${q.isFetching && data ? "opacity-70 transition-opacity" : ""}`}
      >
        {!data ? (
          <div
            className="h-72 animate-pulse rounded-lg bg-muted/50"
            aria-busy="true"
          >
            {q.isError ? (
              <p className="p-4 text-sm text-muted-foreground">
                The figures could not be loaded. Check the connection and try
                again.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <div className="text-xs text-muted-foreground">
                  {single
                    ? "This branch"
                    : lines.length === all.length
                      ? "All branches"
                      : `${lines.length} of ${all.length} branches`}
                  , {period.label}
                </div>
                <div className="tnum flex items-baseline gap-2 text-2xl font-bold leading-tight">
                  {metric.unit(shownTotal)}
                  <Trend change={change} />
                </div>
                <div className="text-xs text-muted-foreground">
                  against the {period.label} before
                </div>
              </div>
              {best ? (
                <div>
                  <div className="text-xs text-muted-foreground">
                    Best {data.grain}
                  </div>
                  <div className="tnum text-sm font-semibold">{best.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {metric.unit(best.value)}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-muted-foreground">
                  Average per {data.grain}
                </div>
                <div className="tnum text-sm font-semibold">
                  {metric.unit(
                    Math.round(
                      (shownTotal / Math.max(data.buckets.length, 1)) * 100,
                    ) / 100,
                  )}
                </div>
              </div>
            </div>

            {!single ? (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Branches">
                {all.map((l) => {
                  const off = hidden.has(l.branch.branchId);
                  return (
                    <li key={l.branch.branchId}>
                      <button
                        type="button"
                        aria-pressed={!off}
                        title={
                          off
                            ? "Show this branch"
                            : "Hide this branch (double-click to see it alone)"
                        }
                        onClick={() => toggle(l.branch.branchId)}
                        onDoubleClick={() => only(l.branch.branchId)}
                        className={`flex min-h-9 items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors ${off ? "border-border text-muted-foreground opacity-60" : "border-border bg-background hover:bg-muted"}`}
                      >
                        <span
                          className="h-0.5 w-4 rounded-full"
                          style={{
                            background: off ? "#cbd5e1" : l.color,
                            ...(l.dashed
                              ? {
                                  backgroundImage: `repeating-linear-gradient(90deg, ${l.color} 0 4px, transparent 4px 7px)`,
                                  background: undefined,
                                }
                              : {}),
                          }}
                          aria-hidden
                        />
                        <span
                          className={`font-medium ${off ? "line-through" : ""}`}
                        >
                          {l.branch.name}
                        </span>
                        <span className="tnum text-muted-foreground">
                          {metric.unit(l.total)}
                        </span>
                        <Trend change={l.change} muted={off} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <PerformanceChart
              data={data}
              lines={lines}
              metric={metric}
              height={single ? 240 : 300}
              label={`${metric.label} per ${data.grain}, ${period.long}`}
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {data.grain === "day"
                  ? "Shaded columns are weekends. "
                  : `The first and last ${data.grain} may be part ${data.grain}s. `}
                Hover or tap to read a {data.grain}; cancelled purchases are
                left out.
              </span>
              <button
                type="button"
                onClick={() => setTable((t) => !t)}
                className="inline-flex min-h-8 items-center gap-1 font-medium text-brand"
              >
                <TableIcon className="size-3.5" aria-hidden />
                {table ? "Hide the numbers" : "Show the numbers"}
              </button>
            </div>
            {table ? (
              <Numbers
                lines={lines}
                buckets={data.buckets}
                grain={data.grain}
                unit={metric.unit}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function Numbers({
  lines,
  buckets,
  grain,
  unit,
}: {
  lines: Line[];
  buckets: string[];
  grain: "day" | "week" | "month";
  unit: (n: number) => string;
}) {
  return (
    <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-left">
          <tr>
            <th className="px-2 py-1.5 font-medium">
              {grain === "day" ? "Day" : grain === "week" ? "Week" : "Month"}
            </th>
            {lines.map((l) => (
              <th
                key={l.branch.branchId}
                className="px-2 py-1.5 text-right font-medium"
              >
                <span
                  className="mr-1 inline-block h-0.5 w-3 align-middle"
                  style={{ background: l.color }}
                  aria-hidden
                />
                {l.branch.name}
              </th>
            ))}
            {lines.length > 1 ? (
              <th className="px-2 py-1.5 text-right font-medium">All</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {buckets
            .map((_, i) => i)
            .reverse()
            .map((i) => (
              <tr key={buckets[i]} className="border-t border-border">
                <td className="px-2 py-1.5">
                  {bucketTitle(buckets[i]!, grain)}
                </td>
                {lines.map((l) => (
                  <td
                    key={l.branch.branchId}
                    className="tnum px-2 py-1.5 text-right"
                  >
                    {unit(l.values[i] ?? 0)}
                  </td>
                ))}
                {lines.length > 1 ? (
                  <td className="tnum px-2 py-1.5 text-right font-semibold">
                    {unit(lines.reduce((s, l) => s + (l.values[i] ?? 0), 0))}
                  </td>
                ) : null}
              </tr>
            ))}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/50 font-semibold">
          <tr>
            <td className="px-2 py-1.5">Total</td>
            {lines.map((l) => (
              <td
                key={l.branch.branchId}
                className="tnum px-2 py-1.5 text-right"
              >
                {unit(l.total)}
              </td>
            ))}
            {lines.length > 1 ? (
              <td className="tnum px-2 py-1.5 text-right">
                {unit(lines.reduce((s, l) => s + l.total, 0))}
              </td>
            ) : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
