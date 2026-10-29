import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
} from "lucide-react";
import { cedis } from "@/features/calculator/format";
import {
  compact,
  niceMax,
  num,
  shortDate,
  type Change,
  type Segment,
} from "./model";

/** Chart ink. Navy carries the data; the darker gold marks "today"; both pass 3:1 on the white card. */
export const INK = {
  series: "#2d5a8e",
  today: "#a37f1f",
  grid: "#e2e8f0",
  cash: "#2d5a8e",
  mobileMoney: "#a37f1f",
  owed: "#64748b",
} as const;

/** A small up/down badge. For money out, "up" is not good or bad by itself, so it stays neutral. */
export function Delta({
  change,
  label = "vs yesterday",
}: {
  change: Change;
  label?: string;
}) {
  if (change.pct === null && change.dir === "flat")
    return (
      <span className="text-xs text-muted-foreground">Nothing yesterday</span>
    );
  const Icon =
    change.dir === "up"
      ? ArrowUpRightIcon
      : change.dir === "down"
        ? ArrowDownRightIcon
        : ArrowRightIcon;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      <span className="font-medium text-foreground">
        {change.pct === null
          ? "New"
          : `${change.pct > 0 ? "+" : ""}${change.pct}%`}
      </span>{" "}
      {label}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  to?: string;
}) {
  const body = (
    <div className="h-full rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="tnum mt-1 text-xl font-bold leading-tight sm:text-2xl">
        {value}
      </div>
      {sub ? <div className="mt-1 min-h-4">{sub}</div> : null}
    </div>
  );
  return to ? (
    <Link to={to} className="block transition-shadow hover:shadow-sm">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface TrendPoint {
  date: string;
  value: number;
}

/**
 * Daily bars with a hover/touch read-out. Today's bar (the last) is drawn in gold. Also readable without a pointer: the table below is for screen readers.
 * `unit` formats the read-out, e.g. money or pounds.
 */
export function TrendChart({
  points,
  unit,
  height = 160,
  label,
}: {
  points: TrendPoint[];
  unit: (n: number) => string;
  height?: number;
  label: string;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(480); // drawn 1:1 with the screen, so the text stays a readable size on a phone
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () =>
      setW(Math.max(Math.round(el.getBoundingClientRect().width), 200));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const padL = 36,
    padB = 20,
    padT = 8;
  const H = height;
  const top = niceMax(Math.max(...points.map((p) => p.value), 0));
  const inner = { w: W - padL, h: H - padB - padT };
  const slot = points.length ? inner.w / points.length : inner.w;
  const bar = Math.max(Math.min(slot * 0.62, 28), 3);
  const y = (v: number) => padT + inner.h - (v / top) * inner.h;
  const ticks = [0, top / 2, top];
  const every = Math.max(
    1,
    Math.ceil(points.length / Math.max(Math.floor(W / 80), 2)),
  );
  const active = hot !== null ? points[hot] : null;
  return (
    <div className="relative w-full min-w-0 overflow-hidden" ref={box}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="block"
        onPointerLeave={() => setHot(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W}
              y1={y(t)}
              y2={y(t)}
              stroke={INK.grid}
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="#64748b"
            >
              {compact(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = padL + slot * i + (slot - bar) / 2;
          const h = Math.max(
            inner.h - (y(p.value) - padT),
            p.value > 0 ? 2 : 0,
          );
          const last = i === points.length - 1;
          return (
            <g key={p.date}>
              {hot === i ? (
                <rect
                  x={padL + slot * i}
                  y={padT}
                  width={slot}
                  height={inner.h}
                  fill="#0d1b2e"
                  opacity={0.05}
                />
              ) : null}
              {p.value > 0 ? (
                <rect
                  x={x}
                  y={padT + inner.h - h}
                  width={bar}
                  height={h}
                  rx={3}
                  fill={last ? INK.today : INK.series}
                />
              ) : (
                <rect
                  x={x}
                  y={padT + inner.h - 1.5}
                  width={bar}
                  height={1.5}
                  fill={INK.grid}
                />
              )}
              {(i % every === 0 && points.length - 1 - i >= every) || last ? (
                <text
                  x={padL + slot * i + slot / 2}
                  y={H - 5}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#64748b"
                >
                  {shortDate(p.date)}
                </text>
              ) : null}
              <rect
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={inner.h + padB}
                fill="transparent"
                onPointerEnter={() => setHot(i)}
                onPointerDown={() => setHot(i)}
              />
            </g>
          );
        })}
      </svg>
      {active ? (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm"
          style={{
            left: `${Math.min(Math.max(((padL + slot * (hot as number) + slot / 2) / W) * 100, 12), 88)}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-muted-foreground">{shortDate(active.date)}</div>
          <div className="tnum font-semibold">{unit(active.value)}</div>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{shortDate(p.date)}</th>
              <td>{unit(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface RankRow {
  key: string;
  label: ReactNode;
  value: number;
  text: string;
  sub?: ReactNode;
  to?: string;
}

/** Horizontal bars, longest first, each with its figure printed beside it. */
export function RankBars({ rows, empty }: { rows: RankRow[]; empty: string }) {
  if (rows.length === 0)
    return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">{r.label}</span>
              <span className="tnum shrink-0 font-semibold">{r.text}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%`,
                  background: INK.series,
                }}
              />
            </div>
            {r.sub ? (
              <div className="mt-1 text-xs text-muted-foreground">{r.sub}</div>
            ) : null}
          </>
        );
        return (
          <li key={r.key}>
            {r.to ? (
              <Link to={r.to} className="block hover:opacity-90">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One stacked bar (parts separated by a 2px gap) with a legend that carries the figures, so colour is never the only clue. */
export function StackBar({
  segments,
  empty,
}: {
  segments: Segment[];
  empty: string;
}) {
  if (segments.length === 0)
    return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div>
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={segments
          .map((s) => `${s.label} ${Math.round(s.share)}%`)
          .join(", ")}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${s.share}%`, background: INK[s.key] }}
            className="min-w-1"
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: INK[s.key] }}
                aria-hidden
              />
              {s.label}
            </span>
            <span className="tnum">
              <span className="font-semibold">{cedis(s.value)}</span>{" "}
              <span className="text-muted-foreground">
                {Math.round(s.share)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const pounds = (n: number) =>
  `${n.toLocaleString("en-GH", { maximumFractionDigits: 2 })} lb`;
export const money = (n: number | string) => cedis(num(n));
