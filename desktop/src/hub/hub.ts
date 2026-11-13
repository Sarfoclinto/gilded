import {
  admit,
  appliedKey,
  replayLog,
  type DayStateLike,
  type DrawerCommand,
  type DrawerView,
  type LogEntry,
} from "@gold/core";
import type { HubStore, Snapshot, StoredEntry } from "./store";

export interface Submission {
  command: DrawerCommand;
  deviceId: string;
  userId: string;
  capturedAt: string;
  /** Order on the machine that made it. */
  localSeq?: number;
  signed?: StoredEntry["signed"];
  /** Record it only if the drawer can cover it right now (an atomic "reserve the notes"). Otherwise nothing is stored and `taken` is set. */
  strict?: boolean;
}

export interface SubmitResult {
  seq: number;
  /** False when the drawer could not cover it at its place in the order. It is still recorded, because the cash has gone. */
  covered: boolean;
  short: Record<string, number>;
  /** The same command was already in the log; this is its original answer. */
  duplicate: boolean;
  /** Strict only: the notes were not available, so nothing was recorded. `short` says which. */
  taken?: boolean;
  /** Strict only, for an opening or closing that was not recorded: the day is already open, or it is no longer open. */
  reason?: "day-open" | "day-not-open";
}

export interface CheckResult {
  ok: boolean;
  short: Record<string, number>;
  /** Drawer after this command, if it went ahead now. */
  balance: Record<string, number> | null;
}

/**
 * The branch hub's brain: one shared log for the branch, in one order. It does not replace the server or any machine's own queue:
 * each machine keeps its commands until the server confirms them, and the hub only gives them an order and watches the drawer.
 *
 *  - `check`  is asked before a teller is promised notes. It stores nothing.
 *  - `submit` records a command (always: the cash has already moved, "reality wins") and says whether the drawer covered it.
 *  - `since`  lets a machine catch up on what the others did.
 *  - `view`   is the drawer as the whole branch sees it: the server's last answer plus the log after it.
 */
export class Hub {
  constructor(
    private store: HubStore,
    private opts: { branchId: string; twoStep?: boolean; now?: () => Date } = {
      branchId: "",
    },
  ) {}

  private now = () => (this.opts.now ?? (() => new Date()))();

  private asLog(entries: StoredEntry[]): LogEntry[] {
    return entries.map((e) => ({
      command: e.command,
      deviceId: e.deviceId,
      capturedAt: e.capturedAt,
      seq: e.seq,
      localSeq: e.localSeq,
    }));
  }

  /**
   * The entries the server's stored answer does not include yet. An entry stops counting once the server is known to have it
   * (`confirmedAsOf`) and the stored answer is at least that new, so an entry from an earlier day is never counted a second time.
   */
  active(): StoredEntry[] {
    const asOf = this.store.getSnapshot()?.asOf;
    return this.store
      .all()
      .filter((e) => !(e.confirmedAsOf && asOf && e.confirmedAsOf <= asOf));
  }

  view(): DrawerView {
    return replayLog(
      this.store.getSnapshot()?.state ?? null,
      this.asLog(this.active()),
      this.opts.branchId,
      this.opts.twoStep,
    ).view;
  }

  /** The server's answer the hub counts from, and the entries after it: one consistent pair for a computer to show its drawer from. */
  state(): { snapshot: Snapshot | null; entries: StoredEntry[] } {
    return { snapshot: this.store.getSnapshot(), entries: this.active() };
  }

  /** A computer says the server has these commands, as of that server answer (which it hands over with `setSnapshot`). */
  confirm(commandIds: string[], asOf: string): { confirmed: number } {
    const ids = commandIds.filter((x) => typeof x === "string").slice(0, 1000);
    this.store.confirm(ids, asOf);
    return { confirmed: ids.length };
  }

  check(command: DrawerCommand): CheckResult {
    const r = admit(
      this.view(),
      command,
      this.opts.branchId,
      this.opts.twoStep,
    );
    return { ok: r.ok, short: r.short, balance: r.balance };
  }

  submit(s: Submission): SubmitResult {
    const existing = this.store.get(s.command.id);
    if (existing)
      return {
        seq: existing.seq,
        covered: existing.covered,
        short: existing.short,
        duplicate: true,
      };
    // Judged against the drawer as it stands now, which already includes everything numbered before this one.
    const a = admit(
      this.view(),
      s.command,
      this.opts.branchId,
      this.opts.twoStep,
    );
    if (s.strict && !a.ok)
      return {
        seq: 0,
        covered: false,
        short: a.short,
        duplicate: false,
        taken: true,
        reason: a.reason,
      };
    const { entry, duplicate } = this.store.append({
      command: s.command,
      deviceId: s.deviceId,
      userId: s.userId,
      capturedAt: s.capturedAt,
      localSeq: s.localSeq ?? 0,
      receivedAt: this.now().toISOString(),
      covered: a.ok,
      short: a.short,
      signed: s.signed ?? null,
    });
    return {
      seq: entry.seq,
      covered: entry.covered,
      short: entry.short,
      duplicate,
    };
  }

  since(after: number, limit?: number) {
    return this.store.since(after, limit);
  }

  /** The server's latest answer for this branch (any machine with a connection can bring it). An older answer never replaces a newer one. */
  setSnapshot(state: DayStateLike, asOf: string): boolean {
    const cur = this.store.getSnapshot();
    if (cur && cur.asOf >= asOf) return false;
    this.store.setSnapshot({ state, asOf } satisfies Snapshot);
    // Everything this answer lists as applied is known to the server from now on, also after the day rolls over and the list starts again.
    const applied = new Set(state.appliedIds ?? []);
    const ids = this.store
      .all()
      .filter(
        (e) =>
          !e.confirmedAsOf &&
          (applied.has(appliedKey(e.command)) ||
            (e.command.type === "day.open" &&
              state.day?.id === e.command.payload.id) ||
            (e.command.type === "day.close" &&
              state.day?.id === e.command.payload.dayId &&
              state.day.status === "closed")),
      )
      .map((e) => e.command.id);
    if (ids.length) this.store.confirm(ids, asOf);
    return true;
  }

  /** Entries the server has not confirmed yet, in order: what still has to be sent on. */
  unconfirmed(): StoredEntry[] {
    const applied = new Set(this.store.getSnapshot()?.state.appliedIds ?? []);
    return this.active().filter((e) => !applied.has(appliedKey(e.command)));
  }
}
