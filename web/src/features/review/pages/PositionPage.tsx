import { Alert } from "antd";
import { ArrowRightLeft } from "lucide-react";
import { cedis } from "@/features/calculator/format";
import { Kpi } from "@/features/dashboard/charts";
import { errorMessage } from "@/shared/api/errors";
import { EmptyState } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { usePosition } from "../api";
import { netSentence, pairUp, stillToHandOver, type Direction } from "../model";

function Leg({ d }: { d: Direction | null }) {
  if (!d)
    return (
      <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
        Nothing sent this way.
      </div>
    );
  const rows: [string, number][] = [
    ["Cash", d.cash],
    ["Gold (value)", d.goods],
    [`Mobile money paid for ${d.to}`, d.mobile],
  ];
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">
        {d.from} → {d.to}
      </p>
      <p className="tnum text-xl font-bold">{cedis(d.total)}</p>
      <dl className="tnum mt-2 space-y-1 text-sm">
        {rows.map(([k, v]) =>
          v > 0 ? (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{cedis(v)}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {d.failed > 0 ? (
        <p className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-900">
          A mobile payment failed and {d.to} paid cash instead:{" "}
          {cedis(d.failed)} still to be handed over by {d.from}.
        </p>
      ) : null}
    </div>
  );
}

export default function PositionPage() {
  const q = usePosition();
  const pairs = pairUp(q.data ?? []);
  const moved = pairs.reduce(
    (s, p) => s + (p.aToB?.total ?? 0) + (p.bToA?.total ?? 0),
    0,
  );
  const waiting = pairs.reduce((s, p) => s + stillToHandOver(p), 0);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Between branches"
        subtitle="What each pair of branches has handed to one another, or paid on the other's behalf, since the beginning. This is value moved, not a debt."
      />
      {q.error ? (
        <Alert type="error" showIcon title={errorMessage(q.error)} />
      ) : null}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {q.data && pairs.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Pairs of branches" value={pairs.length} />
          <Kpi label="Total moved" value={cedis(moved)} />
          <Kpi
            label="Still to hand over"
            value={cedis(waiting)}
            sub={
              <span className="text-xs text-muted-foreground">
                failed mobile payments
              </span>
            }
          />
        </div>
      ) : null}
      {q.data && pairs.length === 0 ? (
        <EmptyState
          title="Nothing has moved between branches yet"
          hint="Transfers and mobile money paid for another branch will show here."
        />
      ) : null}
      {pairs.map((p) => (
        <section
          key={p.key}
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-start gap-2">
            <ArrowRightLeft className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">
                {p.a} and {p.b}
              </h2>
              <p className="text-sm text-muted-foreground">
                {netSentence(p, cedis)}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Leg d={p.aToB} />
            <Leg d={p.bToA} />
          </div>
        </section>
      ))}
    </div>
  );
}
