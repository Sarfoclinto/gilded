import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Segmented, Skeleton } from "antd";
import { useAuth } from "@/features/auth/store";
import { branches } from "@/features/branches/api";
import { cedis } from "@/features/calculator/format";
import { errorMessage } from "@/shared/api/errors";
import { useApiInfiniteQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { reviewApi, reviewKeys } from "../api";
import { sourceLabel } from "../labels";
import type { TimelineEntry } from "../schemas";

interface Filters {
  branchId: string;
  asset: string;
  from: string;
  to: string;
}

const ASSETS = [
  { label: "Everything", value: "" },
  { label: "Cash", value: "cash" },
  { label: "Gold", value: "goods" },
  { label: "Debts", value: "debt" },
  { label: "We owe", value: "payable" },
];
const dot: Record<string, string> = {
  cash: "bg-emerald-500",
  goods: "bg-amber-500",
  debt: "bg-sky-500",
  payable: "bg-violet-500",
};
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/** One real-world event (a purchase, a transfer...) often writes several ledger rows; show them as one card. */
interface Event {
  key: string;
  sourceType: string;
  at: string;
  by?: string;
  memo?: string | null;
  rows: TimelineEntry[];
  latest: TimelineEntry;
}

function group(entries: TimelineEntry[]): Event[] {
  const out: Event[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (
      last &&
      last.rows[0]!.sourceId === e.sourceId &&
      last.sourceType === e.sourceType
    )
      last.rows.push(e);
    else
      out.push({
        key: `${e.seq}`,
        sourceType: e.sourceType,
        at: e.occurredAt,
        by: e.recordedBy?.displayName,
        memo: e.memo,
        rows: [e],
        latest: e,
      });
  }
  return out;
}

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GH", {
    hour: "2-digit",
    minute: "2-digit",
  });

function lineText(
  rows: TimelineEntry[],
  asset: string,
): { text: string; sub?: string } | null {
  const r = rows.filter((x) => x.asset === asset);
  if (r.length === 0) return null;
  if (asset === "cash") {
    const net = r.reduce((s, x) => s + Number(x.deltaValue), 0);
    const notes = r
      .map((x) => `${Math.abs(x.deltaCount ?? 0)} × ${x.denomination}`)
      .join(", ");
    return { text: `Cash ${sign(net)}${cedis(Math.abs(net))}`, sub: notes };
  }
  if (asset === "goods") {
    const top = r.reduce((s, x) => s + Number(x.deltaTop ?? 0), 0);
    const val = r.reduce((s, x) => s + Number(x.deltaValue), 0);
    return {
      text: `Gold ${sign(top)}${Math.abs(top)} g`,
      sub: `worth ${cedis(Math.abs(val))}`,
    };
  }
  const v = r.reduce((s, x) => s + Number(x.deltaValue), 0);
  return {
    text: `${asset === "debt" ? "Debts" : "Amounts we owe"} ${sign(v)}${cedis(Math.abs(v))}`,
  };
}

