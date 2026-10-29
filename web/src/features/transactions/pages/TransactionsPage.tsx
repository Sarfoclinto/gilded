import { useCallback, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { Can } from "@/features/auth/useHasPermission";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { branches } from "@/features/branches/api";
import { errorMessage } from "@/shared/api/errors";
import { grams } from "@/shared/lib/numbers";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Chip } from "@/shared/ui/Chip";
import {
  DataTable,
  EmptyState,
  Pager,
  type Column,
} from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ExportTransactionsButton } from "@/features/exports/ExportTransactionsButton";
import { when } from "../format";
import { useTransactionSearch } from "../hooks";
import {
  appliedFilters,
  filtersFromParams,
  pageText,
  PAGE_SIZES,
  paramsFromFilters,
  queryFromFilters,
  type Filters,
} from "../search";
import { SyncChip } from "../SyncChip";
import { TransactionFilters } from "../TransactionFilters";
import {
  fromOutbox,
  fromServer,
  paymentMethodText,
  type TransactionView,
} from "../view";
import { TX_CREATE } from "@/app/outbox";

const netGrams = (t: TransactionView) =>
  t.items.reduce((s, i) => s + Number(i.result?.netWeight ?? 0), 0);
const methods = (t: TransactionView) => [
  ...new Set(t.payments.map((p) => p.method)),
];

function StatusCell({ t }: { t: TransactionView }) {
  if (t.status === "void") return <Chip tone="red">Cancelled</Chip>;
  return (
    <SyncChip
      sync={t.sync}
      flags={t.flags}
      pendingMoney={t.payments.filter((x) => x.status === "pending").length}
    />
  );
}

function PaidBy({ t }: { t: TransactionView }) {
  return (
    <div className="flex flex-wrap gap-1">
      {methods(t).map((m) => (
        <Chip key={m} tone={m === "cash" ? "grey" : "sky"}>
          {paymentMethodText[m] ?? m}
        </Chip>
      ))}
    </div>
  );
}

const columns: Column<TransactionView>[] = [
  {
    key: "when",
    header: "When",
    cell: (t) => (
      <span className="whitespace-nowrap">{when(t.capturedAt)}</span>
    ),
  },
  {
    key: "ref",
    header: "Receipt",
    cell: (t) => (
      <span className="font-mono text-xs">
        {t.reference ?? "Not numbered yet"}
      </span>
    ),
  },
  {
    key: "customer",
    header: "Customer",
    cell: (t) => (
      <>
        <div className="font-semibold">{t.customerName}</div>
        {t.customerPhone ? (
          <div className="text-xs text-muted-foreground">{t.customerPhone}</div>
        ) : null}
      </>
    ),
  },
  {
    key: "gold",
    header: "Gold",
    hideBelow: "lg",
    cell: (t) => (
      <span className="tnum whitespace-nowrap">
        {t.items.length} item{t.items.length === 1 ? "" : "s"} ·{" "}
        {grams(netGrams(t))}
      </span>
    ),
  },
  {
    key: "amount",
    header: "Paid (GHS)",
    align: "right",
    cell: (t) => (
      <span className="tnum font-bold">{cedis(t.payout.payable)}</span>
    ),
  },
  {
    key: "method",
    header: "Paid by",
    hideBelow: "lg",
    cell: (t) => <PaidBy t={t} />,
  },
  { key: "status", header: "Status", cell: (t) => <StatusCell t={t} /> },
  {
    key: "by",
    header: "Recorded by",
    hideBelow: "xl",
    cell: (t) => (
      <span className="text-muted-foreground">{t.createdBy ?? "—"}</span>
    ),
  },
];

function MobileCard({ t }: { t: TransactionView }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{t.customerName}</div>
          <div className="text-xs text-muted-foreground">
            {t.reference ?? "Not numbered yet"} · {when(t.capturedAt)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t.items.length} item{t.items.length === 1 ? "" : "s"} ·{" "}
            {grams(netGrams(t))}
          </div>
        </div>
        <div className="text-right">
          <div className="tnum font-bold">{cedis(t.payout.payable)}</div>
          <div className="mt-1">
            <StatusCell t={t} />
          </div>
        </div>
      </div>
    </>
  );
}

