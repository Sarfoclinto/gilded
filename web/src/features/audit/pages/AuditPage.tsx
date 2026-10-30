import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Drawer, Segmented } from "antd";
import { Download, RefreshCw, SearchIcon, X } from "lucide-react";
import { useAllBranches } from "@/features/branches/api";
import { cedis } from "@/features/calculator/format";
import { clock } from "@/features/cash/model";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Chip } from "@/shared/ui/Chip";
import { EmptyState, Pager } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { initials } from "@/shared/lib/dates";
import { useAudit, type AuditEvent } from "../api";
import {
  activeCount,
  CATEGORIES,
  categoryLabel,
  changes,
  detailLines,
  groupByDay,
  NO_FILTERS,
  toneOf,
  toCsv,
  toQuery,
  type Filters,
  type Range,
} from "../model";

const SIZES = [25, 50, 100] as const;
const SORTS: [Filters["sort"], string][] = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["amount", "Biggest amount"],
];
const field =
  "min-h-11 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

function read(sp: URLSearchParams): Filters {
  const num = (k: string, d: number) => {
    const n = Number(sp.get(k));
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : d;
  };
  return {
    q: sp.get("q") ?? "",
    category: sp.get("category") ?? "",
    actorId: sp.get("who") ?? "",
    branchId: sp.get("branch") ?? "",
    range: (sp.get("range") ?? "") as Range,
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    minAmount: sp.get("min") ?? "",
    sort: (sp.get("sort") as Filters["sort"]) || "newest",
    page: num("page", 1),
    size: num("size", 25),
  };
}
const KEYS: Record<keyof Filters, string> = {
  q: "q",
  category: "category",
  actorId: "who",
  branchId: "branch",
  range: "range",
  from: "from",
  to: "to",
  minAmount: "min",
  sort: "sort",
  page: "page",
  size: "size",
};