function EventCard({ ev, side }: { ev: Event; side: "left" | "right" }) {
  const assets = (["cash", "goods", "debt", "payable"] as const).filter((a) =>
    ev.rows.some((r) => r.asset === a),
  );
  const run = ev.latest.running;
  return (
    <li
      className={`relative pl-10 md:w-1/2 md:pl-0 ${side === "right" ? "md:ml-auto" : ""}`}
    >
      <span
        className={`absolute left-4 top-4 size-3 -translate-x-1/2 rounded-full ring-4 ring-background ${dot[assets[0] ?? "cash"]} ${side === "left" ? "md:left-auto md:right-0 md:translate-x-1/2" : "md:left-0"}`}
      />
      <div
        className={`rounded-xl border border-border bg-card p-3 text-sm shadow-sm ${side === "left" ? "md:mr-6" : "md:ml-6"}`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">
            {sourceLabel[ev.sourceType] ?? ev.sourceType}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeLabel(ev.at)}
          </span>
        </div>
        <ul className="mt-1 space-y-0.5">
          {assets.map((a) => {
            const l = lineText(ev.rows, a)!;
            return (
              <li key={a} className="flex items-baseline gap-2">
                <span className={`size-2 shrink-0 rounded-full ${dot[a]}`} />
                <span className="tnum font-medium">{l.text}</span>
                {l.sub ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {l.sub}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {ev.memo || ev.by ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {[ev.by, ev.memo].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <p className="tnum mt-2 border-t border-border pt-1 text-xs text-muted-foreground">
          After this: cash {cedis(Number(run.cash))} · gold {run.goodsTop} g ·
          debts {cedis(Number(run.debt))}
        </p>
      </div>
    </li>
  );
}

export default function BranchTimelinePage() {
  const active = useAuth((s) => s.activeBranchId);
  const list = branches.useList();
  const [f, setF] = useState<Filters>({
    branchId: active ?? "",
    asset: "",
    from: "",
    to: "",
  });
  const branchId = f.branchId || (list.data?.[0]?.id ?? "");

  const q = useApiInfiniteQuery({
    queryKey: reviewKeys.custom("timeline", { ...f, branchId }),
    enabled: !!branchId,
    staleTime: 30_000,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      reviewApi.timeline(
        branchId,
        {
          ...(f.asset ? { asset: f.asset } : {}),
          ...(f.from
            ? { from: new Date(`${f.from}T00:00:00`).toISOString() }
            : {}),
          ...(f.to
            ? {
                to: new Date(
                  new Date(`${f.to}T00:00:00`).getTime() + 86_400_000,
                ).toISOString(),
              }
            : {}),
          ...(pageParam ? { before: pageParam } : {}),
        },
        signal,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });

  const events = useMemo(
    () => group((q.data?.pages ?? []).flatMap((p) => p.entries)),
    [q.data],
  );
  const days = useMemo(() => {
    const out: Array<{ label: string; events: Event[] }> = [];
    for (const ev of events) {
      const label = dayLabel(ev.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.events.push(ev);
      else out.push({ label, events: [ev] });
    }
    return out;
  }, [events]);

  // Load the next page when the end of the list scrolls into view (the button below is the fallback).
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (hits) => {
        if (hits.some((h) => h.isIntersecting) && !isFetchingNextPage)
          void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, events.length]);

  let n = 0;
  return (
    <div className="mx-auto max-w-4xl pb-10">
      <div className="sticky top-0 z-20 space-y-3 border-b border-border bg-background/95 p-4 backdrop-blur">
        <PageHeader
          title="Branch timeline"
          subtitle="Every movement, newest first, with the balance after it."
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <select
            aria-label="Branch"
            className="min-h-11 rounded-lg border border-border bg-card px-2"
            value={branchId}
            onChange={(e) => setF({ ...f, branchId: e.target.value })}
          >
            {(list.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            From
            <input
              type="date"
              className="min-h-11 flex-1 rounded-lg border border-border bg-card px-2 text-foreground"
              value={f.from}
              onChange={(e) => setF({ ...f, from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            To
            <input
              type="date"
              className="min-h-11 flex-1 rounded-lg border border-border bg-card px-2 text-foreground"
              value={f.to}
              onChange={(e) => setF({ ...f, to: e.target.value })}
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <Segmented
            value={f.asset}
            onChange={(v) => setF({ ...f, asset: String(v) })}
            options={ASSETS}
          />
        </div>
      </div>

      <div className="px-4 pt-4">
        {q.error ? (
          <Alert type="error" showIcon title={errorMessage(q.error)} />
        ) : null}
        {q.isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        {!q.isLoading && !q.error && events.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing in this range.
          </p>
        ) : null}

        <div className="relative">
          <div
            aria-hidden
            className="absolute bottom-0 left-4 top-0 w-px -translate-x-1/2 bg-border md:left-1/2"
          />
          {days.map((d) => (
            <section key={d.label} className="relative space-y-3 pb-4">
              <div className="relative pl-10 pt-2 md:pl-0 md:text-center">
                <span className="inline-block rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
                  {d.label}
                </span>
              </div>
              <ul className="space-y-3">
                {d.events.map((ev) => (
                  <EventCard
                    key={ev.key}
                    ev={ev}
                    side={n++ % 2 === 0 ? "left" : "right"}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div
          ref={sentinel}
          className="py-6 text-center text-sm text-muted-foreground"
        >
          {isFetchingNextPage ? (
            "Loading older…"
          ) : hasNextPage ? (
            <Button variant="secondary" onClick={() => void fetchNextPage()}>
              Show older
            </Button>
          ) : events.length > 0 ? (
            "That is the beginning of the records."
          ) : null}
        </div>
      </div>
    </div>
  );
}
