import { addLines, lineTotal, subtractLines, type Lines } from '@gold/core';
import type { Day, DayState, Movement } from '@/features/drawer/schemas';
import type { Caller, Fail } from './transactions';

/**
 * Server-side behaviour of the cash drawer, as the real API must implement it:
 * - one open day per branch, one day per branch per business date
 * - every command is idempotent on its id
 * - balance = opening + top-ups - withdrawals - payouts applied to this day
 * - closing never rejects a count: it records expected, counted and the difference, and asks for sign-off
 * - a payout that arrives with no open day is kept and flagged, never refused
 */
interface Store {
  days: Day[];
  movements: Movement[];
  payouts: Record<string, Record<string, Lines>>; // dayId -> txId -> notes paid out
  closeIds: Record<string, string>; // dayId -> id of the command that closed it
}
const KEY = 'mock.days.v1';
const load = (): Store => {
  try {
    return { days: [], movements: [], payouts: {}, closeIds: {}, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Store>) };
  } catch {
    return { days: [], movements: [], payouts: {}, closeIds: {} };
  }
};
const save = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s));

const OFFLINE_MS = 2 * 60 * 1000;
const who = (c: Caller) => ({ id: c.id, displayName: c.displayName });

function balanceOf(s: Store, day: Day): Lines {
  let b: Lines = { ...day.opening.lines };
  for (const m of s.movements.filter((x) => x.dayId === day.id)) b = m.kind === 'topup' ? addLines(b, m.lines) : subtractLines(b, m.lines);
  for (const lines of Object.values(s.payouts[day.id] ?? {})) b = subtractLines(b, lines);
  return b;
}

const forBranch = (s: Store, branchId: string) =>
  s.days.filter((d) => d.branchId === branchId).sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.openedAt.localeCompare(a.openedAt));

export function currentState(branchId: string): DayState {
  const s = load();
  const days = forBranch(s, branchId);
  const day = days.find((d) => d.status === 'open') ?? days[0] ?? null;
  const lastClosed = days.find((d) => d.status === 'closed');
  const applied = day ? [...Object.keys(s.payouts[day.id] ?? {}), ...s.movements.filter((m) => m.dayId === day.id).map((m) => m.id), day.id, ...(s.closeIds[day.id] ? [s.closeIds[day.id]!] : [])] : [];
  return {
    day,
    balance: day && day.status === 'open' ? balanceOf(s, day) : null,
    movements: day ? s.movements.filter((m) => m.dayId === day.id) : [],
    appliedIds: applied,
    carryOver: lastClosed?.closing?.counted ?? null,
    asOf: new Date().toISOString(),
  };
}

export const listDays = (branchId: string, limit: number) => forBranch(load(), branchId).slice(0, limit);

function checkBranch(c: Caller, branchId: string, fail: Fail) {
  if (!c.branchIds.includes(branchId)) return fail(403, 'BRANCH_NOT_ASSIGNED', 'You are not assigned to this branch.');
  return null;
}

const validLines = (l: unknown): l is Lines =>
  !!l && typeof l === 'object' && Object.entries(l as Lines).every(([d, n]) => [200, 100, 50, 20, 10, 5].includes(Number(d)) && Number.isInteger(n) && n > 0);

export async function openDay(body: any, c: Caller, fail: Fail): Promise<{ status: 200 | 201; data: Day }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = load();
  const same = s.days.find((d) => d.id === body.id);
  if (same) return { status: 200, data: same };
  await checkBranch(c, body.branchId, fail);
  if (!validLines(body.lines) || Object.keys(body.lines).length === 0) {
    return fail(422, 'VALIDATION_FAILED', 'Count the notes you start with.', { lines: ['Enter at least one note count'] });
  }
  const mine = forBranch(s, body.branchId);
  if (mine.some((d) => d.status === 'open')) return fail(409, 'DAY_ALREADY_OPEN', 'This branch already has an open day.');
  if (mine.some((d) => d.businessDate === body.businessDate)) return fail(409, 'DAY_ALREADY_CLOSED', 'That day was already opened and closed.');

  const prev = mine.find((d) => d.status === 'closed');
  const flags: Day['flags'] = [];
  if (prev?.closing && JSON.stringify(sorted(prev.closing.counted)) !== JSON.stringify(sorted(body.lines))) flags.push('OPENING_DIFFERS');
  if (Date.now() - new Date(body.capturedAt).getTime() > OFFLINE_MS) flags.push('OFFLINE_ENTRY');

  const day: Day = {
    id: body.id,
    branchId: body.branchId,
    businessDate: body.businessDate,
    status: 'open',
    opening: { lines: body.lines, source: body.source === 'carried' ? 'carried' : 'counted' },
    openedAt: body.capturedAt,
    openedBy: who(c),
    closing: null,
    flags,
  };
  save({ ...s, days: [day, ...s.days] });
  return { status: 201, data: day };
}

