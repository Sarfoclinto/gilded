import type { Entry, Pending, SheetDetail } from "./types";

/** "GHS 1,240.00", "−GHS 60.00" */
export function money(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const s = Math.abs(n).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "−" : ""}GHS ${s}`;
}

/** "+150", "−40.50" for an entry line */
export function signed(v: string | number): string {
  const n = Number(v);
  const s = Math.abs(n).toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "−" : "+"}${s}`;
}

/** An amount typed by a person: "1,200", "12.5", " 40 " → "1200", "12.5", "40". Null when it is not a usable amount. */
export function cleanAmount(typed: string): string | null {
  const t = typed.replace(/[,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t) > 0 ? t.replace(/^0+(?=\d)/, "") : null;
}

const cents = (v: string | number) => Math.round(Number(v) * 100);
const fromCents = (c: number) => String(c / 100);

export interface DayView {
  date: string;
  in: string;
  out: string;
  closing: string;
  entries: (Entry & { pending?: Pending })[];
}

/**
 * The sheet as this device sees it: the server's days, with entries still waiting to be sent folded in (marked), and the balance
 * moved by them. Pending entries for other sheets are ignored. Pure, so it is tested without a browser.
 */
export function withPending(
  sheet: SheetDetail,
  pending: Pending[],
  me: { id: string; displayName: string },
): { days: DayView[]; balance: string; waiting: number } {
  const mine = pending.filter((p) => p.sheetId === sheet.id);
  const known = new Set(sheet.days.flatMap((d) => d.entries.map((e) => e.id)));
  const extra = mine.filter((p) => !known.has(p.id));
  const byDate = new Map<string, DayView>(
    sheet.days.map((d) => [d.date, { ...d, entries: [...d.entries] }]),
  );
  for (const p of extra) {
    if (p.moneyDate < sheet.from) continue; // older than the period on screen: counted in the balance only
    const amount = (p.direction === "out" ? -1 : 1) * Number(p.amount);
    const e: Entry & { pending: Pending } = {
      id: p.id,
      sheetId: p.sheetId,
      amount: String(amount),
      moneyDate: p.moneyDate,
      note: p.note ?? null,
      dayTotal: p.dayTotal,
      takesBack: null,
      writtenBy: me,
      writtenAt: p.writtenAt,
      receivedAt: p.writtenAt,
      afterRemoval: false,
      mine: true,
      takenBack: null,
      pending: p,
    };
    const d = byDate.get(p.moneyDate) ?? {
      date: p.moneyDate,
      in: "0",
      out: "0",
      closing: "0",
      entries: [],
    };
    d.entries = [e, ...d.entries];
    byDate.set(p.moneyDate, d);
  }
  // recount every day from its entries and run the balance forward from the period's start
  const days = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  let running = cents(sheet.balanceBefore);
  for (const p of extra)
    if (p.moneyDate < sheet.from)
      running += cents((p.direction === "out" ? -1 : 1) * Number(p.amount));
  for (const d of days) {
    // a taking back and the line it cancels net to zero: left out of in and out, but still in the balance
    const counted = d.entries.filter((e) => !e.takesBack && !e.takenBack);
    const inC = counted.reduce((s, e) => s + Math.max(cents(e.amount), 0), 0);
    const outC = counted.reduce((s, e) => s + Math.max(-cents(e.amount), 0), 0);
    running += d.entries.reduce((s, e) => s + cents(e.amount), 0);
    d.in = fromCents(inC);
    d.out = fromCents(outC);
    d.closing = fromCents(running);
  }
  const later = extra
    .filter((p) => p.moneyDate > sheet.to)
    .reduce(
      (s, p) => s + cents((p.direction === "out" ? -1 : 1) * Number(p.amount)),
      0,
    );
  return {
    days: days.reverse(),
    balance: fromCents(running + later),
    waiting: extra.length,
  };
}

/** A sentence for the group's log. */
export function activityText(
  a: {
    kind: string;
    actor: { displayName: string } | null;
    subject: { displayName: string } | null;
    detail: Record<string, unknown>;
  },
  sheetName?: (id: string) => string | undefined,
): string {
  const who = a.actor?.displayName ?? "Someone";
  const them = a.subject?.displayName ?? "someone";
  const d = a.detail as Record<string, string | undefined>;
  const sheet =
    d.sheet ?? (d.sheetId ? sheetName?.(d.sheetId) : undefined) ?? "a sheet";
  const role = (r?: string) =>
    r === "keeper"
      ? "a keeper"
      : r === "writer"
        ? "a writer"
        : r === "reader"
          ? "a reader"
          : (r ?? "");
  const access = (x?: string) =>
    x === "write"
      ? "see and write"
      : x === "read"
        ? "see only"
        : x === "none"
          ? "not see"
          : "the role decides";
  switch (a.kind) {
    case "group_created":
      return `${who} created the group "${d.name ?? ""}"`;
    case "group_renamed":
      return `${who} renamed the group from "${d.from}" to "${d.to}"`;
    case "member_added":
      return `${who} added ${them}, as ${role(d.role)}`;
    case "role_changed":
      return `${who} made ${them} ${role(d.to)} (was ${role(d.from)})`;
    case "member_removed":
      return `${who} took ${them} out of the group`;
    case "member_left":
      return `${them} left the group`;
    case "member_back":
      return `${who} let ${them} back in, as ${role(d.role)}`;
    case "rule_added":
      return `${who} added everyone at ${d.branch}, as ${d.role}s`;
    case "rule_changed":
      return `${who} made everyone at ${d.branch} ${d.role}s (were ${d.from}s)`;
    case "rule_removed":
      return `${who} stopped adding everyone at ${d.branch}`;
    case "keeper_named":
      return `${who} named ${them} keeper, as the group had none left`;
    case "sheet_created":
      return `${who} started the sheet "${d.sheet}"${d.openingBalance && Number(d.openingBalance) !== 0 ? ` with ${money(d.openingBalance)}` : ""}`;
    case "sheet_renamed":
      return `${who} renamed the sheet "${d.from}" to "${d.to}"`;
    case "sheet_closed":
      return `${who} closed "${d.sheet}"`;
    case "sheet_reopened":
      return `${who} reopened "${d.sheet}"`;
    case "sheet_deleted":
      return `${who} deleted the empty sheet "${d.sheet}"`;
    case "access_changed":
      return `${who} set "${d.sheet}" to ${access(d.access)} for ${a.subject ? them : "everyone"}`;
    case "entry_taken_back":
      return `${who} took back ${a.actor && a.subject && a.actor.displayName === a.subject.displayName ? "their own" : `${them}'s`} ${signed(d.amount ?? 0)} on "${sheet}" (${d.moneyDate})`;
    case "entry_after_removal":
      return `${them}'s ${signed(d.amount ?? 0)} on "${sheet}" arrived after they lost access (written ${d.writtenAt ? new Date(d.writtenAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "earlier"})`;
    default:
      return `${who}: ${a.kind}`;
  }
}

export const roleLabel = (r: string) =>
  r === "keeper" ? "Keeper" : r === "writer" ? "Writer" : "Reader";
