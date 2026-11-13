import {
  addLines,
  lineTotal,
  shortfall,
  subtractLines,
  type Lines,
} from "./lines";
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
    }
  /** A day opened on a device with no connection. Its id is made on the device, and the server keeps it. */
  | {
      id: string;
      type: "day.open";
      payload: {
        id: string;
        branchId: string;
        businessDate: string;
        lines: Lines;
        afterClose?: boolean;
      };
    }
  /** A day closed on a device with no connection: the notes counted are what the next opening starts from. */
  | {
      id: string;
      type: "day.close";
      payload: { dayId: string; branchId: string; declared: { cash: Lines } };
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
  /** True when this branch has the note-by-note rule switched off: only the total in the drawer is enforced. */
  looseDenominations?: boolean;
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
  /** The note-by-note rule is off for this branch: tellers may hand out notes the books lack, but never more money than the drawer holds. */
  loose: boolean;
  /** The day's state (open or closed) comes from an opening or closing made on a device that the server has not received yet. */
  local: boolean;
  /** Other ids that mean the day in `dayId`: the same date opened a second time on another device. */
  aliases: Record<string, string>;
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
    aliases?: Record<string, string>;
  },
): { in: Lines; out: Lines } | null {
  if (ctx.status !== "open") return null;
  switch (c.type) {
    case "drawer.movement":
      if ((ctx.aliases?.[c.payload.dayId] ?? c.payload.dayId) !== ctx.dayId)
        return null;
      return c.payload.kind === "topup"
        ? { in: c.payload.lines, out: {} }
        : { in: {}, out: c.payload.lines };
    case "drawer.exchange":
      if ((ctx.aliases?.[c.payload.dayId] ?? c.payload.dayId) !== ctx.dayId)
        return null;
      return { in: c.payload.gave, out: c.payload.took };
    case "transaction.create":
      // Two-step: saving a purchase takes no cash out of the drawer; the payout does.
      if (ctx.twoStep || c.payload.branchId !== ctx.branchId) return null;
      return { in: {}, out: c.payload.payout.lines };
    case "transaction.pay":
      if (c.payload.branchId !== ctx.branchId) return null;
      return { in: {}, out: c.payload.lines };
    case "day.open":
    case "day.close":
      return null; // they change the day, not the notes (see projectDrawer)
  }
}

/** Strict: any note count below zero. Loose: only when the money in the drawer is below zero. */
function isNegative(balance: Lines | null, loose: boolean): boolean {
  if (!balance) return false;
  return loose
    ? lineTotal(balance) < 0
    : Object.values(balance).some((n) => n < 0);
}

const positive = (l: Lines): Lines =>
  Object.fromEntries(Object.entries(l).filter(([, n]) => n > 0));

/** The drawer while commands are being taken one by one (the screens and the hub both go through here, so they cannot disagree). */
interface Run {
  status: DrawerView["status"];
  dayId: string | null;
  businessDate: string | null;
  balance: Lines | null;
  openingLines: Lines | null;
  closingLines: Lines | null;
  carryOver: Lines | null;
  local: boolean;
  aliases: Record<string, string>;
}

function startRun(state: DayStateLike | null): Run {
  return {
    status: state
      ? state.day
        ? (state.day.status as DrawerView["status"])
        : "none"
      : "unknown",
    dayId: state?.day?.id ?? null,
    businessDate: state?.day?.businessDate ?? null,
    balance:
      state?.day?.status === "open" ? { ...(state.balance ?? {}) } : null,
    openingLines: state?.day?.opening.lines ?? null,
    closingLines: state?.day?.closing?.cash.counted ?? null,
    carryOver: state?.carryOver ?? null,
    local: false,
    aliases: {},
  };
}

/** Does the server's answer already include this opening or closing? (Other commands are checked against `appliedIds`.) */
function dayCommandApplied(
  state: DayStateLike | null,
  applied: Set<string>,
  c: DrawerCommand,
): boolean {
  if (c.type === "day.open")
    return applied.has(c.id) || state?.day?.id === c.payload.id;
  if (c.type === "day.close")
    return (
      !!state?.day &&
      state.day.id === c.payload.dayId &&
      state.day.status === "closed"
    );
  return false;
}

/**
 * Takes one command into the run. Openings and closings made with no connection are followed, so a branch can close Monday,
 * open Tuesday and keep working while the server still thinks it is Monday:
 *  - an opening makes the drawer open, with its own id and the notes that were counted;
 *  - a closing closes it, and the notes counted are what the next opening starts from;
 *  - an opening for the date that is already open is the same day under a second id (the server merges them the same way).
 */
function stepRun(
  run: Run,
  c: DrawerCommand,
  branchId: string,
  twoStep: boolean,
): void {
  if (c.type === "day.open") {
    if (c.payload.branchId !== branchId) return;
    if (
      run.status === "open" &&
      run.dayId &&
      run.businessDate === c.payload.businessDate &&
      !c.payload.afterClose
    ) {
      run.aliases[c.payload.id] = run.dayId;
      return;
    }
    run.status = "open";
    run.dayId = c.payload.id;
    run.businessDate = c.payload.businessDate;
    run.openingLines = { ...(c.payload.lines ?? {}) };
    run.balance = { ...(c.payload.lines ?? {}) };
    run.closingLines = null;
    run.local = true;
    return;
  }
  if (c.type === "day.close") {
    if (c.payload.branchId !== branchId) return;
    const target = run.aliases[c.payload.dayId] ?? c.payload.dayId;
    if (run.status !== "open" || target !== run.dayId) return; // for a day that is no longer the open one
    run.status = "closed";
    // (written defensively: a badly formed entry in a shared log must not stop everyone's drawer from being worked out)
    run.closingLines = { ...(c.payload.declared?.cash ?? {}) };
    run.carryOver = positive(c.payload.declared?.cash ?? {});
    run.balance = null;
    run.local = true;
    return;
  }
  if (!run.balance) return;
  const e = drawerEffect(c, {
    status: run.status,
    dayId: run.dayId,
    branchId,
    twoStep,
    aliases: run.aliases,
  });
  if (e) run.balance = subtractLines(addLines(run.balance, e.in), e.out);
}

