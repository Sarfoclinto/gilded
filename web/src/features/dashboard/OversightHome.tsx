import { useState } from "react";
import { Link } from "react-router-dom";
import { Segmented } from "antd";
import {
  CheckCircle2Icon,
  AlertTriangleIcon,
  InfoIcon,
  OctagonAlertIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { Chip } from "@/shared/ui/Chip";
import { SelectInput } from "@/shared/ui/SelectField";
import { Button } from "@/shared/ui/Button";
import {
  Delta,
  Kpi,
  Panel,
  RankBars,
  StackBar,
  TrendChart,
  money,
  pounds,
} from "./charts";
import { PerformancePanel } from "@/features/performance/PerformancePanel";
import { useDashboard, type Dashboard } from "./api";
import {
  attention,
  average,
  change,
  num,
  paymentSegments,
  shortDate,
  windowTotals,
  type HomeView,
} from "./model";

type Metric = "paid" | "count" | "pounds";
const METRICS: { value: Metric; label: string }[] = [
  { value: "paid", label: "Paid out" },
  { value: "count", label: "Purchases" },
  { value: "pounds", label: "Gold" },
];
const TONE_ICON = {
  bad: OctagonAlertIcon,
  warn: AlertTriangleIcon,
  info: InfoIcon,
} as const;
const TONE_CLASS = {
  bad: "text-red-600",
  warn: "text-amber-600",
  info: "text-sky-700",
} as const;
const DAY_CHIP = {
  open: ["green", "Open"],
  closed: ["grey", "Closed"],
  none: ["amber", "Not opened"],
} as const;

/** Manager and director home: how the business is doing, what needs a decision, and where the money and gold are. */
export default function OversightHome({ view }: { view: HomeView }) {
  const user = useAuth((s) => s.user);
  const canSignoff = !!user?.permissions.includes(PERMISSIONS.DAYS_SIGNOFF);
  const names = useBranchNames();
  const [branchId, setBranchId] = useState<string>("");
  const [days, setDays] = useState(14);
  const [showAll, setShowAll] = useState(false);
  const [metric, setMetric] = useState<Metric>("paid");
  const dash = useDashboard(branchId || null, days);
  const d = dash.data;
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const branchIds = user?.branchIds ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Hello, {user?.displayName}</h1>
          <p className="text-sm text-muted-foreground">
            {today} ·{" "}
            {view === "director" ? "Company overview" : "Branch overview"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branchIds.length > 1 ? (
            <div className="w-44">
              <SelectInput
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                aria-label="Branch"
              >
                <option value="">All branches</option>
                {branchIds.map((id) => (
                  <option key={id} value={id}>
                    {names[id] ?? "Branch"}
                  </option>
                ))}
              </SelectInput>
            </div>
          ) : null}
          <Segmented<number>
            value={days}
            onChange={setDays}
            options={[
              { value: 7, label: "7 days" },
              { value: 14, label: "14 days" },
              { value: 30, label: "30 days" },
            ]}
          />
          <Link to={paths.transactions.create.href}>
            <Button>New transaction</Button>
          </Link>
        </div>
      </div>

      {!d ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {dash.isError
            ? "The figures could not be loaded. Check the connection and try again."
            : "Loading the figures…"}
        </p>
      ) : (
        <Body
          d={d}
          view={view}
          canSignoff={canSignoff}
          metric={metric}
          setMetric={setMetric}
          showAll={showAll}
          setShowAll={setShowAll}
        />
      )}
    </div>
  );
}

