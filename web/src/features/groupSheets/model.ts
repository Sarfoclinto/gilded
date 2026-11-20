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
  /** Quantity sheets: what came in and went out that day, and what was in hand at its end. */
  qtyIn?: string;
  qtyOut?: string;
  stock?: string | null;
  entries: (Entry & { pending?: Pending })[];
}

const milli = (v: string | number | null | undefined) =>
  Math.round(Number(v ?? 0) * 1000);
const fromMilli = (m: number) => String(m / 1000);
const pendingAmount = (p: Pending) =>
  p.amount ? (p.direction === "out" ? -1 : 1) * Number(p.amount) : 0;
const pendingQty = (p: Pending) =>
  p.quantity ? (p.qtyDirection === "out" ? -1 : 1) * Number(p.quantity) : 0;

/**
 * The sheet as this device sees it: the server's days, with entries still waiting to be sent folded in (marked), and the balance (and the
 * quantity in hand) moved by them. Pending entries for other sheets, or for another person when the sheet is shown for one person, are
 * ignored. Pure, so it is tested without a browser.
 */
export function withPending(
  sheet: SheetDetail,
  pending: Pending[],
  me: { id: string; displayName: string },
): { days: DayView[]; balance: string; stock: string | null; waiting: number } {
  const quantity = sheet.kind === "quantity";
  const mine = pending.filter(
    (p) =>
      p.sheetId === sheet.id &&
      (!sheet.personId || p.personId === sheet.personId),
  );
  const known = new Set(sheet.days.flatMap((d) => d.entries.map((e) => e.id)));
  const extra = mine.filter((p) => !known.has(p.id));
  const byDate = new Map<string, DayView>(
    sheet.days.map((d) => [d.date, { ...d, entries: [...d.entries] }]),
  );
  const personName = (id?: string) =>
    sheet.people?.find((x) => x.id === id)?.name ?? "";
  for (const p of extra) {
    if (p.moneyDate < sheet.from) continue; // older than the period on screen: counted in the balance only
    const q = pendingQty(p);
    const e: Entry & { pending: Pending } = {
      id: p.id,
      sheetId: p.sheetId,
      amount: String(pendingAmount(p)),
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
      person: p.personId
        ? { id: p.personId, name: personName(p.personId), userId: null }
        : null,
      quantity: q ? String(q) : null,
      photos: [],
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
  // recount every day from its entries and run the balance (and stock) forward from the period's start
  const days = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  let running = cents(sheet.balanceBefore);
  let stock = milli(sheet.stockBefore);
  for (const p of extra)
    if (p.moneyDate < sheet.from) {
      running += cents(pendingAmount(p));
      stock += milli(pendingQty(p));
    }
  for (const d of days) {
    // a taking back and the line it cancels net to zero: left out of in and out, but still in the balance
    const counted = d.entries.filter((e) => !e.takesBack && !e.takenBack);
    const inC = counted.reduce((s, e) => s + Math.max(cents(e.amount), 0), 0);
    const outC = counted.reduce((s, e) => s + Math.max(-cents(e.amount), 0), 0);
    running += d.entries.reduce((s, e) => s + cents(e.amount), 0);
    d.in = fromCents(inC);
    d.out = fromCents(outC);
    d.closing = fromCents(running);
    if (quantity) {
      d.qtyIn = fromMilli(
        counted.reduce((s, e) => s + Math.max(milli(e.quantity), 0), 0),
      );
      d.qtyOut = fromMilli(
        counted.reduce((s, e) => s + Math.max(-milli(e.quantity), 0), 0),
      );
      stock += d.entries.reduce((s, e) => s + milli(e.quantity), 0);
      d.stock = fromMilli(stock);
    }
  }
  const later = extra.filter((p) => p.moneyDate > sheet.to);
  return {
    days: days.reverse(),
    balance: fromCents(
      running + later.reduce((s, p) => s + cents(pendingAmount(p)), 0),
    ),
    stock: quantity
      ? fromMilli(stock + later.reduce((s, p) => s + milli(pendingQty(p)), 0))
      : null,
    waiting: extra.length,
  };
}

/** "0.5 kg", "−1.25 kg": a quantity with its unit; "+" only when asked. */
export function qty(
  v: string | number | null | undefined,
  unit?: string | null,
  sign = false,
): string {
  const n = Number(v ?? 0);
  const s = Math.abs(n).toLocaleString("en-GH", { maximumFractionDigits: 3 });
  return `${n < 0 ? "−" : sign && n > 0 ? "+" : ""}${s}${unit ? ` ${unit}` : ""}`;
}

/** A quantity typed by a person: "0.5", "1,250" → "0.5", "1250"; null when not usable. */
export function cleanQuantity(typed: string): string | null {
  const t = typed.replace(/[,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(t)) return null;
  return Number(t) > 0 ? t.replace(/^0+(?=\d)/, "") : null;
}

/** The entries on screen as a spreadsheet file (CSV), oldest first, with the running balance; the same figures as the page. */
export function sheetCsv(sheet: SheetDetail, days: DayView[]): string {
  const quantity = sheet.kind === "quantity";
  const people = sheet.kind === "people";
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = [
    "Date",
    ...(people ? ["Person"] : []),
    "Note",
    "In (GHS)",
    "Out (GHS)",
    ...(quantity
      ? [`In (${sheet.unit ?? ""})`, `Out (${sheet.unit ?? ""})`]
      : []),
    "Written by",
    "Written at",
    "Status",
  ];
  const rows: string[][] = [];
  const brought = [
    sheet.from,
    ...(people ? [""] : []),
    "Brought forward",
    "",
    "",
    ...(quantity ? ["", ""] : []),
    "",
    "",
    sheet.balanceBefore,
  ];
  rows.push(brought);
  for (const d of [...days].reverse()) {
    for (const e of [...d.entries].reverse()) {
      const a = Number(e.amount);
      const q = Number(e.quantity ?? 0);
      rows.push([
        d.date,
        ...(people ? [e.person?.name ?? ""] : []),
        e.note ?? (e.takesBack ? "Taken back" : ""),
        a > 0 ? String(a) : "",
        a < 0 ? String(-a) : "",
        ...(quantity ? [q > 0 ? String(q) : "", q < 0 ? String(-q) : ""] : []),
        e.writtenBy.displayName,
        e.writtenAt,
        e.pending
          ? "waiting to send"
          : e.takenBack
            ? "taken back"
            : e.takesBack
              ? "takes back an entry"
              : e.dayTotal
                ? "day total"
                : "",
      ]);
    }
    rows.push([
      d.date,
      ...(people ? [""] : []),
      "Closing",
      d.in,
      d.out,
      ...(quantity ? [d.qtyIn ?? "", d.qtyOut ?? ""] : []),
      "",
      "",
      `balance ${d.closing}${quantity ? `; in hand ${d.stock ?? ""}` : ""}`,
    ]);
  }
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
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
      return `${who} started the sheet "${d.sheet}"${d.kind === "people" ? " (savings per person)" : d.kind === "quantity" ? ` (money and ${d.unit ?? "quantity"}${d.openingQuantity && Number(d.openingQuantity) !== 0 ? `, ${qty(d.openingQuantity, d.unit)} in hand` : ""})` : ""}${d.openingBalance && Number(d.openingBalance) !== 0 ? ` with ${money(d.openingBalance)}` : ""}`;
    case "sheet_renamed":
      return `${who} renamed the sheet "${d.from}" to "${d.to}"`;
    case "sheet_closed":
      return `${who} closed "${d.sheet}"`;
    case "sheet_reopened":
      return `${who} reopened "${d.sheet}"`;
    case "person_added":
      return `${who} added ${d.name} to "${d.sheet}"`;
    case "person_renamed":
      return `${who} renamed ${d.from} to ${d.to} on "${d.sheet}"`;
    case "photo_removed":
      return `${who} took a photo off an entry on "${d.sheet}"${a.subject && a.subject.displayName !== who ? ` (added by ${them})` : ""}`;
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
