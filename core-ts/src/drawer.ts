import { addLines, shortfall, subtractLines, type Lines } from "./lines";
import { DENOMINATIONS, type NoteLimits } from "./solver";

/**
 * The cash drawer as a pure calculation: the last answer from the server plus every command not yet confirmed.
 * One copy of the rules, used by the screens (what this device shows), the branch hub (which note counts to promise whom)
 * and the tests that replay logs. Nothing here knows about React, HTTP or storage.
 *
 * Why it matters: a teller who pays three customers offline must not be offered the same 100s three times.
 * Each waiting payout comes off the balance the moment it is saved.
 */

/** A command that moves notes. Structural, so the web's own validated types fit without conversion. */
export type DrawerCommand =
  | {
      id: string;
      type: "drawer.movement";
      payload: {
        dayId: string;
        kind: "topup" | "withdrawal" | "allowance";
        lines: Lines;
      };
    }
  | {
      id: string;
      type: "drawer.exchange";
      payload: { dayId: string; gave: Lines; took: Lines };
    }
  | {
      id: string;
      type: "transaction.create";
      payload: { branchId: string; payout: { lines: Lines } };
    }
  /** Cash handed over for a purchase saved in two-step mode. The server counts it under the purchase's id. */
  | {
      id: string;
      type: "transaction.pay";
      payload: { transactionId: string; branchId: string; lines: Lines };
    };

/** The part of the server's day state the calculation needs. */
export interface DayStateLike {
  day: {
    id: string;
    status: string;
    businessDate: string;
    opening: { lines: Lines };
    closing?: { cash: { counted: Lines } } | null;
  } | null;
  balance?: Lines | null;
  appliedIds?: string[];
  carryOver?: Lines | null;
}

export interface DrawerView {
  /** unknown: nothing loaded yet (never online). none: no day yet. open / closed as it says. */
  status: "unknown" | "none" | "open" | "closed";
  dayId: string | null;
  businessDate: string | null;
  /** Notes in the drawer right now. null when status is not open. */
  balance: Lines | null;
  openingLines: Lines | null;
  /** Counted at close, once closed. */
  closingLines: Lines | null;
  carryOver: Lines | null;
  /** Number of commands not confirmed by the server yet. */
  pendingCount: number;
  /** True if any denomination is below zero (more paid out than recorded). */
  negative: boolean;
}

/** The id under which the server will report this command as applied. A payout is counted under its purchase's id. */
export const appliedKey = (c: DrawerCommand) =>
  c.type === "transaction.pay" ? c.payload.transactionId : c.id;

/**
 * What a command does to the drawer: notes in and notes out, or null when it does not touch this drawer right now
 * (another day, another branch, two-step purchase that only saves, day not open).
 */
export function drawerEffect(
  c: DrawerCommand,
  ctx: {
    status: DrawerView["status"];
    dayId: string | null;
    branchId: string;
    twoStep?: boolean;
  },
): { in: Lines; out: Lines } | null {
  if (ctx.status !== "open") return null;
  switch (c.type) {
    case "drawer.movement":
      if (c.payload.dayId !== ctx.dayId) return null;
      return c.payload.kind === "topup"
        ? { in: c.payload.lines, out: {} }
        : { in: {}, out: c.payload.lines };
    case "drawer.exchange":
      if (c.payload.dayId !== ctx.dayId) return null;
      return { in: c.payload.gave, out: c.payload.took };
    case "transaction.create":
      // Two-step: saving a purchase takes no cash out of the drawer; the payout does.
      if (ctx.twoStep || c.payload.branchId !== ctx.branchId) return null;
      return { in: {}, out: c.payload.payout.lines };
    case "transaction.pay":
      if (c.payload.branchId !== ctx.branchId) return null;
      return { in: {}, out: c.payload.lines };
  }
}

export function projectDrawer(
  state: DayStateLike | null,
  pending: DrawerCommand[],
  branchId: string,
  twoStep = false,
): DrawerView {
  const applied = new Set(state?.appliedIds ?? []);
  const status: DrawerView["status"] = state
    ? state.day
      ? (state.day.status as DrawerView["status"])
      : "none"
    : "unknown";
  const dayId = state?.day?.id ?? null;
  let balance: Lines | null =
    state?.day?.status === "open" ? (state.balance ?? {}) : null;
  let pendingCount = 0;

  for (const p of pending) {
    if (applied.has(appliedKey(p))) continue;
    pendingCount++;
    if (!balance) continue;
    const e = drawerEffect(p, { status, dayId, branchId, twoStep });
    if (e) balance = subtractLines(addLines(balance, e.in), e.out);
  }

  return {
    status,
    dayId,
    businessDate: state?.day?.businessDate ?? null,
    balance,
    openingLines: state?.day?.opening.lines ?? null,
    closingLines: state?.day?.closing?.cash.counted ?? null,
    carryOver: state?.carryOver ?? null,
    pendingCount,
    negative: !!balance && Object.values(balance).some((n) => n < 0),
  };
}