function Body({
  d,
  view,
  canSignoff,
  metric,
  setMetric,
  showAll,
  setShowAll,
}: {
  d: Dashboard;
  view: HomeView;
  canSignoff: boolean;
  metric: Metric;
  setMetric: (m: Metric) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
}) {
  const totals = windowTotals(d.series);
  const paidChange = change(num(d.today.paid), num(d.yesterday.paid));
  const countChange = change(d.today.count, d.yesterday.count);
  const items = attention(d, { canSignoff });
  const segments = paymentSegments(d.payments);
  const unit =
    metric === "paid"
      ? money
      : metric === "count"
        ? (n: number) => `${n} purchase${n === 1 ? "" : "s"}`
        : pounds;
  const points = d.series.map((p) => ({
    date: p.date,
    value:
      metric === "paid"
        ? num(p.paid)
        : metric === "count"
          ? p.count
          : num(p.pounds),
  }));
  const windowText =
    metric === "paid"
      ? money(totals.paid)
      : metric === "count"
        ? `${totals.count} purchases`
        : pounds(totals.pounds);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Paid out today"
          value={money(d.today.paid)}
          sub={<Delta change={paidChange} />}
          to={paths.transactions.list.href + "?range=today"}
        />
        <Kpi
          label="Purchases today"
          value={d.today.count}
          sub={<Delta change={countChange} />}
          to={paths.transactions.list.href + "?range=today"}
        />
        <Kpi
          label="Gold bought today"
          value={pounds(num(d.today.pounds))}
          sub={
            <span className="text-xs text-muted-foreground">
              {pounds(num(d.stock.onHand))} on hand now
            </span>
          }
        />
        <Kpi
          label="Average purchase"
          value={money(average(d.today.paid, d.today.count))}
          sub={
            <span className="text-xs text-muted-foreground">
              {money(average(totals.paid, totals.count))} over {d.days} days
            </span>
          }
        />
      </div>

      <Panel title="Needs your attention">
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2Icon className="size-4" aria-hidden /> All clear.
            Nothing is waiting for you.
          </p>
        ) : (
          <>
            <ul className="grid gap-x-8 lg:grid-cols-2">
              {(showAll ? items : items.slice(0, 4)).map((a) => {
                const Icon = TONE_ICON[a.tone];
                return (
                  <li
                    key={a.key}
                    className="border-b border-border last:border-0"
                  >
                    <Link
                      to={a.to}
                      className="flex items-center gap-3 py-2 text-sm hover:opacity-80"
                    >
                      <Icon
                        className={`size-4 shrink-0 ${TONE_CLASS[a.tone]}`}
                        aria-hidden
                      />
                      <span>{a.text}</span>
                      <span className="ml-auto text-xs font-medium text-brand">
                        Open
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {items.length > 4 ? (
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="mt-2 text-xs font-medium text-brand"
              >
                {showAll ? "Show fewer" : `Show ${items.length - 4} more`}
              </button>
            ) : null}
          </>
        )}
      </Panel>

      <PerformancePanel />

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          title={`Last ${d.days} days`}
          className="lg:col-span-2"
          action={
            <Segmented<Metric>
              size="small"
              value={metric}
              onChange={setMetric}
              options={METRICS}
            />
          }
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tnum text-lg font-bold">{windowText}</span>
            <span className="text-xs text-muted-foreground">
              {totals.best
                ? `Best day ${shortDate(totals.best.date)} (${money(totals.best.paid)})`
                : "No purchases in this period"}
              {totals.perDay > 0
                ? ` · ${money(totals.perDay)} a day on average`
                : ""}
            </span>
          </div>
          <TrendChart
            label={`${METRICS.find((m) => m.value === metric)?.label} per day`}
            unit={unit}
            points={points}
          />
        </Panel>

        <Panel title="How people were paid">
          <StackBar segments={segments} empty="No payments in this period." />
          <p className="mt-3 text-xs text-muted-foreground">
            Last {d.days} days, cancelled purchases left out.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          title="Branches"
          className="lg:col-span-2"
          action={
            <span className="text-xs text-muted-foreground">
              Paid out, last {d.days} days
            </span>
          }
        >
          <RankBars
            empty="No branches to show."
            rows={d.branches.map((b) => ({
              key: b.branchId,
              label: b.name,
              value: num(b.periodPaid),
              text: money(b.periodPaid),
              sub: (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Chip tone={DAY_CHIP[b.day][0]}>{DAY_CHIP[b.day][1]}</Chip>
                  <span>
                    Today {money(b.todayPaid)} · {b.todayCount} purchase
                    {b.todayCount === 1 ? "" : "s"}
                  </span>
                  <span>{pounds(num(b.goldOnHand))} on hand</span>
                  {b.flagged > 0 ? (
                    <span className="text-amber-700">{b.flagged} flagged</span>
                  ) : null}
                  {b.signoffPending > 0 ? (
                    <span className="text-amber-700">
                      {b.signoffPending} to sign off
                    </span>
                  ) : null}
                </span>
              ),
            }))}
          />
        </Panel>

        <Panel
          title="Tellers"
          action={
            <span className="text-xs text-muted-foreground">
              Last {d.days} days
            </span>
          }
        >
          <RankBars
            empty="No purchases in this period."
            rows={(d.tellers ?? []).map((t) => ({
              key: t.userId,
              label: t.name,
              value: num(t.paid),
              text: money(t.paid),
              sub: `${t.count} purchase${t.count === 1 ? "" : "s"}${t.flagged ? ` · ${t.flagged} flagged` : ""}`,
            }))}
          />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Gold and money position">
          <dl className="space-y-2 text-sm">
            <Row label="Gold on hand" value={pounds(num(d.stock.onHand))} />
            <Row
              label="Gold in transit"
              value={pounds(num(d.stock.inTransit))}
            />
            <Row
              label="Transfers on the road"
              value={`${d.transfers.onTheRoad} · ${money(d.transfers.value)}`}
              to={paths.transfers.list.href}
            />
            <Row
              label="Owed to us"
              value={`${money(d.debts.owedToUs)}${d.debts.overdue ? ` (${d.debts.overdue} overdue)` : ""}`}
              to={paths.debts.href}
            />
            <Row
              label="Mobile money waiting"
              value={String(d.pendingMoney)}
              to={paths.payments.href}
            />
          </dl>
        </Panel>

        {view === "director" ? (
          <Panel
            title="Top customers"
            action={
              <span className="text-xs text-muted-foreground">
                Last {d.days} days
              </span>
            }
          >
            <RankBars
              empty="No named customers in this period."
              rows={(d.topCustomers ?? []).map((c) => ({
                key: c.customerId,
                label: c.name,
                value: num(c.paid),
                text: money(c.paid),
                sub: `${c.count} sale${c.count === 1 ? "" : "s"}`,
                to: paths.people.customer.to(c.customerId),
              }))}
            />
          </Panel>
        ) : null}

        <Panel
          title="Cash differences at closing"
          className={view === "director" ? "" : "lg:col-span-2"}
        >
          {!d.cashDifferences || d.cashDifferences.days === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2Icon className="size-4" aria-hidden /> Every day
              closed balanced in this period.
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm">
                {d.cashDifferences.days} day
                {d.cashDifferences.days === 1 ? "" : "s"}, net{" "}
                <span className="tnum font-semibold">
                  {money(d.cashDifferences.net)}
                </span>
              </p>
              <ul className="divide-y divide-border text-sm">
                {d.cashDifferences.recent.slice(0, 5).map((r) => (
                  <li
                    key={r.branch + r.date}
                    className="flex justify-between gap-2 py-1.5"
                  >
                    <span>
                      {r.branch} · {shortDate(r.date)}
                    </span>
                    <span
                      className={`tnum font-medium ${num(r.difference) < 0 ? "text-red-600" : "text-emerald-700"}`}
                    >
                      {num(r.difference) > 0 ? "+" : ""}
                      {money(r.difference)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  to,
}: {
  label: string;
  value: string;
  to?: string;
}) {
  const inner = (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tnum text-right font-semibold">{value}</dd>
    </>
  );
  return to ? (
    <Link to={to} className="flex justify-between gap-2 hover:opacity-80">
      {inner}
    </Link>
  ) : (
    <div className="flex justify-between gap-2">{inner}</div>
  );
}