export default function TransactionsPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(sp), [sp]);
  const outbox = useOutbox();
  const branchList = branches.useList();
  const branchName = branchList.data?.find((b) => b.id === branchId)?.name;

  const query = useMemo(
    () => (branchId ? queryFromFilters(filters, branchId) : null),
    [filters, branchId],
  );
  const result = useTransactionSearch(query);

  const change = useCallback(
    (next: Partial<Filters>) => {
      // Anything but a page change starts again at page 1.
      const merged = { ...filtersFromParams(sp), ...next };
      if (!("page" in next)) merged.page = 1;
      setSp(paramsFromFilters(merged), { replace: true });
    },
    [sp, setSp],
  );

  // Purchases still waiting on this device belong at the top of the first page, when nothing narrows the list.
  const unfiltered =
    filters.page === 1 &&
    filters.sort === "newest" &&
    !filters.q &&
    !filters.status &&
    !filters.flagged &&
    !filters.min &&
    !filters.max;
  const waiting = useMemo(
    () =>
      unfiltered && branchId
        ? outbox.entries
            .filter((e) => e.type === TX_CREATE)
            .map(fromOutbox)
            .filter((t) => t.branchId === branchId)
        : [],
    [unfiltered, outbox.entries, branchId],
  );
  const server = useMemo(
    () => (result.data?.items ?? []).map(fromServer),
    [result.data],
  );
  const known = new Set(server.map((t) => t.id));
  const rows = [...waiting.filter((t) => !known.has(t.id)), ...server];
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / filters.size));
  const narrowed = appliedFilters(filters).length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-4 lg:p-6">
      <PageHeader
        title="Transactions"
        subtitle={[
          branchName,
          result.data ? pageText(filters.page, filters.size, total) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Can permission={PERMISSIONS.REPORTS_READ}>
              <ExportTransactionsButton />
            </Can>
            <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
              <Link to={paths.transactions.create.href}>
                <Button>New transaction</Button>
              </Link>
            </Can>
          </>
        }
      />

      {outbox.waiting.length > 0 ? (
        <Card className="flex items-center justify-between gap-3 border-amber-500/50 bg-amber-500/10">
          <p className="text-sm">
            <strong>{outbox.waiting.length}</strong> waiting to sync
          </p>
          <Button variant="secondary" onClick={() => void outbox.syncNow()}>
            Sync now
          </Button>
        </Card>
      ) : null}

      {outbox.failed.map((e) => (
        <Card
          key={e.id}
          className="space-y-2 border-red-500/50 bg-red-500/10"
          role="alert"
        >
          <p className="text-sm font-medium">
            The server refused one transaction
          </p>
          <p className="text-xs text-muted-foreground">
            {e.lastError?.message ?? "Unknown reason"}
          </p>
          <div className="flex gap-2">
            <Link to={paths.transactions.detail.to(e.id)}>
              <Button variant="secondary">View</Button>
            </Link>
            <Button variant="secondary" onClick={() => void outbox.retry(e.id)}>
              Try again
            </Button>
          </div>
        </Card>
      ))}

      <div className="tnum flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          <strong className="text-base text-foreground">
            {result.data ? total.toLocaleString("en-GH") : "—"}
          </strong>{" "}
          purchases
        </span>
        <span>
          <strong className="text-base text-foreground">
            {result.data ? cedis(result.data.sumPayable) : "—"}
          </strong>{" "}
          paid out{narrowed ? " for these filters" : ""}
        </span>
      </div>

      <TransactionFilters filters={filters} onChange={change} />

      {result.error && rows.length === 0 ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMessage(result.error)}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(t) => t.id}
        onRowClick={(t) => navigate(paths.transactions.detail.to(t.id))}
        mobileCard={(t) => <MobileCard t={t} />}
        loading={result.isLoading}
        refreshing={result.isFetching && result.isPlaceholderData}
        empty={
          narrowed ? (
            <EmptyState
              title="No purchases match"
              hint="Try a wider date range or clear a filter."
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    change({
                      q: "",
                      range: "all",
                      from: "",
                      to: "",
                      status: "",
                      flagged: false,
                      min: "",
                      max: "",
                    })
                  }
                >
                  Show everything
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No purchases yet"
              hint="Purchases you record, and those brought in from your old sheets, will appear here."
            />
          )
        }
      />

      {total > 0 ? (
        <Pager
          text={pageText(filters.page, filters.size, total)}
          page={filters.page}
          pages={pages}
          onPage={(page) => change({ page })}
          size={filters.size}
          sizes={PAGE_SIZES}
          onSize={(size) => change({ size })}
        />
      ) : null}
    </div>
  );
}
