import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Segmented } from "antd";
import { SearchIcon } from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { Kpi } from "@/features/dashboard/charts";
import { errorMessage } from "@/shared/api/errors";
import { ago, initials } from "@/shared/lib/dates";
import { Button } from "@/shared/ui/Button";
import { Chip } from "@/shared/ui/Chip";
import {
  DataTable,
  EmptyState,
  Pager,
  type Column,
} from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { SelectInput } from "@/shared/ui/SelectField";
import { when } from "@/features/transactions/format";
import { useCustomerQuery, type CustomerRow } from "../api";
import { CustomerFormModal } from "../CustomerFormModal";
import {
  FILTER_HINTS,
  FILTER_LABELS,
  filtersFromParams,
  pageText,
  PAGE_SIZES,
  paramsFromFilters,
  queryFromFilters,
  SORT_LABELS,
  type CustomerFilter,
  type CustomerFilters,
  type CustomerSort,
} from "../search";

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-navy font-semibold text-gold ${size === "lg" ? "size-14 text-lg" : "size-9 text-xs"}`}
    >
      {initials(name)}
    </span>
  );
}

export function Balance({ c }: { c: Pick<CustomerRow, "owesUs" | "weOwe"> }) {
  const owes = Number(c.owesUs),
    we = Number(c.weOwe);
  if (owes <= 0 && we <= 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {owes > 0 ? <Chip tone="amber">Owes us {cedis(owes)}</Chip> : null}
      {we > 0 ? <Chip tone="sky">We owe {cedis(we)}</Chip> : null}
    </div>
  );
}

const columns: Column<CustomerRow>[] = [
  {
    key: "name",
    header: "Customer",
    cell: (c) => (
      <div className="flex items-center gap-3">
        <Avatar name={c.name} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{c.name}</div>
          <div className="text-xs text-muted-foreground">
            {c.phone ?? "No phone"}
          </div>
        </div>
      </div>
    ),
  },
  {
    key: "purchases",
    header: "Purchases",
    align: "right",
    cell: (c) => <span className="tnum">{c.purchases}</span>,
  },
  {
    key: "paid",
    header: "Paid to them",
    align: "right",
    hideBelow: "lg",
    cell: (c) => (
      <span className="tnum font-semibold">
        {Number(c.lifetimePaid) > 0 ? cedis(c.lifetimePaid) : "—"}
      </span>
    ),
  },
  {
    key: "last",
    header: "Last bought",
    hideBelow: "lg",
    cell: (c) =>
      c.lastPurchaseAt ? (
        <span title={when(c.lastPurchaseAt)}>{ago(c.lastPurchaseAt)}</span>
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
  },
  {
    key: "balance",
    header: "Balance",
    align: "right",
    cell: (c) => <Balance c={c} />,
  },
];

function Card({ c }: { c: CustomerRow }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar name={c.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{c.name}</div>
        <div className="text-xs text-muted-foreground">
          {c.phone ?? "No phone"} ·{" "}
          {c.lastPurchaseAt
            ? `bought ${ago(c.lastPurchaseAt).toLowerCase()}`
            : "never bought"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {c.purchases} purchase{c.purchases === 1 ? "" : "s"}
          </span>
          {Number(c.lifetimePaid) > 0 ? (
            <span className="tnum">{cedis(c.lifetimePaid)} paid</span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0">
        <Balance c={c} />
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(sp), [sp]);
  const [text, setText] = useState(filters.q);
  const [adding, setAdding] = useState(false);
  const result = useCustomerQuery(
    useMemo(() => queryFromFilters(filters), [filters]),
  );
  const data = result.data;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / filters.size));
  const summary = data?.summary;

  const change = useCallback(
    (next: Partial<CustomerFilters>) => {
      const merged = { ...filtersFromParams(sp), ...next };
      if (!("page" in next)) merged.page = 1;
      setSp(paramsFromFilters(merged), { replace: true });
    },
    [sp, setSp],
  );

  // The box waits a moment before asking the server, and follows the address (back button, links from the dashboard).
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const t = setTimeout(() => change({ q: text.trim() }), 350);
    return () => clearTimeout(t);
  }, [text, filters.q, change]);

  const narrowed = filters.q !== "" || filters.filter !== "all";

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Customers"
        subtitle="Everyone the business has bought from or lent to."
        actions={
          <Can permission={PERMISSIONS.CUSTOMERS_MANAGE}>
            <Button onClick={() => setAdding(true)}>Add a customer</Button>
          </Can>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Customers"
          value={summary ? summary.customers.toLocaleString("en-GH") : "—"}
          to={paths.people.customers.href}
        />
        <Kpi
          label="Bought in 30 days"
          value={summary ? summary.active.toLocaleString("en-GH") : "—"}
          to={`${paths.people.customers.href}?filter=active`}
        />
        <Kpi
          label="Owe us"
          value={summary ? cedis(summary.owesUs) : "—"}
          to={`${paths.people.customers.href}?filter=owes_us&sort=owes`}
        />
        <Kpi
          label="We owe"
          value={summary ? cedis(summary.weOwe) : "—"}
          to={`${paths.people.customers.href}?filter=we_owe&sort=owes`}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="relative block">
            <span className="sr-only">Search by name or phone</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              placeholder="Search by name or phone"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <SelectInput
            aria-label="Sort"
            value={filters.sort}
            onChange={(e) => change({ sort: e.target.value as CustomerSort })}
          >
            {(Object.keys(SORT_LABELS) as CustomerSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </SelectInput>
        </div>
        <div className="overflow-x-auto">
          <Segmented<CustomerFilter>
            value={filters.filter}
            onChange={(filter) => change({ filter })}
            options={(Object.keys(FILTER_LABELS) as CustomerFilter[]).map(
              (f) => ({ value: f, label: FILTER_LABELS[f] }),
            )}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {FILTER_HINTS[filters.filter]}
        </p>
      </div>

      {result.error && !data ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(result.error)}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getKey={(c) => c.id}
        onRowClick={(c) => navigate(paths.people.customer.to(c.id))}
        mobileCard={(c) => <Card c={c} />}
        loading={result.isLoading}
        refreshing={result.isFetching && result.isPlaceholderData}
        empty={
          narrowed ? (
            <EmptyState
              title="No customer matches"
              hint="Try a different name or phone number, or show everyone."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setText("");
                    change({ q: "", filter: "all" });
                  }}
                >
                  Show everyone
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No customers yet"
              hint="Customers are added when you record a purchase, or bring them in from a spreadsheet."
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

      <CustomerFormModal
        open={adding}
        customer={null}
        onClose={() => setAdding(false)}
        onDone={(c) => {
          setAdding(false);
          navigate(paths.people.customer.to(c.id));
        }}
      />
    </div>
  );
}
