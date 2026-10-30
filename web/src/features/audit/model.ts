import type { AuditEvent, AuditQuery } from "./api";

export const CATEGORIES: { key: string; label: string }[] = [
  { key: "purchase", label: "Purchases" },
  { key: "day", label: "Days" },
  { key: "cash", label: "Cash drawer" },
  { key: "transfer", label: "Transfers" },
  { key: "case", label: "Differences" },
  { key: "debt", label: "Debts and held gold" },
  { key: "payment", label: "Mobile money" },
  { key: "price", label: "Prices" },
  { key: "people", label: "Users" },
  { key: "customer", label: "Customers" },
  { key: "setup", label: "Branches" },
];
const WORDS: Record<string, string> = {
  "role.created": "Created a role",
  "role.updated": "Changed a role",
  "role.deleted": "Deleted a role",
};
/** The sentence for an event: the server's wording, with the few actions it has only a generic phrase for tidied. */
export const summaryOf = (e: Pick<AuditEvent, "action" | "summary">) =>
  WORDS[e.action] ?? e.summary;

export const categoryLabel = (k: string) =>
  CATEGORIES.find((c) => c.key === k)?.label ?? k;

export type Tone = "grey" | "green" | "amber" | "red" | "sky";
/** How worrying an action looks at a glance: reversals, rejections and failures stand out. */
export function toneOf(action: string): Tone {
  if (
    /voided|rejected|written_off|failed|cancelled|received_with_difference|case\.opened|reopened|password_reset/.test(
      action,
    )
  )
    return "red";
  if (/closed|released|resolved|feed_held|case\.assigned/.test(action))
    return "amber";
  if (
    /signed_off|approved|settled|repaid|confirmed|received$|applied|created|saved|opened|set$/.test(
      action,
    )
  )
    return "green";
  return "grey";
}

export type Range = "" | "today" | "7d" | "30d";
/** Start of a quick date range in the viewer's own clock, as an ISO moment. */
export function rangeStart(
  range: Range,
  now: Date = new Date(),
): string | undefined {
  if (!range) return undefined;
  const d = new Date(now);
  if (range === "today") d.setHours(0, 0, 0, 0);
  else {
    d.setDate(d.getDate() - (range === "7d" ? 7 : 30));
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

/** A calendar day (yyyy-mm-dd, from a date input) as the ISO moment it starts in the viewer's clock; `endOfDay` gives the start of the next day. */
export function dayBoundary(
  date: string,
  endOfDay = false,
): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d + (endOfDay ? 1 : 0)).toISOString();
}

export type Filters = {
  q: string;
  category: string;
  actorId: string;
  branchId: string;
  range: Range;
  from: string;
  to: string;
  minAmount: string;
  sort: "newest" | "oldest" | "amount";
  page: number;
  size: number;
};
export const NO_FILTERS: Filters = {
  q: "",
  category: "",
  actorId: "",
  branchId: "",
  range: "",
  from: "",
  to: "",
  minAmount: "",
  sort: "newest",
  page: 1,
  size: 25,
};

export function toQuery(f: Filters, now: Date = new Date()): AuditQuery {
  const custom = f.from || f.to;
  return {
    q: f.q.trim() || undefined,
    category: f.category || undefined,
    actorId: f.actorId || undefined,
    branchId: f.branchId || undefined,
    from: custom ? dayBoundary(f.from) : rangeStart(f.range, now),
    to: custom ? dayBoundary(f.to, true) : undefined,
    minAmount: f.minAmount || undefined,
    sort: f.sort === "newest" ? undefined : f.sort,
    page: f.page > 1 ? f.page : undefined,
    size: f.size === 25 ? undefined : f.size,
  };
}

/** How many filters (apart from sorting and paging) are narrowing the list. */
export const activeCount = (f: Filters) =>
  [
    f.q.trim(),
    f.category,
    f.actorId,
    f.branchId,
    f.range || f.from || f.to,
    f.minAmount,
  ].filter(Boolean).length;

/** Day heading for a group of events: "Today", "Yesterday" or "Mon 26 Oct". */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Groups already-sorted events under day headings, keeping the order. Not used when sorting by amount (a day heading would mislead). */
export function groupByDay(
  items: AuditEvent[],
  now: Date = new Date(),
): { heading: string; items: AuditEvent[] }[] {
  const out: { heading: string; items: AuditEvent[] }[] = [];
  for (const e of items) {
    const h = dayHeading(e.at, now);
    const last = out[out.length - 1];
    if (last && last.heading === h) last.items.push(e);
    else out.push({ heading: h, items: [e] });
  }
  return out;
}

/** "Name: value" lines for the detail view, from the event's details; empty values and nested objects are left out. */
const humanize = (k: string) => {
  const t = k.replace(/([A-Z])/g, " $1").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function detailLines(e: AuditEvent): [string, string][] {
  return Object.entries(e.detail ?? {})
    .filter(
      ([k, v]) =>
        v != null &&
        v !== "" &&
        typeof v !== "object" &&
        k !== "before" &&
        k !== "after",
    )
    .map(([k, v]) => [humanize(k), String(v)]);
}

/** Fields that differ between the before and after of a change to a user, customer or branch. */
export function changes(
  e: AuditEvent,
): { field: string; before: string; after: string }[] {
  const d = (e.detail ?? {}) as {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  };
  const before = d.before ?? {};
  const after = d.after ?? {};
  const show = (v: unknown) =>
    v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({
      field: humanize(k),
      before: show(before[k]),
      after: show(after[k]),
    }));
}

/** A CSV of the events on screen, for sharing with an auditor. */
export function toCsv(items: AuditEvent[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = items.map((e) =>
    [
      e.at,
      e.actor?.displayName ?? "",
      e.branch?.name ?? "",
      categoryLabel(e.category),
      e.action,
      summaryOf(e),
      e.amount ?? "",
    ]
      .map(q)
      .join(","),
  );
  return ["When,Who,Branch,Kind,Action,What,Amount", ...rows].join("\n");
}