const viewOf = (
  run: Run,
  pendingCount: number,
  loose: boolean,
): DrawerView => ({
  status: run.status,
  dayId: run.dayId,
  businessDate: run.businessDate,
  balance: run.balance,
  openingLines: run.openingLines,
  closingLines: run.closingLines,
  carryOver: run.carryOver,
  pendingCount,
  negative: isNegative(run.balance, loose),
  loose,
  local: run.local,
  aliases: { ...run.aliases },
});

/** The drawer as a device sees it: the server's last answer plus every command not yet confirmed, in the order given (the order they were made). */
export function projectDrawer(
  state: DayStateLike | null,
  pending: DrawerCommand[],
  branchId: string,
  twoStep = false,
): DrawerView {
  const applied = new Set(state?.appliedIds ?? []);
  const run = startRun(state);
  let pendingCount = 0;
  for (const p of pending) {
    if (p.type === "day.open" || p.type === "day.close") {
      if (
        p.payload.branchId !== branchId ||
        dayCommandApplied(state, applied, p)
      )
        continue;
    } else if (applied.has(appliedKey(p))) continue;
    pendingCount++;
    stepRun(run, p, branchId, twoStep);
  }
  return viewOf(run, pendingCount, !!state?.looseDenominations);
}

/** Solver limits from the drawer: a note is available only while the drawer holds some, and the limit is exactly how many it holds. */
export function limitsFromBalance(balance: Lines, loose = false): NoteLimits {
  const limits: NoteLimits = {};
  // Loose: every note may be offered (null = no limit); the screens still stop an amount above the drawer's total.
  if (loose) {
    for (const d of DENOMINATIONS) limits[`${d}`] = null;
    return limits;
  }
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
  /** Why not, when it is not about notes: the day is already open, or it is no longer open (someone else closed it). */
  reason?: "day-open" | "day-not-open";
}

/**
 * Can the drawer cover this command right now? Used by the hub before it promises notes to a teller, so two tellers racing for the same
 * notes are told apart: the second hears which notes were just used. The balance returned is what the drawer holds afterwards.
 */
export function admit(
  view: Pick<DrawerView, "status" | "dayId" | "balance"> & {
    loose?: boolean;
    aliases?: Record<string, string>;
  },
  c: DrawerCommand,
  branchId: string,
  twoStep = false,
): Admission {
  // One open day per branch: a second opening, or a closing of a day that is no longer open, is told apart the same way.
  if (c.type === "day.open") {
    if (c.payload.branchId !== branchId || view.status !== "open")
      return { ok: true, short: {}, balance: view.balance };
    return { ok: false, short: {}, balance: view.balance, reason: "day-open" };
  }
  if (c.type === "day.close") {
    if (c.payload.branchId !== branchId)
      return { ok: true, short: {}, balance: view.balance };
    const target = view.aliases?.[c.payload.dayId] ?? c.payload.dayId;
    if (view.status === "open" && target === view.dayId)
      return { ok: true, short: {}, balance: null };
    return {
      ok: false,
      short: {},
      balance: view.balance,
      reason: "day-not-open",
    };
  }
  const e = drawerEffect(c, {
    status: view.status,
    dayId: view.dayId,
    branchId,
    twoStep,
    aliases: view.aliases,
  });
  if (!e || !view.balance)
    return { ok: true, short: {}, balance: view.balance };
  const available = addLines(view.balance, e.in);
  // Loose branch: only the money must be there. If it is not, every note asked for is reported as the shortfall.
  const short = view.loose
    ? lineTotal(e.out) > lineTotal(available)
      ? { ...e.out }
      : {}
    : shortfall(available, e.out);
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
  const loose = !!state?.looseDenominations;
  const run = startRun(state);
  let count = 0;
  const steps: ReplayStep[] = [];
  const seen = new Set<string>();
  for (const entry of ordered) {
    const c = entry.command;
    if (seen.has(c.id)) continue; // the same command copied to the log twice
    if (c.type === "day.open" || c.type === "day.close") {
      if (dayCommandApplied(state, applied, c)) continue;
    } else if (applied.has(appliedKey(c))) continue; // confirmed already
    seen.add(c.id);
    count++;
    const a = admit(
      {
        status: run.status,
        dayId: run.dayId,
        balance: run.balance,
        loose,
        aliases: run.aliases,
      },
      c,
      branchId,
      twoStep,
    );
    stepRun(run, c, branchId, twoStep); // recorded whether or not it was covered: reality wins
    steps.push({
      id: c.id,
      covered: a.ok,
      short: a.short,
      balance: run.balance,
    });
  }
  return { view: viewOf(run, count, loose), steps };
}
