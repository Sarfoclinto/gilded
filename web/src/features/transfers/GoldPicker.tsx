import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { cedis } from "@/features/calculator/format";
import { EmptyState } from "@/shared/ui/DataTable";
import { filterItems, pickedTotals } from "./model";
import type { TransferableItem } from "./schemas";

/** Choose which pieces of gold to send: search, tick, "select all shown", and a running total. */
export function GoldPicker({
  rows,
  picked,
  onChange,
  loading,
}: {
  rows: TransferableItem[];
  picked: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => filterItems(rows, q), [rows, q]);
  const totals = pickedTotals(rows, picked);
  const shownIds = shown.map((i) => i.itemId);
  const allShown =
    shownIds.length > 0 && shownIds.every((id) => picked.includes(id));
  const toggle = (id: string) =>
    onChange(
      picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id],
    );

  if (loading && rows.length === 0)
    return (
      <div
        className="h-32 animate-pulse rounded-xl border border-border bg-muted/50"
        aria-busy="true"
      />
    );
  if (rows.length === 0)
    return (
      <EmptyState
        title="No gold to send"
        hint="Gold bought at this branch that is still here will appear in this list."
      />
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search the gold</span>
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Search customer, receipt or piece"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
          onClick={() =>
            onChange(
              allShown
                ? picked.filter((id) => !shownIds.includes(id))
                : [...new Set([...picked, ...shownIds])],
            )
          }
        >
          {allShown ? "Clear these" : q ? "Select these" : "Select all"}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Nothing matches “{q}”.
        </p>
      ) : (
        <ul className="max-h-[26rem] divide-y divide-border overflow-auto rounded-xl border border-border bg-card">
          {shown.map((i) => {
            const on = picked.includes(i.itemId);
            return (
              <li key={i.itemId}>
                <label
                  className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50 ${on ? "bg-amber-500/5" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[#0d1b2e]"
                    checked={on}
                    onChange={() => toggle(i.itemId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">
                        {i.customerName} · {i.label}
                      </span>
                      <span className="tnum shrink-0 text-sm font-semibold">
                        {cedis(Number(i.value))}
                      </span>
                    </span>
                    <span className="tnum block text-xs text-muted-foreground">
                      {i.reference} · top {i.top} g · down {i.down} g
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="tnum text-sm text-muted-foreground" aria-live="polite">
        {totals.count ? (
          <>
            <strong className="text-foreground">{totals.count}</strong> selected
            · top{" "}
            {totals.top.toLocaleString("en-GH", { maximumFractionDigits: 2 })} g
            · worth{" "}
            <strong className="text-foreground">{cedis(totals.value)}</strong>
          </>
        ) : (
          `${rows.length} piece${rows.length === 1 ? "" : "s"} available`
        )}
      </p>
    </div>
  );
}