/** Solver limits from the drawer: a note is available only while the drawer holds some, and the limit is exactly how many it holds. */
export function limitsFromBalance(balance: Lines): NoteLimits {
  const limits: NoteLimits = {};
  for (const d of DENOMINATIONS) {
    const n = balance[`${d}`] ?? 0;
    if (n > 0) limits[`${d}`] = n;
  }
  return limits;
}

/** Expected vs counted at close. Variance entries are counted − expected (positive = more cash than expected). */
export function compareCount(
  expected: Lines,
  counted: Lines,
): { variance: Lines; amount: number } {
  const variance = subtractLines(counted, expected);
  const amount = Object.entries(variance).reduce(
    (s, [d, n]) => s + Number(d) * n,
    0,
  );
  return { variance, amount };
}

// ---- For the branch hub: one shared order, and a check before a command is promised notes -------------------------------------

/** A command in the branch's shared log. `seq` is given by the hub; `deviceId` and `capturedAt` order commands when there is no hub. */
export interface LogEntry {
  command: DrawerCommand;
  deviceId: string;
  /** ISO time on the machine that made it. */
  capturedAt: string;
  /** The hub's number for it, when the hub saw it. */
  seq?: number;
  /** Order on the machine that made it, to break ties from the same instant. */
  localSeq?: number;
}

/**
 * One order everyone agrees on. Hub numbers win; commands the hub has not numbered come after, by time, then machine, then order on the machine.
 * Two machines with wrong clocks can still disagree about unnumbered commands, which is why the hub numbers them.
 */
export function compareLog(a: LogEntry, b: LogEntry): number {
  if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
  if (a.seq !== undefined) return -1;
  if (b.seq !== undefined) return 1;
  return (
    a.capturedAt.localeCompare(b.capturedAt) ||
    a.deviceId.localeCompare(b.deviceId) ||
    (a.localSeq ?? 0) - (b.localSeq ?? 0) ||
    a.command.id.localeCompare(b.command.id)
  );
}

export const sortLog = (log: LogEntry[]) => [...log].sort(compareLog);

export interface Admission {
  ok: boolean;
  /** Notes the drawer could not cover, per denomination. Empty when ok. */
  short: Lines;
  /** The drawer after the command (also when not ok: the books record what happened). */
  balance: Lines | null;
}

/**
 * Can the drawer cover this command right now? Used by the hub before it promises notes to a teller, so two tellers racing for the same
 * notes are told apart: the second hears which notes were just used. The balance returned is what the drawer holds afterwards.
 */
export function admit(
  view: Pick<DrawerView, "status" | "dayId" | "balance">,
  c: DrawerCommand,
  branchId: string,
  twoStep = false,
): Admission {
  const e = drawerEffect(c, {
    status: view.status,
    dayId: view.dayId,
    branchId,
    twoStep,
  });
  if (!e || !view.balance)
    return { ok: true, short: {}, balance: view.balance };
  const available = addLines(view.balance, e.in);
  const short = shortfall(available, e.out);
  return {
    ok: Object.keys(short).length === 0,
    short,
    balance: subtractLines(available, e.out),
  };
}

export interface ReplayStep {
  id: string;
  /** False when the drawer could not cover it at that point. It is still counted ("reality wins"); a person looks at it. */
  covered: boolean;
  short: Lines;
  /** Drawer right after this step. */
  balance: Lines | null;
}

/**
 * Replays a shared log over the last server answer, in the agreed order, and reports where the drawer ran short.
 * Every machine that does this with the same inputs gets the same answer.
 */
export function replayLog(
  state: DayStateLike | null,
  log: LogEntry[],
  branchId: string,
  twoStep = false,
): { view: DrawerView; steps: ReplayStep[] } {
  const ordered = sortLog(log);
  const applied = new Set(state?.appliedIds ?? []);
  const base = projectDrawer(state, [], branchId, twoStep);
  let balance = base.balance;
  let count = 0;
  const steps: ReplayStep[] = [];
  const seen = new Set<string>();
  for (const entry of ordered) {
    const key = appliedKey(entry.command);
    if (applied.has(key) || seen.has(entry.command.id)) continue; // confirmed already, or the same command copied to the log twice
    seen.add(entry.command.id);
    count++;
    const a = admit(
      { status: base.status, dayId: base.dayId, balance },
      entry.command,
      branchId,
      twoStep,
    );
    balance = a.balance;
    steps.push({
      id: entry.command.id,
      covered: a.ok,
      short: a.short,
      balance,
    });
  }
  return {
    view: {
      ...base,
      balance,
      pendingCount: count,
      negative: !!balance && Object.values(balance).some((n) => n < 0),
    },
    steps,
  };
}
