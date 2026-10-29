import { useCallback, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Alert } from "antd";
import { ArrowLeftIcon, PhoneIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { Can } from "@/features/auth/useHasPermission";
import { useBranchNames } from "@/features/branches/api";
import { cedis } from "@/features/calculator/format";
import { Kpi, Panel } from "@/features/dashboard/charts";
import {
  transactionColumns,
  TransactionCard,
} from "@/features/transactions/columns";
import { day } from "@/features/transactions/format";
import { useTransactionSearch } from "@/features/transactions/hooks";
import {
  appliedFilters,
  filtersFromParams,
  pageText,
  PAGE_SIZES,
  paramsFromFilters,
  queryFromFilters,
  type Filters,
} from "@/features/transactions/search";
import { TransactionFilters } from "@/features/transactions/TransactionFilters";
import { fromServer } from "@/features/transactions/view";
import { errorMessage } from "@/shared/api/errors";
import { ago } from "@/shared/lib/dates";
import { grams } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { Chip } from "@/shared/ui/Chip";
import { DataTable, EmptyState, Pager } from "@/shared/ui/DataTable";
import { useCustomerDetail } from "../api";
import { CustomerFormModal } from "../CustomerFormModal";
import { MergeModal } from "../MergeModal";
import { Avatar } from "./CustomersPage";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const detail = useCustomerDetail(id);
  const c = detail.data;
  const branchNames = useBranchNames();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);

  // A customer's history starts as "all time"; the same filters as the main list.
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(sp, "all"), [sp]);
  const query = useMemo(
    () => (id ? { ...queryFromFilters(filters, null), customerId: id } : null),
    [filters, id],
  );
  const result = useTransactionSearch(query);
  const columns = useMemo(
    () => transactionColumns({ showCustomer: false, branchNames }),
    [branchNames],
  );
  const change = useCallback(
    (next: Partial<Filters>) => {
      const merged = { ...filtersFromParams(sp, "all"), ...next };
      if (!("page" in next)) merged.page = 1;
      setSp(paramsFromFilters(merged, "all"), { replace: true });
    },
    [sp, setSp],
  );

  if (detail.isLoading)
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!c) {
    return (
      <div className="space-y-2 p-4">
        <Alert
          type="error"
          showIcon
          title={
            detail.error ? errorMessage(detail.error) : "Customer not found."
          }
        />
        <Link className="text-sm underline" to={paths.people.customers.href}>
          Back to customers
        </Link>
      </div>
    );
  }

  const rows = (result.data?.items ?? []).map(fromServer);
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / filters.size));
  const narrowed = appliedFilters(filters, "all").length > 0;
  const owes = Number(c.owesUs),
    we = Number(c.weOwe);
  const avg = c.purchases > 0 ? Number(c.lifetimePaid) / c.purchases : 0;
  const partial = !narrowed && result.data && total < c.purchases;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <Link
        to={paths.people.customers.href}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden /> Customers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={c.name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{c.name}</h1>
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              {c.phone ? (
                <a
                  href={`tel:${c.phone}`}
                  className="inline-flex items-center gap-1 text-brand"
                >
                  <PhoneIcon className="size-3.5" aria-hidden />
                  {c.phone}
                </a>
              ) : (
                <span>No phone</span>
              )}
              <span>Customer since {day(c.createdAt)}</span>
            </p>
            {c.notes ? <p className="mt-1 text-sm">{c.notes}</p> : null}
          </div>
        </div>
        <Can permission={PERMISSIONS.CUSTOMERS_MANAGE}>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setMerging(true)}>
              Merge a duplicate
            </Button>
          </div>
        </Can>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Paid to them"
          value={cedis(c.lifetimePaid)}
          sub={<span className="text-xs text-muted-foreground">all time</span>}
        />
        <Kpi
          label="Purchases"
          value={c.purchases}
          sub={
            <span className="text-xs text-muted-foreground">
              {c.firstPurchaseAt
                ? `since ${day(c.firstPurchaseAt)}`
                : "none yet"}
            </span>
          }
        />
        <Kpi label="Average purchase" value={avg > 0 ? cedis(avg) : "—"} />
        <Kpi
          label="Last bought"
          value={c.lastPurchaseAt ? ago(c.lastPurchaseAt) : "Never"}
          sub={
            c.lastPurchaseAt ? (
              <span className="text-xs text-muted-foreground">
                {day(c.lastPurchaseAt)}
              </span>
            ) : null
          }
        />
        <Kpi
          label="Balance"
          value={owes > 0 ? cedis(owes) : we > 0 ? cedis(we) : "Settled"}
          sub={
            owes > 0 ? (
              <Chip tone="amber">Owes us</Chip>
            ) : we > 0 ? (
              <Chip tone="sky">We owe them</Chip>
            ) : (
              <span className="text-xs text-muted-foreground">
                Nothing outstanding
              </span>
            )
          }
          to={owes > 0 || we > 0 ? paths.debts.href : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Purchases</h2>
            <span className="tnum text-sm text-muted-foreground">
              {result.data ? (
                <>
                  <strong className="text-foreground">
                    {total.toLocaleString("en-GH")}
                  </strong>{" "}
                  ·{" "}
                  <strong className="text-foreground">
                    {cedis(result.data.sumPayable)}
                  </strong>{" "}
                  paid{narrowed ? " for these filters" : ""}
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
          <TransactionFilters
            filters={filters}
            onChange={change}
            defaultRange="all"
            compact
          />
          {partial ? (
            <p className="text-xs text-muted-foreground">
              You see the purchases made at your own branches: {total} of{" "}
              {c.purchases}.
            </p>
          ) : null}
          {result.error && rows.length === 0 ? (
            <p role="alert" className="text-sm text-red-600">
              {errorMessage(result.error)}
            </p>
          ) : null}
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(t) => t.id}
            onRowClick={(t) => navigate(paths.transactions.detail.to(t.id))}
            mobileCard={(t) => <TransactionCard t={t} showCustomer={false} />}
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
                      Show all purchases
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="No purchases yet"
                  hint="Purchases for this customer will appear here."
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

        <div className="min-w-0 space-y-4">
          <Panel
            title="Debts and loans"
            action={
              <Link
                to={paths.debts.href}
                className="text-xs font-medium text-brand"
              >
                Go to debts
              </Link>
            }
          >
            {c.debts.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {c.debts.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">
                        {d.direction === "receivable"
                          ? "Owes us"
                          : "We owe them"}{" "}
                        · {d.reason ?? "Debt"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {day(d.issuedAt)} · {cedis(Number(d.principal))} in
                        total
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tnum font-semibold">
                        {cedis(Number(d.outstanding))}
                      </div>
                      <Chip tone={d.status === "open" ? "amber" : "green"}>
                        {d.status === "open"
                          ? "Open"
                          : d.status.replace("_", " ")}
                      </Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {c.held.length > 0 ? (
            <Panel
              title="Gold held as security"
              action={
                <Link
                  to={paths.collateral.href}
                  className="text-xs font-medium text-brand"
                >
                  Held gold
                </Link>
              }
            >
              <ul className="divide-y divide-border text-sm">
                {c.held.map((h) => (
                  <li
                    key={h.id}
                    className="flex items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
                  >
                    <span>
                      {grams(h.topWeight)}
                      <span className="block text-xs text-muted-foreground">
                        {day(h.receivedAt)}
                        {h.description ? ` · ${h.description}` : ""}
                      </span>
                    </span>
                    <Chip
                      tone={
                        h.status === "held"
                          ? "amber"
                          : h.status === "converted"
                            ? "green"
                            : "grey"
                      }
                    >
                      {h.status === "held"
                        ? "Held"
                        : h.status === "converted"
                          ? "Refined and bought"
                          : "Handed back"}
                    </Chip>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>

      <CustomerFormModal
        open={editing}
        customer={c}
        onClose={() => setEditing(false)}
        onDone={() => setEditing(false)}
      />
      <MergeModal keep={merging ? c : null} onClose={() => setMerging(false)} />
    </div>
  );
}
