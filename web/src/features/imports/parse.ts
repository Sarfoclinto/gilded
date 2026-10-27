import { calculate } from '@gold/core';

/** A table as read from a sheet or a csv file: rows of cells. */
export type Cell = string | number | boolean | Date | null | undefined;
export type Table = Cell[][];

export interface Problem {
  /** The row number as the person sees it in their sheet. */
  row: number;
  message: string;
}

export interface BranchRef {
  id: string;
  code: string;
  name: string;
}

export interface HistoryItem {
  label?: string;
  top: string;
  down: string;
  price: string;
}

export interface HistoryPurchase {
  /** The sheet row of the first line of this purchase. Also the key that makes resending safe. */
  key: string;
  branchId: string;
  capturedAt: string;
  customerName: string;
  customerPhone?: string;
  receiptNo?: string;
  note?: string;
  items: HistoryItem[];
  amountPaid?: string;
  sheetAmount?: string;
  /** What this device calculates, only for the preview. The server recalculates. */
  previewAmount: string;
}

export interface CustomerRow {
  name: string;
  phone: string;
  notes?: string;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES = {
  date: ['date', 'dateofpurchase', 'purchasedate', 'day'],
  time: ['time'],
  branch: ['branch', 'branchcode', 'location'],
  customer: ['customer', 'customername', 'name', 'client', 'seller'],
  phone: ['phone', 'phonenumber', 'mobile', 'tel', 'telephone', 'contact'],
  top: ['top', 'topweight', 'topreading'],
  down: ['down', 'downweight', 'bottom', 'bottomreading'],
  price: ['price', 'rate', 'unitprice', 'priceperounce'],
  paid: ['amountpaid', 'paid', 'payable', 'payout', 'paidout'],
  sheet: ['amount', 'total', 'sheetamount', 'value'],
  receipt: ['receipt', 'receiptno', 'receiptnumber', 'ref', 'reference', 'invoice'],
  note: ['note', 'notes', 'remarks', 'comment', 'comments'],
  label: ['item', 'itemlabel', 'description', 'piece'],
} as const;
type Field = keyof typeof ALIASES;

function headerIndex(table: Table): { at: number; cols: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const cols: Partial<Record<Field, number>> = {};
    table[r]!.forEach((cell, c) => {
      const n = norm(cell);
      if (!n) return;
      for (const f of Object.keys(ALIASES) as Field[]) if (cols[f] === undefined && (ALIASES[f] as readonly string[]).includes(n)) cols[f] = c;
    });
    if (Object.keys(cols).length >= 3) return { at: r, cols };
  }
  return null;
}

const isBlank = (row: Cell[]) => row.every((c) => c === null || c === undefined || String(c).trim() === '');

/** A number or text cell as plain text. Commas and currency marks are dropped from figures. */
export function figure(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : null;
  if (cell instanceof Date || typeof cell === 'boolean') return null;
  const s = cell.trim().replace(/gh[₵s]|₵|ghc|\s|,/gi, '');
  return s === '' ? null : s;
}