function DetailDrawer({
  e,
  onClose,
}: {
  e: AuditEvent | null;
  onClose: () => void;
}) {
  const lines = e ? detailLines(e) : [];
  const diff = e ? changes(e) : [];
  return (
    <Drawer
      open={!!e}
      onClose={onClose}
      size="default"
      title={e ? categoryLabel(e.category) : ""}
    >
      {e ? (
        <div className="space-y-4">
          <div>
            <p className="text-lg font-semibold">{e.summary}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(e.at).toLocaleString("en-GH", {
                dateStyle: "full",
                timeStyle: "medium",
              })}
            </p>
          </div>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Who</dt>
            <dd className="font-medium">
              {e.actor?.displayName ?? "The system"}
            </dd>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="font-medium">{e.branch?.name ?? "Whole company"}</dd>
            {e.amount != null ? (
              <>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="tnum font-medium">{cedis(e.amount)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Action</dt>
            <dd>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {e.action}
              </code>
            </dd>
            <dt className="text-muted-foreground">Record</dt>
            <dd className="break-all text-xs text-muted-foreground">
              {e.entityType} · {e.entityId}
            </dd>
          </dl>
          {lines.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Details</h3>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                {lines.map(([k, v]) => (
                  <Fragment key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          ) : null}
          {diff.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">What changed</h3>
              <ul className="space-y-1.5 text-sm">
                {diff.map((c) => (
                  <li
                    key={c.field}
                    className="rounded-lg border border-border p-2"
                  >
                    <p className="text-xs text-muted-foreground">{c.field}</p>
                    <p>
                      <span className="text-red-700 line-through">
                        {c.before}
                      </span>{" "}
                      <span className="text-muted-foreground">→</span>{" "}
                      <span className="font-medium text-emerald-700">
                        {c.after}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

export default function AuditPage() {
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => read(sp), [sp]);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const branches = useAllBranches();
  const q = useAudit(toQuery(f));
  const d = q.data;

  const set = (patch: Partial<Filters>, keepPage = false) => {
    const n: Filters = {
      ...f,
      ...patch,
      page: keepPage ? (patch.page ?? f.page) : 1,
    };
    const next = new URLSearchParams();
    (Object.keys(KEYS) as (keyof Filters)[]).forEach((k) => {
      const v = n[k];
      if (v !== "" && v !== NO_FILTERS[k]) next.set(KEYS[k], String(v));
    });
    setSp(next, { replace: true });
  };
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  const narrowed = activeCount(f);
  const groups =
    f.sort === "amount"
      ? [{ heading: "Biggest amounts first", items: d?.items ?? [] }]
      : groupByDay(d?.items ?? []);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([toCsv(d?.items ?? [])], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const totalAll = d
    ? Object.values(d.categories).reduce((s, n) => s + n, 0)
    : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Audit trail"
        subtitle="Who did what, when and where. It is read straight from the records, so it cannot be edited."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw
                className={`mr-1.5 size-4 ${q.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              variant="secondary"
              onClick={download}
              disabled={!d?.items.length}
            >
              <Download className="mr-1.5 size-4" />
              Export this page
            </Button>
          </>
        }
      />

      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className={`${field} w-full pl-9 pr-9`}
            placeholder="Search what happened, who did it, a branch, a reference or a reason"
            value={typed ?? f.q}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                set({ q: typed ?? f.q });
                setTyped(null);
              }
            }}
            onBlur={() => {
              if (typed !== null && typed !== f.q) set({ q: typed });
              setTyped(null);
            }}
          />
          {(typed ?? f.q) ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              onClick={() => {
                setTyped(null);
                set({ q: "" });
              }}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Person"
            className={field}
            value={f.actorId}
            onChange={(e) => set({ actorId: e.target.value })}
          >
            <option value="">Anyone</option>
            {(d?.actors ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? "Unknown"} ({a.count})
              </option>
            ))}
            {f.actorId && !(d?.actors ?? []).some((a) => a.id === f.actorId) ? (
              <option value={f.actorId}>Selected person</option>
            ) : null}
          </select>
          <select
            aria-label="Branch"
            className={field}
            value={f.branchId}
            onChange={(e) => set({ branchId: e.target.value })}
          >
            <option value="">Every branch</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <div className="max-w-full overflow-x-auto">
            <Segmented
              value={f.from || f.to ? "" : f.range}
              onChange={(v) =>
                set({ range: String(v) as Range, from: "", to: "" })
              }
              options={[
                { label: "Any time", value: "" },
                { label: "Today", value: "today" },
                { label: "7 days", value: "7d" },
                { label: "30 days", value: "30d" },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            From{" "}
            <input
              type="date"
              className={field}
              value={f.from}
              onChange={(e) => set({ from: e.target.value, range: "" })}
            />
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            To{" "}
            <input
              type="date"
              className={field}
              value={f.to}
              onChange={(e) => set({ to: e.target.value, range: "" })}
            />
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            Amount from{" "}
            <input
              inputMode="decimal"
              className={`${field} w-28`}
              placeholder="GHS"
              value={f.minAmount}
              onChange={(e) =>
                set({ minAmount: e.target.value.replace(/[^\d.]/g, "") })
              }
            />
          </label>
          <label className="ml-auto flex items-center gap-2 text-muted-foreground">
            Sort
            <select
              aria-label="Sort"
              className={field}
              value={f.sort}
              onChange={(e) => set({ sort: e.target.value as Filters["sort"] })}
            >
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {narrowed > 0 ? (
            <button
              type="button"
              className="min-h-10 rounded-lg px-3 text-sm underline"
              onClick={() => {
                setTyped(null);
                setSp(new URLSearchParams(), { replace: true });
              }}
            >
              Clear {narrowed} filter{narrowed === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Kind of event"
      >
        {[{ key: "", label: "Everything" }, ...CATEGORIES].map((c) => {
          const n = c.key ? (d?.categories[c.key] ?? 0) : totalAll;
          const on = f.category === c.key;
          return (
            <button
              key={c.key || "all"}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={!!c.key && n === 0 && !on}
              onClick={() => set({ category: c.key })}
              className={`min-h-10 shrink-0 rounded-full border px-3 text-sm transition-colors disabled:opacity-40 ${on ? "border-navy bg-navy text-white" : "border-border bg-card hover:bg-muted"}`}
            >
              {c.label}{" "}
              <span
                className={`tnum ml-1 text-xs ${on ? "text-white/70" : "text-muted-foreground"}`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {q.error && !d ? (
        <Alert type="error" showIcon title={errorMessage(q.error)} />
      ) : null}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}

      {d && d.items.length === 0 ? (
        <EmptyState
          title={narrowed ? "Nothing matches" : "Nothing recorded yet"}
          hint={
            narrowed
              ? "Try fewer filters or other words."
              : "Actions appear here as people work."
          }
          action={
            narrowed ? (
              <Button
                variant="secondary"
                onClick={() => setSp(new URLSearchParams(), { replace: true })}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <div
        className={
          q.isFetching && d
            ? "opacity-70 transition-opacity"
            : "transition-opacity"
        }
      >
        {groups.map((g) => (
          <section key={g.heading} className="mb-4">
            <h2 className="sticky top-0 z-[1] -mx-1 bg-background/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
              {g.heading}
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {g.items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(e)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-navy text-xs font-semibold text-white"
                      title={e.actor?.displayName ?? "The system"}
                    >
                      {e.actor ? initials(e.actor.displayName) : "⚙"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {e.summary}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {e.actor?.displayName ?? "The system"}
                        {e.branch ? ` · ${e.branch.name}` : ""} · {clock(e.at)}
                      </span>
                    </span>
                    <span className="hidden shrink-0 sm:block">
                      <Chip tone={toneOf(e.action)}>
                        {categoryLabel(e.category)}
                      </Chip>
                    </span>
                    {e.amount != null ? (
                      <span className="tnum shrink-0 text-sm font-semibold">
                        {cedis(e.amount)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {d && d.total > 0 ? (
        <Pager
          text={`${(d.page - 1) * d.size + 1}–${Math.min(d.total, d.page * d.size)} of ${d.total.toLocaleString("en-GH")}`}
          page={d.page}
          pages={pages}
          onPage={(p) => set({ page: p }, true)}
          size={f.size}
          sizes={SIZES}
          onSize={(n) => set({ size: n })}
        />
      ) : null}
      {d ? (
        <p className="text-xs text-muted-foreground">
          Read from the records at {clock(d.asOf)}. Work done on a device that
          has not synced yet appears here once it has.
        </p>
      ) : null}
      <DetailDrawer e={open} onClose={() => setOpen(null)} />
    </div>
  );
}
