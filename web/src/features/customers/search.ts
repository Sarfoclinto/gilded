/** The Customers screen's filters live in the address bar (?q=kofi&filter=owes_us&sort=paid&page=2), like the Transactions screen. */
export type CustomerFilter =
  | "all"
  | "owes_us"
  | "we_owe"
  | "active"
  | "inactive";
export type CustomerSort = "name" | "recent" | "purchases" | "paid" | "owes";

export const FILTER_LABELS: Record<CustomerFilter, string> = {
  all: "Everyone",
  owes_us: "Owes us",
  we_owe: "We owe",
  active: "Active",
  inactive: "Quiet",
};
export const FILTER_HINTS: Record<CustomerFilter, string> = {
  all: "Every customer",
  owes_us: "Customers with money outstanding to us",
  we_owe: "Customers we owe money to",
  active: "Bought in the last 30 days",
  inactive: "Nothing bought in 90 days, or never",
};
export const SORT_LABELS: Record<CustomerSort, string> = {
  name: "Name A to Z",
  recent: "Bought most recently",
  purchases: "Most purchases",
  paid: "Most paid to them",
  owes: "Largest balance",
};
export const PAGE_SIZES = [20, 50, 100] as const;

export interface CustomerFilters {
  q: string;
  filter: CustomerFilter;
  sort: CustomerSort;
  page: number;
  size: number;
}

export function filtersFromParams(sp: URLSearchParams): CustomerFilters {
  const filter =
    (Object.keys(FILTER_LABELS) as CustomerFilter[]).find(
      (f) => f === sp.get("filter"),
    ) ?? "all";
  const sort =
    (Object.keys(SORT_LABELS) as CustomerSort[]).find(
      (s) => s === sp.get("sort"),
    ) ?? "name";
  const size = PAGE_SIZES.find((s) => String(s) === sp.get("size")) ?? 20;
  return {
    q: (sp.get("q") ?? "").slice(0, 60),
    filter,
    sort,
    page: Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1),
    size,
  };
}

export function paramsFromFilters(f: CustomerFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.filter !== "all") sp.set("filter", f.filter);
  if (f.sort !== "name") sp.set("sort", f.sort);
  if (f.size !== 20) sp.set("size", String(f.size));
  if (f.page > 1) sp.set("page", String(f.page));
  return sp;
}

/** What to ask the server for. */
export function queryFromFilters(
  f: CustomerFilters,
): Record<string, string | number> {
  const q: Record<string, string | number> = {
    sort: f.sort,
    filter: f.filter,
    limit: f.size,
    offset: (f.page - 1) * f.size,
  };
  if (f.q) q.q = f.q;
  return q;
}

export function pageText(page: number, size: number, total: number): string {
  if (total === 0) return "No customers";
  const first = (page - 1) * size + 1;
  return `${first}–${Math.min(total, page * size)} of ${total.toLocaleString("en-GH")}`;
}
