import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Performance } from "./api";
import {
  bucketTitle,
  isWeekend,
  niceTop,
  readout,
  sumOf,
  tickEvery,
  tickLabel,
  type Line,
  type MetricDef,
} from "./model";

const GRID = "#e6ebf2";
const AXIS_INK = "#64748b";
const WEEKEND = "#0d1b2e";

/**
 * One line per branch over a shared x axis. Hover or touch anywhere to read every branch at that date (the hairline snaps to
 * the nearest one); arrow keys do the same from the keyboard. Weekends are shaded on a daily chart. Up to four visible lines
 * are named at their right-hand end, so colour is never the only clue; the legend lives in the panel around this.
 */
export function PerformanceChart({
  data,
  lines,
  metric,
  height = 280,
  label,
}: {
  data: Performance;
  lines: Line[];
  metric: MetricDef;
  height?: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hot, setHot] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () =>
      setW(Math.max(Math.round(el.getBoundingClientRect().width), 240));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = data.buckets.length;
  const endLabels = lines.length > 1 && lines.length <= 4;
  const padL = 44,
    padR = endLabels ? 46 : 12,
    padT = 14,
    padB = 26;
  const H = height;
  const inner = { w: Math.max(W - padL - padR, 10), h: H - padT - padB };
  const top = useMemo(
    () => niceTop(Math.max(0, ...lines.flatMap((l) => l.values))),
    [lines],
  );
  const x = useCallback(
    (i: number) => padL + (n <= 1 ? inner.w / 2 : (i / (n - 1)) * inner.w),
    [padL, n, inner.w],
  );
  const y = useCallback(
    (v: number) => padT + inner.h - (v / top) * inner.h,
    [inner.h, top],
  );
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const every = tickEvery(
    n,
    inner.w,
    data.grain === "day" ? 58 : data.grain === "week" ? 50 : 40,
  );
  const totals = useMemo(() => sumOf(lines, n), [lines, n]);
  const empty = lines.length === 0 || lines.every((l) => l.total === 0);

  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || n === 0) return;
    const px = clientX - el.getBoundingClientRect().left;
    const i = n <= 1 ? 0 : Math.round(((px - padL) / inner.w) * (n - 1));
    setHot(Math.min(Math.max(i, 0), n - 1));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setHot((h) => Math.min((h ?? -1) + 1, n - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setHot((h) => Math.max((h ?? n) - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHot(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHot(n - 1);
    } else if (e.key === "Escape") setHot(null);
  };

  // right-hand names: one per visible line, pushed apart so they never overlap
  const endNames = useMemo(() => {
    if (!endLabels || n === 0) return [];
    const placed = lines
      .map((l) => ({ l, y: y(l.values[n - 1] ?? 0) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++)
      if (placed[i]!.y - placed[i - 1]!.y < 13)
        placed[i]!.y = placed[i - 1]!.y + 13;
    for (let i = placed.length - 1; i >= 0; i--) {
      const max = padT + inner.h - (placed.length - 1 - i) * 13;
      if (placed[i]!.y > max) placed[i]!.y = max;
    }
    return placed;
  }, [endLabels, lines, n, y, inner.h]);

  const active = hot !== null && hot < n ? hot : null;
  const rows = active !== null ? readout(lines, active) : [];
  const tipLeft = active !== null ? x(active) : 0;
  const flip = tipLeft > W * 0.6;

  return (
    <div
      ref={box}
      className="relative w-full min-w-0 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-lg"
      tabIndex={0}
      role="img"
      aria-label={label}
      onKeyDown={onKey}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setHot(null)}
      onBlur={() => setHot(null)}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        aria-hidden
      >
        {/* weekends, for a daily chart */}
        {data.grain === "day" && n > 1
          ? data.buckets.map((b, i) =>
              isWeekend(b) ? (
                <rect
                  key={b}
                  x={x(i) - inner.w / (n - 1) / 2}
                  y={padT}
                  width={inner.w / (n - 1)}
                  height={inner.h}
                  fill={WEEKEND}
                  opacity={0.035}
                />
              ) : null,
            )
          : null}
        {/* grid and y labels */}
        {ticks.map((t, i) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(t)}
              y2={y(t)}
              stroke={GRID}
              strokeWidth={1}
            />
            {i % 2 === 0 || i === ticks.length - 1 ? (
              <text
                x={padL - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize={11}
                fill={AXIS_INK}
                className="tnum"
              >
                {metric.axis(t)}
              </text>
            ) : null}
          </g>
        ))}
        {/* x labels */}
        {data.buckets.map((b, i) => {
          const last = i === n - 1;
          const show = last || (i % every === 0 && n - 1 - i >= every * 0.6);
          return show ? (
            <text
              key={b}
              x={x(i)}
              y={H - 7}
              textAnchor={last && n > 1 ? "end" : i === 0 ? "start" : "middle"}
              fontSize={11}
              fill={last ? "#0d1b2e" : AXIS_INK}
              fontWeight={last ? 600 : 400}
            >
              {tickLabel(
                b,
                data.grain,
                data.grain === "month" && (i === 0 || b.endsWith("-01-01")),
              )}
            </text>
          ) : null;
        })}
        {/* the hairline */}
        {active !== null ? (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={padT - 4}
            y2={padT + inner.h}
            stroke="#0d1b2e"
            strokeWidth={1}
            opacity={0.35}
          />
        ) : null}
        {/* the lines */}
        {lines.map((l) => {
          const d = l.values
            .map(
              (v, i) =>
                `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
            )
            .join(" ");
          return (
            <g key={l.branch.branchId}>
              <path
                d={d}
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={l.dashed ? "6 4" : undefined}
              />
              {n > 0 ? (
                <circle
                  cx={x(n - 1)}
                  cy={y(l.values[n - 1] ?? 0)}
                  r={3}
                  fill={l.color}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              ) : null}
              {active !== null ? (
                <circle
                  cx={x(active)}
                  cy={y(l.values[active] ?? 0)}
                  r={4.5}
                  fill={l.color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ) : null}
            </g>
          );
        })}
        {/* names at the right */}
        {endNames.map(({ l, y: ly }) => (
          <text
            key={l.branch.branchId}
            x={W - padR + 7}
            y={ly + 4}
            fontSize={11}
            fontWeight={600}
            fill={l.color}
          >
            {l.branch.code}
          </text>
        ))}
        {empty ? (
          <text
            x={padL + inner.w / 2}
            y={padT + inner.h / 2}
            textAnchor="middle"
            fontSize={13}
            fill={AXIS_INK}
          >
            No purchases in this period
          </text>
        ) : null}
      </svg>

      {active !== null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-44 max-w-64 rounded-lg border border-border bg-popover p-2.5 text-xs shadow-md"
          style={flip ? { right: W - tipLeft + 10 } : { left: tipLeft + 10 }}
        >
          <div className="mb-1.5 font-semibold text-foreground">
            {bucketTitle(
              data.buckets[active]!,
              data.grain,
              active === n - 1 && data.grain !== "day",
            )}
          </div>
          <ul className="space-y-1">
            {rows.map(({ line, value }) => (
              <li
                key={line.branch.branchId}
                className="flex items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span
                    className="h-0.5 w-3.5 shrink-0 rounded-full"
                    style={{ background: line.color }}
                    aria-hidden
                  />
                  <span className="truncate">{line.branch.name}</span>
                </span>
                <span
                  className={`tnum shrink-0 font-semibold ${value === 0 ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {metric.unit(value)}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > 1 ? (
            <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-border pt-1.5">
              <span className="text-muted-foreground">All shown</span>
              <span className="tnum font-bold text-foreground">
                {metric.unit(totals[active] ?? 0)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {lines.map((l) => (
              <th key={l.branch.branchId} scope="col">
                {l.branch.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.buckets.map((b, i) => (
            <tr key={b}>
              <th scope="row">{bucketTitle(b, data.grain)}</th>
              {lines.map((l) => (
                <td key={l.branch.branchId}>{metric.unit(l.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
