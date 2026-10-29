import { useEffect, useState } from "react";
import { Segmented } from "antd";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { SelectInput } from "@/shared/ui/SelectField";
import {
  appliedFilters,
  hiddenFilterCount,
  SORT_LABELS,
  STATUS_LABELS,
  type Filters,
  type Range,
  type Sort,
} from "./search";

const field =
  "min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

/** Search, date range, sort and the less used filters. Every change goes back to page 1. */
export function TransactionFilters({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
}) {
  const [text, setText] = useState(filters.q);
  const [more, setMore] = useState(hiddenFilterCount(filters) > 0);
  const hidden = hiddenFilterCount(filters);
  const applied = appliedFilters(filters);

  // Typing waits a moment before asking the server; the box also follows the address (back button, "clear").
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const t = setTimeout(() => onChange({ q: text.trim() }), 350);
    return () => clearTimeout(t);
  }, [text, filters.q, onChange]);

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_11rem_auto]">
          <label className="relative block md:col-span-2 xl:col-span-1">
            <span className="sr-only">
              Search by customer, phone or receipt
            </span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${field} pl-9`}
              placeholder="Search customer, phone or receipt"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="overflow-x-auto">
            <Segmented<Range>
              value={filters.range}
              onChange={(range) => onChange({ range })}
              options={[
                { label: "Today", value: "today" },
                { label: "7 days", value: "7d" },
                { label: "30 days", value: "30d" },
                { label: "All", value: "all" },
                { label: "Custom", value: "custom" },
              ]}
            />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 md:contents">
            <SelectInput
              aria-label="Sort"
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as Sort })}
            >
              {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </SelectInput>
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-expanded={more}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              <SlidersHorizontalIcon className="size-4" /> Filters
              {hidden > 0 ? (
                <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">
                  {hidden}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {filters.range === "custom" ? (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">From</span>
              <input
                type="date"
                className={field}
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => onChange({ from: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">To</span>
              <input
                type="date"
                className={field}
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => onChange({ to: e.target.value })}
              />
            </label>
          </div>
        ) : null}

        {more ? (
          <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="mb-1 block text-sm text-muted-foreground">
                Status
              </span>
              <SelectInput
                aria-label="Status"
                value={filters.status}
                onChange={(e) => onChange({ status: e.target.value })}
              >
                <option value="">Any status</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </SelectInput>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                Smallest amount (GHS)
              </span>
              <input
                inputMode="decimal"
                className={field}
                value={filters.min}
                onChange={(e) =>
                  onChange({ min: e.target.value.replace(/[^\d.]/g, "") })
                }
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                Largest amount (GHS)
              </span>
              <input
                inputMode="decimal"
                className={field}
                value={filters.max}
                onChange={(e) =>
                  onChange({ max: e.target.value.replace(/[^\d.]/g, "") })
                }
              />
            </label>
            <label className="flex items-end gap-2 pb-3 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={filters.flagged}
                onChange={(e) => onChange({ flagged: e.target.checked })}
              />{" "}
              Only flagged purchases
            </label>
          </div>
        ) : null}
      </div>

      {applied.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {applied.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => onChange(a.clear)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium hover:bg-muted/70"
              aria-label={`Remove filter ${a.label}`}
            >
              {a.label} <XIcon className="size-3" />
            </button>
          ))}
          <button
            type="button"
            className="text-xs underline text-muted-foreground"
            onClick={() =>
              onChange({
                q: "",
                range: "30d",
                from: "",
                to: "",
                status: "",
                flagged: false,
                min: "",
                max: "",
              })
            }
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
