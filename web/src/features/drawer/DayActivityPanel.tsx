import { lineTotal } from "@gold/core";
import { DENOMINATIONS } from "@gold/core";
import { cedis } from "@/features/calculator/format";
import { packText } from "@/features/transactions/format";
import { Card } from "@/shared/ui/Card";
import { signed } from "./format";
import type { DayActivity } from "./schemas";

/**
 * "This day only": what moved on one day, apart from the running totals since the beginning.
 * Read-only. The cash table shows, per note, what the drawer opened with, came in, went out and the net, in packs/bundles/loose.
 */
export function DayActivityPanel({ activity }: { activity: DayActivity }) {
  const { cash, goods, debts } = activity;
  const rows = DENOMINATIONS.filter((d) =>
    [cash.opening, cash.in, cash.out, cash.net].some(
      (l) => (l[`${d}`] ?? 0) !== 0,
    ),
  );
  const cell = (n: number | undefined) => (n ? packText(n) : "—");
  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <h2 className="text-base font-semibold">Cash, this day only</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cash moved.</p>
        ) : null}
        <div className="space-y-2">
          {rows.map((d) => (
            <div
              key={d}
              className="rounded-lg border border-border p-2 text-sm"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">GHS {d}</span>
                <span className="tnum font-semibold">
                  {(cash.net[`${d}`] ?? 0) > 0 ? "+" : ""}
                  {cash.net[`${d}`] ?? 0} notes
                </span>
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>
                  <dt>Opened with</dt>
                  <dd className="text-foreground">
                    {cell(cash.opening[`${d}`])}
                  </dd>
                </div>
                <div>
                  <dt>In</dt>
                  <dd className="text-foreground">{cell(cash.in[`${d}`])}</dd>
                </div>
                <div>
                  <dt>Out</dt>
                  <dd className="text-foreground">{cell(cash.out[`${d}`])}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <div className="tnum flex justify-between border-t border-border pt-2 text-sm">
          <span>Opened with {cedis(lineTotal(cash.opening))}</span>
          <span className="font-semibold">
            Net {signed(Number(cash.netValue))}
          </span>
        </div>
      </Card>

      <Card className="space-y-1">
        <h2 className="text-base font-semibold">Gold bought, this day only</h2>
        <dl className="tnum grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Top (g)</dt>
            <dd className="font-semibold">{goods.top}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Down (g)</dt>
            <dd className="font-semibold">{goods.down}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Value</dt>
            <dd className="font-semibold">{cedis(Number(goods.value))}</dd>
          </div>
        </dl>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-base font-semibold">Debts, this day only</h2>
        {debts.debtors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody was lent to or repaid.
          </p>
        ) : null}
        <ul className="divide-y divide-border">
          {debts.debtors.map((d, i) => (
            <li
              key={`${d.customerId ?? d.name}-${i}`}
              className="flex items-baseline justify-between gap-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{d.name}</span>
                <span className="tnum block text-xs text-muted-foreground">
                  Lent {cedis(Number(d.issued))} · repaid{" "}
                  {cedis(Number(d.repaid))}
                </span>
              </span>
              <span className="tnum font-semibold">
                {signed(Number(d.net))}
              </span>
            </li>
          ))}
        </ul>
        <div className="tnum flex justify-between border-t border-border pt-2 text-sm font-semibold">
          <span>Sum of debts</span>
          <span>{signed(Number(debts.net))}</span>
        </div>
      </Card>
    </div>
  );
}
