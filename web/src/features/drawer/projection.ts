import { addLines, DENOMINATIONS, subtractLines, type Lines, type NoteLimits } from '@gold/core';
import type { CreateTransaction } from '@/features/transactions/schemas';
import type { CloseDay, DayState, MovementCommand, OpenDay } from './schemas';

/**
 * What the drawer looks like on THIS device right now: the last answer from the server plus everything
 * still waiting in the outbox. Pure, so it is easy to test and the same rules can be checked against the API.
 *
 * Why not just wait for the server? A teller who pays three customers offline must not be offered
 * the same 100s three times. Each waiting payout comes off the balance the moment it is saved.
 */
export type Pending =
  | { id: string; type: 'day.open'; payload: OpenDay }
  | { id: string; type: 'day.close'; payload: CloseDay }
  | { id: string; type: 'drawer.movement'; payload: MovementCommand }
  | { id: string; type: 'transaction.create'; payload: Pick<CreateTransaction, 'branchId'> & { payout: { lines: Lines } } };

export interface DrawerView {
  /** unknown: nothing loaded yet (never online). none: no day yet. open / closed as it says. */
  status: 'unknown' | 'none' | 'open' | 'closed';
  dayId: string | null;
  businessDate: string | null;
  /** Notes in the drawer right now. null when status is not open. */
  balance: Lines | null;
  openingLines: Lines | null;
  /** Counted at close, once closed. */
  closingLines: Lines | null;
  carryOver: Lines | null;
  /** Number of commands this device has not sent yet. */
  pendingCount: number;
  /** True if any denomination is below zero (more paid out than recorded). */
  negative: boolean;
}

export function projectDrawer(state: DayState | null, pending: Pending[], branchId: string): DrawerView {
  const applied = new Set(state?.appliedIds ?? []);
  let status: DrawerView['status'] = state ? (state.day ? state.day.status : 'none') : 'unknown';
  let dayId = state?.day?.id ?? null;
  let businessDate = state?.day?.businessDate ?? null;
  let balance: Lines | null = state?.day?.status === 'open' ? (state.balance ?? {}) : null;
  let openingLines: Lines | null = state?.day?.opening.lines ?? null;
  let closingLines: Lines | null = state?.day?.closing?.counted ?? null;
  let carryOver = state?.carryOver ?? null;
  let pendingCount = 0;

  for (const p of pending) {
    if (applied.has(p.id)) continue;
    pendingCount++;
    switch (p.type) {
      case 'day.open': {
        if (p.payload.branchId !== branchId) break;
        if (status === 'open' && dayId !== p.payload.id) break; // server will refuse; do not show two days
        status = 'open';
        dayId = p.payload.id;
        businessDate = p.payload.businessDate;
        balance = { ...p.payload.lines };
        openingLines = { ...p.payload.lines };
        closingLines = null;
        break;
      }
      case 'drawer.movement': {
        if (status !== 'open' || p.payload.dayId !== dayId || !balance) break;
        balance = p.payload.kind === 'topup' ? addLines(balance, p.payload.lines) : subtractLines(balance, p.payload.lines);
        break;
      }
      case 'transaction.create': {
        if (status !== 'open' || p.payload.branchId !== branchId || !balance) break;
        balance = subtractLines(balance, p.payload.payout.lines);
        break;
      }
      case 'day.close': {
        if (status !== 'open' || p.payload.dayId !== dayId) break;
        status = 'closed';
        closingLines = { ...p.payload.counted };
        carryOver = { ...p.payload.counted };
        balance = null;
        break;
      }
    }
  }

  return {
    status,
    dayId,
    businessDate,
    balance,
    openingLines,
    closingLines,
    carryOver,
    pendingCount,
    negative: !!balance && Object.values(balance).some((n) => n < 0),
  };
}

/**
 * Solver limits from the drawer: a note is available only while the drawer holds some,
 * and the limit is exactly how many it holds.
 */
export function limitsFromBalance(balance: Lines): NoteLimits {
  const limits: NoteLimits = {};
  for (const d of DENOMINATIONS) {
    const n = balance[`${d}`] ?? 0;
    if (n > 0) limits[`${d}`] = n;
  }
  return limits;
}

/** Expected vs counted at close. Variance entries are counted − expected (positive = more cash than expected). */
export function compareCount(expected: Lines, counted: Lines): { variance: Lines; amount: number } {
  const variance = subtractLines(counted, expected);
  const amount = Object.entries(variance).reduce((s, [d, n]) => s + Number(d) * n, 0);
  return { variance, amount };
}

/** Business date in the device's local time, "YYYY-MM-DD". */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
