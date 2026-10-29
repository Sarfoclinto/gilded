import { Link } from "react-router-dom";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { Button } from "@/shared/ui/Button";
import { Delta, Kpi, Panel, TrendChart, money, pounds } from "./charts";
import { useDashboard } from "./api";
import { change, num } from "./model";
import { DebtTile, DrawerTile, HeldTile, MoneyTile, PriceTile } from "./tiles";

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** The teller's home: what to do next (price, drawer, new purchase), how my day is going, and what is waiting. */
export default function TellerHome() {
  const user = useAuth((s) => s.user);
  const branchId = useAuth((s) => s.activeBranchId);
  const dash = useDashboard(branchId, 7);
  const d = dash.data;
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4">
      <div>
        <h1 className="text-xl font-bold">Hello, {user?.displayName}</h1>
        <p className="text-sm text-muted-foreground">{today}</p>
      </div>
      <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
        <Link to={paths.transactions.create.href} className="block">
          <Button className="w-full">New transaction</Button>
        </Link>
      </Can>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <PriceTile />
        <DrawerTile />
        <Kpi
          label="My purchases today"
          value={d ? d.mine.todayCount : "–"}
          sub={
            d ? (
              <span className="tnum text-xs text-muted-foreground">
                {money(d.mine.todayPaid)} paid out
              </span>
            ) : null
          }
          to={paths.transactions.list.href}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <Panel
          title="My latest purchases"
          className="lg:col-span-3"
          action={
            <Link
              to={paths.transactions.list.href}
              className="text-xs font-medium text-brand"
            >
              See all
            </Link>
          }
        >
          {!d ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : d.mine.recent.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Nothing recorded by you in the last 7 days.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {d.mine.recent.map((t) => (
                <li key={t.reference}>
                  <Link
                    to={
                      paths.transactions.list.href +
                      `?q=${encodeURIComponent(t.reference)}&range=all`
                    }
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {t.customerName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.reference} · {timeOf(t.capturedAt)}
                        {t.status === "void" ? " · cancelled" : ""}
                      </span>
                    </span>
                    <span
                      className={`tnum shrink-0 font-semibold ${t.status === "void" ? "text-muted-foreground line-through" : ""}`}
                    >
                      {money(t.payable)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="This branch, last 7 days" className="lg:col-span-2">
          {d ? (
            <>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Today</div>
                  <div className="tnum text-lg font-bold">
                    {money(d.today.paid)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>
                    {d.today.count} purchase{d.today.count === 1 ? "" : "s"} ·{" "}
                    {pounds(num(d.today.pounds))}
                  </div>
                  <Delta
                    change={change(num(d.today.paid), num(d.yesterday.paid))}
                  />
                </div>
              </div>
              <TrendChart
                label="Money paid out per day, this branch"
                unit={money}
                height={130}
                points={d.series.map((p) => ({
                  date: p.date,
                  value: num(p.paid),
                }))}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MoneyTile />
        <DebtTile />
        <HeldTile />
      </div>
    </div>
  );
}
