/**
 * The Transactions screen's filters live in the address bar (?q=kofi&range=7d&page=2), so a refresh, the back button and a pasted link
 * all give the same list. This file turns the address into the server's query and a list of "applied filter" chips, and back.
 */
export type Range = "today" | "7d" | "30d" | "all" | "custom";
export type Sort = "newest" | "oldest" | "amount_desc" | "amount_asc";

export const SORT_LABELS: Record<Sort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  amount_desc: "Highest amount",
  amount_asc: "Lowest amount",
};
export const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  saved: "Saved",
  void: "Cancelled",
};
export const PAGE_SIZES = [25, 50, 100] as const;

export interface Filters {
  q: string;
  range: Range;
  from: string;
  to: string;
  status: string;
  flagged: boolean;
  min: string;
  max: string;
  sort: Sort;
  page: number;
  size: number;
}

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (today: Date, n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
};
const dateOk = (v: string | null) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
const numOk = (v: string | null) =>
  v && /^\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : "";

/** `defaultRange` is what the screen shows when the address says nothing: 30 days on the main list, all time on a customer's page. */
export function filtersFromParams(
  sp: URLSearchParams,
  defaultRange: Range = "30d",
): Filters {
  const range =
    (["today", "7d", "30d", "all", "custom"] as const).find(
      (r) => r === sp.get("range"),
    ) ?? defaultRange;
  const sort =
    (Object.keys(SORT_LABELS) as Sort[]).find((s) => s === sp.get("sort")) ??
    "newest";
  const size = PAGE_SIZES.find((s) => String(s) === sp.get("size")) ?? 25;
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const status = sp.get("status") ?? "";
  return {
    q: (sp.get("q") ?? "").slice(0, 60),
    range,
    from: dateOk(sp.get("from")),
    to: dateOk(sp.get("to")),
    status: status in STATUS_LABELS ? status : "",
    flagged: sp.get("flagged") === "1",
    min: numOk(sp.get("min")),
    max: numOk(sp.get("max")),
    sort,
    page,
    size,
  };
}

/** Only what differs from the defaults goes into the address. */
export function paramsFromFilters(
  f: Filters,
  defaultRange: Range = "30d",
): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.range !== defaultRange) sp.set("range", f.range);
  if (f.range === "custom") {
    if (f.from) sp.set("from", f.from);
    if (f.to) sp.set("to", f.to);
  }
  if (f.status) sp.set("status", f.status);
  if (f.flagged) sp.set("flagged", "1");
  if (f.min) sp.set("min", f.min);
  if (f.max) sp.set("max", f.max);
  if (f.sort !== "newest") sp.set("sort", f.sort);
  if (f.size !== 25) sp.set("size", String(f.size));
  if (f.page > 1) sp.set("page", String(f.page));
  return sp;
}

/** What to ask the server for. */
export function queryFromFilters(
  f: Filters,
  branchId: string | null,
  today: Date = new Date(),
): Record<string, string | number | boolean> {
  const q: Record<string, string | number | boolean> = {
    sort: f.sort,
    limit: f.size,
    offset: (f.page - 1) * f.size,
  };
  if (branchId) q.branchId = branchId;
  if (f.q) q.q = f.q;
  if (f.range === "today") {
    q.from = ymd(today);
    q.to = ymd(today);
  } else if (f.range === "7d") {
    q.from = ymd(daysAgo(today, 6));
    q.to = ymd(today);
  } else if (f.range === "30d") {
    q.from = ymd(daysAgo(today, 29));
    q.to = ymd(today);
  } else if (f.range === "custom") {
    if (f.from) q.from = f.from;
    if (f.to) q.to = f.to;
  }
  if (f.status) q.status = f.status;
  if (f.flagged) q.flagged = true;
  if (f.min) q.minAmount = f.min;
  if (f.max) q.maxAmount = f.max;
  return q;
}

export interface Applied {
  key: string;
  label: string;
  /** What clearing this chip changes. */
  clear: Partial<Filters>;
}

export const RANGE_LABELS: Record<Range, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
  custom: "Custom dates",
};

/** The chips under the filter bar. The date range is not a chip when it is the default. */
export function appliedFilters(
  f: Filters,
  defaultRange: Range = "30d",
): Applied[] {
  const out: Applied[] = [];
  if (f.q) out.push({ key: "q", label: `“${f.q}”`, clear: { q: "" } });
  if (f.range === "custom")
    out.push({
      key: "range",
      label:
        f.from || f.to ? `${f.from || "…"} to ${f.to || "…"}` : "Custom dates",
      clear: { range: defaultRange, from: "", to: "" },
    });
  else if (f.range !== defaultRange)
    out.push({
      key: "range",
      label: RANGE_LABELS[f.range],
      clear: { range: defaultRange },
    });
  if (f.status)
    out.push({
      key: "status",
      label: STATUS_LABELS[f.status] ?? f.status,
      clear: { status: "" },
    });
  if (f.flagged)
    out.push({
      key: "flagged",
      label: "Flagged only",
      clear: { flagged: false },
    });
  if (f.min || f.max)
    out.push({
      key: "amount",
      label: `GHS ${f.min || "0"} – ${f.max || "any"}`,
      clear: { min: "", max: "" },
    });
  return out;
}

/** How many filters sit behind the "Filters" button (status, flagged, amount). */
export const hiddenFilterCount = (f: Filters) =>
  (f.status ? 1 : 0) + (f.flagged ? 1 : 0) + (f.min || f.max ? 1 : 0);

export function pageText(page: number, size: number, total: number): string {
  if (total === 0) return "No purchases";
  const first = (page - 1) * size + 1;
  return `${first}–${Math.min(total, page * size)} of ${total.toLocaleString("en-GH")}`;
}