const text = (cell: Cell, max: number): string | undefined => {
  if (cell === null || cell === undefined || cell instanceof Date) return undefined;
  const s = String(cell).trim();
  return s ? s.slice(0, max) : undefined;
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** yyyy-mm-dd from a date cell, an Excel serial number, or text like 2026-03-02 or 02/03/2026 (day first). */
export function dateOf(cell: Cell): string | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : ymd(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
  if (typeof cell === 'number') {
    if (cell < 20000 || cell > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof cell !== 'string') return null;
  const s = cell.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return ymd(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  return null;
}

function timeOf(cell: Cell): string {
  if (cell instanceof Date) return `${pad(cell.getUTCHours())}:${pad(cell.getUTCMinutes())}`;
  if (typeof cell === 'number' && cell >= 0 && cell < 1) {
    const mins = Math.round(cell * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const m = typeof cell === 'string' ? /^(\d{1,2}):(\d{2})/.exec(cell.trim()) : null;
  return m && +m[1]! < 24 && +m[2]! < 60 ? `${pad(+m[1]!)}:${m[2]}` : '12:00';
}

function phoneOf(cell: Cell): string | undefined {
  if (typeof cell === 'number') {
    const s = String(Math.trunc(cell));
    return s.length === 9 ? `0${s}` : s;   // Excel drops the leading 0 of a number
  }
  return text(cell, 30)?.replace(/\s+/g, '');
}

// ---------------------------------------------------------------- customers
export function parseCustomers(table: Table): { rows: CustomerRow[]; problems: Problem[] } {
  const h = headerIndex(table);
  if (!h || h.cols.customer === undefined || h.cols.phone === undefined)
    return { rows: [], problems: [{ row: 1, message: 'The first row must have the columns Name and Phone (Notes is optional).' }] };
  const rows: CustomerRow[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (let r = h.at + 1; r < table.length; r++) {
    const line = table[r]!;
    if (isBlank(line)) continue;
    const name = text(line[h.cols.customer], 120);
    const phone = phoneOf(line[h.cols.phone]);
    if (!name) { problems.push({ row: r + 1, message: 'The name is missing.' }); continue; }
    if (!phone) { problems.push({ row: r + 1, message: `${name}: the phone number is missing.` }); continue; }
    const dup = `${name.toLowerCase()}|${phone}`;
    if (seen.has(dup)) { problems.push({ row: r + 1, message: `${name} (${phone}) is already listed above.` }); continue; }
    seen.add(dup);
    rows.push({ name, phone, notes: text(line[h.cols.note ?? -1], 300) });
  }
  return { rows, problems };
}

// ---------------------------------------------------------------- past purchases
export function parseHistory(table: Table, branches: BranchRef[], defaultBranchId: string | null, now = new Date()): { purchases: HistoryPurchase[]; problems: Problem[] } {
  const h = headerIndex(table);
  const need: Field[] = ['date', 'customer', 'top', 'down', 'price'];
  const missing = h ? need.filter((f) => h.cols[f] === undefined) : need;
  if (!h || missing.length > 0)
    return { purchases: [], problems: [{ row: 1, message: `The first row needs these columns: Date, Customer, Top, Down, Price. Missing: ${missing.join(', ')}.` }] };
  if (h.cols.branch === undefined && !defaultBranchId)
    return { purchases: [], problems: [{ row: 1, message: 'There is no Branch column. Choose the branch these purchases belong to.' }] };

  const cols = h.cols as Record<Field, number | undefined>;
  const problems: Problem[] = [];
  const purchases: HistoryPurchase[] = [];
  const grouped = new Map<string, HistoryPurchase>();
  const today = ymd(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())!;

  for (let r = h.at + 1; r < table.length; r++) {
    const line = table[r]!;
    if (isBlank(line)) continue;
    const at = (f: Field) => (cols[f] === undefined ? undefined : line[cols[f]!]);
    const row = r + 1;
    const bad = (message: string) => problems.push({ row, message });

    let branch: BranchRef | undefined;
    const branchText = text(at('branch'), 60);
    if (branchText) {
      branch = branches.find((b) => norm(b.code) === norm(branchText) || norm(b.name) === norm(branchText));
      if (!branch) { bad(`Branch "${branchText}" is not one of your branches.`); continue; }
    } else {
      branch = branches.find((b) => b.id === defaultBranchId);
      if (!branch) { bad('The branch is missing.'); continue; }
    }
    const day = dateOf(at('date'));
    if (!day) { bad('The date is missing or not valid. Use a date like 2026-03-02 or 02/03/2026.'); continue; }
    if (day > today) { bad('The date is in the future.'); continue; }
    const name = text(at('customer'), 120);
    if (!name) { bad('The customer name is missing.'); continue; }
    const top = figure(at('top')), down = figure(at('down')), price = figure(at('price'));
    if (!top || !down || !price) { bad('Top, down and price are all needed.'); continue; }
    const result = calculate({ top, down, price });
    if (result.errors.length > 0 || !result.amount) { bad(result.errors[0]?.message ?? 'This piece cannot be calculated.'); continue; }
    const item: HistoryItem = { label: text(at('label'), 80), top, down, price };
    const paid = figure(at('paid')) ?? undefined;
    const sheet = figure(at('sheet')) ?? undefined;
    if (paid !== undefined && !(Number(paid) >= 0)) { bad('The amount paid is not a number.'); continue; }
    if (sheet !== undefined && !(Number(sheet) >= 0)) { bad('The amount is not a number.'); continue; }
    const receipt = text(at('receipt'), 40);

    // Lines of one receipt (same branch, day and customer) are the pieces of one purchase.
    const groupKey = receipt ? `${branch.id}|${receipt}|${day}|${name.toLowerCase()}` : null;
    const existing = groupKey ? grouped.get(groupKey) : undefined;
    if (existing) {
      if (existing.items.length >= 20) { bad('A purchase can have at most 20 pieces.'); continue; }
      existing.items.push(item);
      existing.previewAmount = String(Number(existing.previewAmount) + Number(result.amount));
      existing.amountPaid ??= paid;
      existing.sheetAmount ??= sheet;
      continue;
    }
    const purchase: HistoryPurchase = {
      key: String(row), branchId: branch.id, capturedAt: `${day}T${timeOf(at('time'))}:00Z`, customerName: name,
      customerPhone: phoneOf(at('phone')), receiptNo: receipt, note: text(at('note'), 300), items: [item],
      amountPaid: paid, sheetAmount: sheet, previewAmount: result.amount,
    };
    purchases.push(purchase);
    if (groupKey) grouped.set(groupKey, purchase);
  }
  return { purchases, problems };
}

// ---------------------------------------------------------------- reading files
/** Reads comma-separated text, with quoted fields, into a table. */
export function parseCsv(input: string): Table {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const delimiter = (input.split('\n', 1)[0] ?? '').includes(';') && !(input.split('\n', 1)[0] ?? '').includes(',') ? ';' : ',';
  const text = input.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export async function readTable(file: File): Promise<Table> {
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Use an Excel file (.xlsx) or a csv file.');
  const { readSheet } = await import('read-excel-file/browser');
  return (await readSheet(file)) as Table;
}

// ---------------------------------------------------------------- templates (csv opens in Excel)
export const customersTemplate = 'Name,Phone,Notes\nKofi Boateng,0241000001,Regular\n';
export const historyTemplate =
  'Date,Branch,Customer,Phone,Item,Top,Down,Price,Amount paid,Receipt no,Note\n' +
  '2026-03-02,TKW,Kofi Boateng,0241000001,Ring,7.77,0.41,11650,1000,R-17,\n' +
  '2026-03-02,TKW,Ama Serwaa,0242000002,Chain,12.40,0.52,11650,,R-18,two pieces on one receipt\n' +
  '2026-03-02,TKW,Ama Serwaa,0242000002,Bracelet,5.10,0.33,11650,,R-18,\n';

export function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};