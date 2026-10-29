import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Segmented } from "antd";
import { ArrowRightIcon, SearchIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { Kpi } from "@/features/dashboard/charts";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import {
  DataTable,
  EmptyState,
  Pager,
  type Column,
} from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useTransfers } from "../api";
import { purposeLabel, StatusChip } from "../labels";
import { matches, roadAge, summarize } from "../model";
import type { TransferRow } from "../schemas";

type Direction = "all" | "outgoing" | "incoming";
const DIRECTIONS: Direction[] = ["all", "outgoing", "incoming"];
const STATUSES = [
  ["", "Any"],
  ["draft", "Draft"],
  ["released", "On the way"],
  ["received", "Received"],
  ["received_with_discrepancy", "Differences"],
  ["cancelled", "Cancelled"],
] as const;
const PAGE = 20;

function Route({ r }: { r: TransferRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 font-medium">
      {r.originBranchName}
      <ArrowRightIcon
        className="size-3.5 text-muted-foreground"
        aria-label="to"
      />
      {r.destinationBranchName}
    </span>
  );
}

function WhenCell({ r }: { r: TransferRow }) {
  const age = roadAge(r);
  return (
    <div>
      <div className="whitespace-nowrap">
        {when(r.receivedAt ?? r.releasedAt ?? r.createdAt)}
      </div>
      {age ? (
        <div
          className={`text-xs ${age.tone === "stale" ? "font-semibold text-red-600" : age.tone === "late" ? "text-amber-700" : "text-muted-foreground"}`}
        >
          {age.text}
        </div>
      ) : null}
    </div>
  );
}

const columns: Column<TransferRow>[] = [
  {
    key: "ref",
    header: "Transfer",
    cell: (r) => (
      <>
        <div className="font-mono text-xs font-semibold">{r.reference}</div>
        <div className="text-xs text-muted-foreground">
          {r.kind === "cash"
            ? "Cash"
            : `${r.lineCount} piece${r.lineCount === 1 ? "" : "s"} of gold`}{" "}
          · {purposeLabel[r.purpose] ?? r.purpose}
        </div>
      </>
    ),
  },
  { key: "route", header: "From → to", cell: (r) => <Route r={r} /> },
  {
    key: "by",
    header: "Carried by",
    hideBelow: "lg",
    cell: (r) => (
      <span>
        {r.collectorName ?? (
          <span className="text-muted-foreground">Not set</span>
        )}
      </span>
    ),
  },
  {
    key: "worth",
    header: "Worth",
    align: "right",
    cell: (r) => (
      <span className="tnum font-semibold">
        {r.declaredValue ? cedis(Number(r.declaredValue)) : "—"}
      </span>
    ),
  },
  {
    key: "when",
    header: "When",
    hideBelow: "lg",
    cell: (r) => <WhenCell r={r} />,
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => <StatusChip status={r.status} />,
  },
];

function Card({ r }: { r: TransferRow }) {
  const age = roadAge(r);
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Route r={r} />
          <div className="font-mono text-xs text-muted-foreground">
            {r.reference}
          </div>
        </div>
        <StatusChip status={r.status} />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {r.kind === "cash"
            ? "Cash"
            : `${r.lineCount} piece${r.lineCount === 1 ? "" : "s"}`}{" "}
          · {r.collectorName ?? "no collector yet"}
        </span>
        <span className="tnum text-sm font-semibold text-foreground">
          {r.declaredValue ? cedis(Number(r.declaredValue)) : "—"}
        </span>
      </div>
      {age ? (
        <div
          className={`text-xs ${age.tone === "stale" ? "font-semibold text-red-600" : age.tone === "late" ? "text-amber-700" : "text-muted-foreground"}`}
        >
          {age.text}
        </div>
      ) : null}
    </div>
  );
}