const sorted = (l: Lines) => Object.fromEntries(Object.entries(l).sort(([a], [b]) => Number(a) - Number(b)));

export async function closeDay(dayId: string, body: any, c: Caller, fail: Fail): Promise<{ status: 200; data: Day }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = load();
  const day = s.days.find((d) => d.id === dayId);
  if (!day) return fail(404, 'NOT_FOUND', 'Day not found.');
  await checkBranch(c, day.branchId, fail);
  if (day.status === 'closed') {
    if (s.closeIds[day.id] === body.id) return { status: 200, data: day };
    return fail(409, 'DAY_ALREADY_CLOSED', 'This day is already closed.');
  }
  if (!validLines(body.counted)) return fail(422, 'VALIDATION_FAILED', 'Check the counted notes.', { counted: ['Invalid note counts'] });

  const expected = balanceOf(s, day);
  const variance = subtractLines(body.counted, expected);
  const amount = lineTotal(variance);
  const closed: Day = {
    ...day,
    status: 'closed',
    closing: {
      expected,
      counted: body.counted,
      variance,
      varianceAmount: String(amount),
      reason: body.reason ? String(body.reason) : null,
      closedAt: body.capturedAt,
      closedBy: who(c),
      signoff: { status: amount === 0 ? 'not_required' : 'pending' },
    },
  };
  save({ ...s, days: s.days.map((d) => (d.id === day.id ? closed : d)), closeIds: { ...s.closeIds, [day.id]: body.id } });
  return { status: 200, data: closed };
}

export async function addMovement(dayId: string, body: any, c: Caller, fail: Fail): Promise<{ status: 200 | 201; data: Movement }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = load();
  const same = s.movements.find((m) => m.id === body.id);
  if (same) return { status: 200, data: same };
  const day = s.days.find((d) => d.id === dayId);
  if (!day) return fail(404, 'NOT_FOUND', 'Day not found.');
  await checkBranch(c, day.branchId, fail);
  if (day.status !== 'open') return fail(409, 'DAY_CLOSED', 'This day is closed.');
  const fieldErrors: Record<string, string[]> = {};
  if (!['topup', 'withdrawal'].includes(body.kind)) fieldErrors.kind = ['Choose top-up or withdrawal'];
  if (!validLines(body.lines) || Object.keys(body.lines).length === 0) fieldErrors.lines = ['Enter at least one note count'];
  if (!String(body.note ?? '').trim()) fieldErrors.note = ['Say what this is for'];
  if (Object.keys(fieldErrors).length) return fail(422, 'VALIDATION_FAILED', 'Check the highlighted fields.', fieldErrors);
  const m: Movement = {
    id: body.id,
    dayId,
    kind: body.kind,
    lines: body.lines,
    note: String(body.note).trim(),
    capturedAt: body.capturedAt,
    createdBy: who(c),
  };
  save({ ...s, movements: [...s.movements, m] });
  return { status: 201, data: m };
}

export async function signOff(dayId: string, c: Caller, fail: Fail): Promise<{ status: 200; data: Day }> {
  const s = load();
  const day = s.days.find((d) => d.id === dayId);
  if (!day) return fail(404, 'NOT_FOUND', 'Day not found.');
  await checkBranch(c, day.branchId, fail);
  if (day.closing?.signoff.status !== 'pending') return fail(409, 'NOTHING_TO_SIGN', 'This day has no difference waiting for sign-off.');
  const signed: Day = {
    ...day,
    closing: { ...day.closing, signoff: { status: 'signed', by: who(c), at: new Date().toISOString() } },
  };
  save({ ...s, days: s.days.map((d) => (d.id === day.id ? signed : d)) });
  return { status: 200, data: signed };
}

/** Called by the transactions mock when a payout is saved. Returns true when it was applied to an open day. */
export function recordPayout(branchId: string, txId: string, lines: Lines): boolean {
  const s = load();
  const day = forBranch(s, branchId).find((d) => d.status === 'open');
  if (!day) return false;
  save({ ...s, payouts: { ...s.payouts, [day.id]: { ...(s.payouts[day.id] ?? {}), [txId]: lines } } });
  return true;
}
