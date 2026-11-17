import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Segmented } from "antd";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { Kpi } from "@/features/dashboard/charts";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Chip } from "@/shared/ui/Chip";
import { EmptyState } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useDebtSummary, useDebts } from "../api";
import { byUrgency, dueOf, matches, repaidShare } from "../model";
import { RepayModal } from "../RepayModal";
import type { Debt } from "../schemas";

type Direction = "receivable" | "payable";

function DebtCard({
  d,
  open,
  onToggle,
  onRepay,
}: {
  d: Debt;
  open: boolean;
  onToggle: () => void;
  onRepay: () => void;
}) {
  const due = dueOf(d);
  const share = repaidShare(d);
  const settled = d.status !== "open";
  return (
    <Card
      className={`p-0 ${due.state === "overdue" ? "border-red-400/70" : due.state === "soon" ? "border-amber-400/70" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-3 text-left sm:p-4"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{d.party.name}</span>
            {settled ? (
              <Chip tone="green">
                {d.status === "settled"
                  ? "Settled"
                  : d.status.replace("_", " ")}
              </Chip>
            ) : null}
            {due.state === "overdue" ? (
              <Chip tone="red">{due.text}</Chip>
            ) : due.state === "soon" ? (
              <Chip tone="amber">{due.text}</Chip>
            ) : null}
            {d.collateral?.status === "held" ? (
              <Chip tone="sky">Gold held</Chip>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {d.party.phone ?? d.party.type} · since {when(d.issuedAt)}
            {due.state === "ok" ? ` · ${due.text.toLowerCase()}` : ""}
            {d.reason ? ` · ${d.reason}` : ""}
          </div>
          <div className="pt-1" aria-hidden>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-emerald-600"
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
          </div>
          <div className="tnum text-xs text-muted-foreground">
            {cedis(Number(d.repaid))} paid back of {cedis(Number(d.principal))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">
            {settled ? "Outstanding" : "Still owed"}
          </div>
          <div className="tnum text-xl font-bold">
            {cedis(Number(d.outstanding))}
          </div>
        </div>
        <ChevronDownIcon
          className={`mt-1 size-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {d.status === "open" ? (
        <Can permission={PERMISSIONS.DEBTS_MANAGE}>
          <div className="flex justify-end border-t border-border px-3 py-2 sm:px-4">
            <Button variant="secondary" onClick={onRepay}>
              {d.direction === "receivable" ? "Record repayment" : "Pay"}
            </Button>
          </div>
        </Can>
      ) : null}
      {open ? (
        <div className="space-y-3 border-t border-border p-3 text-sm sm:p-4">
          {d.collateral ? (
            <p>
              Security: {d.collateral.topWeight} g unrefined gold (
              {d.collateral.status})
              {d.collateral.description ? ` · ${d.collateral.description}` : ""}{" "}
              ·{" "}
              <Link className="underline" to={paths.collateral.href}>
                held gold
              </Link>
            </p>
          ) : null}
          {d.sourceTransactionId ? (
            <p>
              <Link
                className="underline"
                to={paths.transactions.detail.to(d.sourceTransactionId)}
              >
                From a purchase
              </Link>
            </p>
          ) : null}
          {d.repayments.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {d.repayments.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span>
                    {when(r.receivedAt)} ·{" "}
                    {r.method === "gold"
                      ? "settled with gold"
                      : r.method.replace("_", " ")}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                  <strong className="tnum">{cedis(Number(r.amount))}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No payments yet.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export default function DebtsPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const [direction, setDirection] = useState<Direction>("receivable");
  const [openOnly, setOpenOnly] = useState(true);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useDebts({ branchId, direction, openOnly });
  // the figures come from the server over all debts; the list below may be a page of them
  const summary = useDebtSummary(branchId);
  const [repay, setRepay] = useState<Debt | null>(null);
  const a = summary.data?.receivable;
  const b = summary.data?.payable;
  const dash = "—";
  const rows = useMemo(
    () => byUrgency(list.data ?? []).filter((d) => matches(d, q)),
    [list.data, q],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Debts and loans"
        subtitle="Money customers owe this branch, and money this branch owes them."
        actions={
          <Can permission={PERMISSIONS.DEBTS_MANAGE}>
            <Link to={paths.debts.newLoan.href}>
              <Button>Give a loan</Button>
            </Link>
          </Can>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          className="text-left"
          onClick={() => setDirection("receivable")}
        >
          <Kpi
            label="Owed to us"
            value={a ? cedis(Number(a.total)) : dash}
            sub={
              <span className="text-xs text-muted-foreground">
                {a ? `${a.open} open` : ""}
              </span>
            }
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() => setDirection("payable")}
        >
          <Kpi
            label="We owe"
            value={b ? cedis(Number(b.total)) : dash}
            sub={
              <span className="text-xs text-muted-foreground">
                {b ? `${b.open} open` : ""}
              </span>
            }
          />
        </button>
        <Kpi
          label="Overdue"
          value={
            a && b ? (
              <span className={a.overdue + b.overdue ? "text-red-600" : ""}>
                {a.overdue + b.overdue}
              </span>
            ) : (
              dash
            )
          }
          sub={
            <span className="text-xs text-muted-foreground">
              Past the pay-back date
            </span>
          }
        />
        <Kpi
          label="Gold held as security"
          value={a ? a.held : dash}
          sub={
            <Link to={paths.collateral.href} className="text-xs underline">
              See held gold
            </Link>
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="overflow-x-auto">
          <Segmented<Direction>
            value={direction}
            onChange={setDirection}
            options={[
              { label: "Owed to us", value: "receivable" },
              { label: "We owe", value: "payable" },
            ]}
          />
        </div>
        <Segmented
          value={openOnly ? "open" : "all"}
          onChange={(v) => setOpenOnly(v === "open")}
          options={[
            { label: "Open", value: "open" },
            { label: "All", value: "all" },
          ]}
        />
      </div>
      {(list.data?.length ?? 0) > 5 ? (
        <label className="relative block">
          <span className="sr-only">Search debts</span>
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Search by name, phone or reason"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      ) : null}

      {!openOnly &&
      summary.data &&
      (list.data?.length ?? 0) >= 200 &&
      summary.data.allCount > 200 ? (
        <p className="text-xs text-muted-foreground">
          Showing the 200 newest of {summary.data.allCount} debts, settled ones
          included. Open debts are always all shown under Open.
        </p>
      ) : null}
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      {list.isLoading ? (
        <div
          className="h-32 animate-pulse rounded-xl border border-border bg-muted/50"
          aria-busy="true"
        />
      ) : null}
      {!list.isLoading && rows.length === 0 ? (
        <EmptyState
          title={
            q
              ? "No match"
              : openOnly
                ? "Nothing outstanding"
                : "Nothing recorded"
          }
          hint={
            q
              ? "Try another name."
              : direction === "receivable"
                ? "When a customer takes a loan or owes after a purchase, it appears here."
                : "Amounts this branch owes customers appear here."
          }
        />
      ) : null}

      <ul className="space-y-2">
        {rows.map((d) => (
          <li key={d.id}>
            <DebtCard
              d={d}
              open={expanded === d.id}
              onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
              onRepay={() => setRepay(d)}
            />
          </li>
        ))}
      </ul>

      <RepayModal debt={repay} onClose={() => setRepay(null)} />
    </div>
  );
}