export default function TransfersPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const direction = DIRECTIONS.find((d) => d === sp.get("direction")) ?? "all";
  const status = STATUSES.find(([v]) => v === sp.get("status"))?.[0] ?? "";
  const q = (sp.get("q") ?? "").slice(0, 60);
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);

  const set = (next: Record<string, string>) => {
    const merged = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) {
      if (v && !(k === "direction" && v === "all")) merged.set(k, v);
      else merged.delete(k);
    }
    if (!("page" in next)) merged.delete("page");
    setSp(merged, { replace: true });
  };

  // One read of everything for this branch; the screen narrows it, so the headline figures stay whole.
  const list = useTransfers({ branchId, direction: "all" });
  const all = list.data ?? [];
  const sum = useMemo(() => summarize(all, branchId), [all, branchId]);
  const rows = useMemo(
    () =>
      all.filter(
        (r) =>
          (direction === "all" ||
            (direction === "outgoing"
              ? r.originBranchId === branchId
              : r.destinationBranchId === branchId)) &&
          (!status || r.status === status) &&
          matches(r, q),
      ),
    [all, direction, status, q, branchId],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const narrowed = direction !== "all" || !!status || !!q;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Transfers"
        subtitle="Gold and cash moving between branches."
        actions={
          <Can permission={PERMISSIONS.TRANSFERS_CREATE}>
            <Link to={paths.transfers.create.href}>
              <Button>New transfer</Button>
            </Link>
          </Can>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          className="text-left"
          onClick={() => set({ direction: "incoming", status: "released" })}
        >
          <Kpi
            label="On the way here"
            value={sum.coming.count}
            sub={
              <span className="tnum text-xs text-muted-foreground">
                {sum.coming.count
                  ? `worth ${cedis(sum.coming.value)}`
                  : "Nothing coming"}
              </span>
            }
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() => set({ direction: "outgoing", status: "released" })}
        >
          <Kpi
            label="Sent from here"
            value={sum.going.count}
            sub={
              <span className="tnum text-xs text-muted-foreground">
                {sum.going.count
                  ? `worth ${cedis(sum.going.value)}`
                  : "Nothing on the road"}
              </span>
            }
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() => set({ status: "draft" })}
        >
          <Kpi
            label="Drafts"
            value={sum.drafts}
            sub={
              <span className="text-xs text-muted-foreground">
                {sum.drafts ? "Not handed over yet" : "None waiting"}
              </span>
            }
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() => set({ status: "received_with_discrepancy" })}
        >
          <Kpi
            label="With differences"
            value={sum.differences}
            sub={
              <span className="text-xs text-muted-foreground">
                {sum.differences ? "Did not match on arrival" : "All matched"}
              </span>
            }
          />
        </button>
      </div>

      {sum.stale > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm"
        >
          <strong>
            {sum.stale} transfer{sum.stale === 1 ? " has" : "s have"} been on
            the road for 3 days or more.
          </strong>{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => set({ status: "released" })}
          >
            Show them
          </button>
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
        <label className="relative block">
          <span className="sr-only">Search transfers</span>
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Search by number, branch or who carried it"
            value={q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="overflow-x-auto">
            <Segmented<Direction>
              value={direction}
              onChange={(v) => set({ direction: v })}
              options={[
                { label: "All", value: "all" },
                { label: "Sent from here", value: "outgoing" },
                { label: "Coming here", value: "incoming" },
              ]}
            />
          </div>
          <div className="overflow-x-auto">
            <Segmented<string>
              value={status}
              onChange={(v) => set({ status: v })}
              options={STATUSES.map(([value, label]) => ({ value, label }))}
            />
          </div>
        </div>
      </div>

      {list.error && !list.data ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(list.error)}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={shown}
        getKey={(r) => r.id}
        onRowClick={(r) => navigate(paths.transfers.detail.to(r.id))}
        mobileCard={(r) => <Card r={r} />}
        loading={list.isLoading}
        empty={
          narrowed ? (
            <EmptyState
              title="No transfers match"
              hint="Try another status, or clear the search."
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    setSp(new URLSearchParams(), { replace: true })
                  }
                >
                  Show all
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No transfers yet"
              hint="When gold or cash moves between branches, it is tracked here from the moment it is handed over until it is counted at the other end."
            />
          )
        }
      />
      {rows.length > 0 ? (
        <Pager
          text={`${(page - 1) * PAGE + 1}–${Math.min(rows.length, page * PAGE)} of ${rows.length}`}
          page={page}
          pages={pages}
          onPage={(p) => set({ page: String(p) })}
        />
      ) : null}
      {all.length >= 100 ? (
        <p className="text-xs text-muted-foreground">
          Showing the latest 100 transfers.
        </p>
      ) : null}
    </div>
  );
}
