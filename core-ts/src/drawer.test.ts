import { describe, expect, it } from "vitest";
import {
  admit,
  appliedKey,
  compareLog,
  projectDrawer,
  replayLog,
  sortLog,
  type DayStateLike,
  type DrawerCommand,
  type Lines,
  type LogEntry,
} from "../src";

const state = (
  balance: Record<string, number>,
  appliedIds: string[] = [],
  status = "open",
): DayStateLike => ({
  day: {
    id: "d1",
    status,
    businessDate: "2026-11-05",
    opening: { lines: balance },
    closing: null,
  },
  balance: status === "open" ? balance : null,
  appliedIds,
  carryOver: null,
});
const pay = (id: string, lines: Record<string, number>): DrawerCommand => ({
  id,
  type: "transaction.create",
  payload: { branchId: "b", payout: { lines } },
});
const topup = (id: string, lines: Record<string, number>): DrawerCommand => ({
  id,
  type: "drawer.movement",
  payload: { dayId: "d1", kind: "topup", lines },
});
const entry = (
  command: DrawerCommand,
  deviceId: string,
  capturedAt: string,
  extra: Partial<LogEntry> = {},
): LogEntry => ({ command, deviceId, capturedAt, ...extra });

describe("projectDrawer (shared rules)", () => {
  it("takes waiting payouts off so a note is never promised twice", () => {
    const v = projectDrawer(
      state({ "100": 90, "50": 10 }),
      [pay("a", { "100": 40 }), pay("b", { "100": 40, "50": 3 })],
      "b",
    );
    expect(v.balance).toEqual({ "100": 10, "50": 7 });
    expect(v.pendingCount).toBe(2);
  });
  it("does not count what the server already applied; a payout counts under its purchase id", () => {
    const p: DrawerCommand = {
      id: "pay-1",
      type: "transaction.pay",
      payload: { transactionId: "tx1", branchId: "b", lines: { "100": 5 } },
    };
    expect(appliedKey(p)).toBe("tx1");
    expect(
      projectDrawer(state({ "100": 10 }, ["tx1"]), [p], "b").pendingCount,
    ).toBe(0);
  });
  it("unknown, none and closed give no balance", () => {
    expect(projectDrawer(null, [], "b").status).toBe("unknown");
    expect(projectDrawer({ day: null }, [], "b").status).toBe("none");
    expect(
      projectDrawer(state({}, [], "closed"), [pay("a", { "100": 1 })], "b")
        .balance,
    ).toBeNull();
  });
});

describe("admit", () => {
  const view = projectDrawer(state({ "100": 3, "50": 1 }), [], "b");
  it("accepts a payout the drawer can cover and returns what is left", () => {
    expect(admit(view, pay("a", { "100": 2 }), "b")).toEqual({
      ok: true,
      short: {},
      balance: { "100": 1, "50": 1 },
    });
  });
  it("says which notes are missing when it cannot", () => {
    const r = admit(view, pay("a", { "100": 5, "50": 1, "20": 2 }), "b");
    expect(r.ok).toBe(false);
    expect(r.short).toEqual({ "100": 2, "20": 2 });
  });
  it("counts notes coming in by the same command (an exchange gives some and takes some)", () => {
    const ex: DrawerCommand = {
      id: "e",
      type: "drawer.exchange",
      payload: { dayId: "d1", gave: { "20": 5 }, took: { "20": 4 } },
    };
    expect(admit(view, ex, "b").ok).toBe(true);
  });
  it("does not block what does not touch this drawer (other branch, two-step purchase that only saves)", () => {
    expect(
      admit(
        view,
        {
          ...pay("a", { "100": 99 }),
          payload: { branchId: "other", payout: { lines: { "100": 99 } } },
        } as DrawerCommand,
        "b",
      ).ok,
    ).toBe(true);
    expect(admit(view, pay("a", { "100": 99 }), "b", true).ok).toBe(true);
  });
});

describe("log order", () => {
  it("hub numbers decide; unnumbered come after, by time then machine then local order", () => {
    const a = entry(topup("a", {}), "pc2", "2026-11-05T09:00:00Z", { seq: 2 });
    const b = entry(topup("b", {}), "pc1", "2026-11-05T10:00:00Z", { seq: 1 });
    const c = entry(topup("c", {}), "pc2", "2026-11-05T08:00:00Z");
    const d = entry(topup("d", {}), "pc1", "2026-11-05T08:00:00Z");
    expect(sortLog([a, b, c, d]).map((e) => e.command.id)).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
    expect(compareLog(c, c)).toBe(0);
  });
});

describe("replayLog", () => {
  it("two tellers race for the same notes: first by order is covered, second is short and told which", () => {
    const log = [
      entry(pay("t2", { "100": 2 }), "pc2", "2026-11-05T09:00:01Z", { seq: 2 }),
      entry(pay("t1", { "100": 2 }), "pc1", "2026-11-05T09:00:00Z", { seq: 1 }),
    ];
    const { view, steps } = replayLog(state({ "100": 3 }), log, "b");
    expect(steps.map((s) => [s.id, s.covered])).toEqual([
      ["t1", true],
      ["t2", false],
    ]);
    expect(steps[1]!.short).toEqual({ "100": 1 });
    expect(view.balance).toEqual({ "100": -1 }); // the cash really went out: reality wins, a person looks at it
    expect(view.negative).toBe(true);
  });

  it("every machine replaying the same log in any arrival order reaches the same drawer", () => {
    const log = [
      entry(pay("t1", { "100": 1 }), "pc1", "2026-11-05T09:00:00Z", { seq: 1 }),
      entry(topup("m1", { "100": 4 }), "pc3", "2026-11-05T09:01:00Z", {
        seq: 2,
      }),
      entry(pay("t2", { "100": 3 }), "pc2", "2026-11-05T09:02:00Z", { seq: 3 }),
    ];
    const forwards = replayLog(state({ "100": 2 }), log, "b").view;
    const backwards = replayLog(
      state({ "100": 2 }),
      [...log].reverse(),
      "b",
    ).view;
    expect(forwards).toEqual(backwards);
    expect(forwards.balance).toEqual({ "100": 2 });
  });

  it("skips commands the server already confirmed, and a command copied twice counts once", () => {
    const t1 = entry(pay("t1", { "100": 1 }), "pc1", "2026-11-05T09:00:00Z", {
      seq: 1,
    });
    const { view, steps } = replayLog(
      state({ "100": 5 }, ["t1"]),
      [
        t1,
        entry(pay("t2", { "100": 1 }), "pc1", "2026-11-05T09:01:00Z", {
          seq: 2,
        }),
        entry(pay("t2", { "100": 1 }), "pc1", "2026-11-05T09:01:00Z", {
          seq: 3,
        }),
      ],
      "b",
    );
    expect(steps.map((s) => s.id)).toEqual(["t2"]);
    expect(view.balance).toEqual({ "100": 4 });
    expect(view.pendingCount).toBe(1);
  });

  it("without a hub the same inputs still give one answer, whatever order they arrive in", () => {
    const log = [
      entry(pay("x", { "50": 1 }), "pcB", "2026-11-05T09:00:00Z", {
        localSeq: 1,
      }),
      entry(pay("y", { "50": 1 }), "pcA", "2026-11-05T09:00:00Z", {
        localSeq: 1,
      }),
    ];
    const r1 = replayLog(state({ "50": 1 }), log, "b");
    const r2 = replayLog(state({ "50": 1 }), [...log].reverse(), "b");
    expect(r1.steps.map((s) => s.id)).toEqual(["y", "x"]); // machine id breaks the tie
    expect(r1).toEqual(r2);
  });

  it("no open day: nothing is held against the drawer", () => {
    const { steps, view } = replayLog(
      state({}, [], "closed"),
      [entry(pay("a", { "100": 1 }), "pc1", "2026-11-05T09:00:00Z")],
      "b",
    );
    expect(steps[0]).toMatchObject({ covered: true, balance: null });
    expect(view.balance).toBeNull();
  });
});

describe("branches with the note rule off (loose)", () => {
  const day = (loose: boolean): DayStateLike => ({
    day: {
      id: "d1",
      status: "open",
      businessDate: "2026-11-11",
      opening: { lines: { "100": 1, "50": 2 } },
    },
    balance: { "100": 1, "50": 2 }, // GHS 200
    appliedIds: [],
    looseDenominations: loose,
  });
  const pay = (lines: Record<string, number>): DrawerCommand => ({
    id: "p1",
    type: "transaction.pay",
    payload: { transactionId: "t1", branchId: "b", lines },
  });
  it("strict: notes the drawer lacks are refused even when the money is there", () => {
    const v = projectDrawer(day(false), [], "b");
    expect(v.loose).toBe(false);
    const a = admit(v, pay({ "20": 10 }), "b");
    expect(a.ok).toBe(false);
    expect(a.short).toEqual({ "20": 10 });
  });
  it("loose: the same payout is allowed because the money covers it", () => {
    const v = projectDrawer(day(true), [], "b");
    expect(v.loose).toBe(true);
    const a = admit(v, pay({ "20": 10 }), "b");
    expect(a.ok).toBe(true);
    expect(a.balance).toEqual({ "100": 1, "50": 2, "20": -10 });
  });
  it("loose: more money than the drawer holds is still refused", () => {
    const a = admit(projectDrawer(day(true), [], "b"), pay({ "20": 11 }), "b");
    expect(a.ok).toBe(false);
  });
  it('loose: a negative note count alone is not "negative"; negative money is', () => {
    expect(
      projectDrawer(day(true), [pay({ "20": 10 }) as never], "b").negative,
    ).toBe(false);
    expect(
      projectDrawer(day(false), [pay({ "20": 10 }) as never], "b").negative,
    ).toBe(true);
  });
  it("loose: replaying a log keeps the money rule, in order", () => {
    const log: LogEntry[] = [
      {
        seq: 1,
        deviceId: "a",
        capturedAt: "2026-11-11T08:00:00Z",
        command: { ...pay({ "20": 6 }), id: "x1" },
      },
      {
        seq: 2,
        deviceId: "b",
        capturedAt: "2026-11-11T08:01:00Z",
        command: { ...pay({ "20": 6 }), id: "x2" },
      },
    ];
    const r = replayLog(day(true), log, "b");
    expect(r.steps.map((s) => s.covered)).toEqual([true, false]); // GHS 120 then 120 more: the second exceeds the GHS 200
  });
});

describe("days opened and closed with no connection", () => {
  const B = "b1";
  const server: DayStateLike = {
    day: {
      id: "mon",
      status: "open",
      businessDate: "2026-11-09",
      opening: { lines: { "100": 10 } },
    },
    balance: { "100": 10 },
    appliedIds: ["mon"],
    carryOver: { "100": 10 },
  };
  const close = (id: string, dayId: string, cash: Lines): DrawerCommand => ({
    id,
    type: "day.close",
    payload: { dayId, branchId: B, declared: { cash } },
  });
  const open = (
    id: string,
    date: string,
    lines: Lines,
    extra: object = {},
  ): DrawerCommand => ({
    id,
    type: "day.open",
    payload: { id, branchId: B, businessDate: date, lines, ...extra },
  });
  const buy = (id: string, n: number): DrawerCommand => ({
    id,
    type: "transaction.create",
    payload: { branchId: B, payout: { lines: { "100": n } } },
  });
  const move = (id: string, dayId: string, n: number): DrawerCommand => ({
    id,
    type: "drawer.movement",
    payload: { dayId, kind: "topup", lines: { "100": n } },
  });

  it("a waiting closing closes the drawer; the count is what the next day starts from", () => {
    const v = projectDrawer(
      server,
      [buy("t1", 2), close("c1", "mon", { "100": 8, "50": 0 })],
      B,
    );
    expect(v).toMatchObject({
      status: "closed",
      balance: null,
      closingLines: { "100": 8, "50": 0 },
      carryOver: { "100": 8 },
      local: true,
      pendingCount: 2,
    });
  });

  it("close Monday, open Tuesday, trade: all on the device", () => {
    const v = projectDrawer(
      server,
      [
        buy("t1", 2),
        close("c1", "mon", { "100": 8 }),
        open("tue", "2026-11-10", { "100": 8 }),
        buy("t2", 3),
        move("m1", "tue", 1),
      ],
      B,
    );
    expect(v).toMatchObject({
      status: "open",
      dayId: "tue",
      businessDate: "2026-11-10",
      openingLines: { "100": 8 },
      balance: { "100": 6 },
      local: true,
      pendingCount: 5,
    });
  });

  it("a movement for the old day does not touch the new day", () => {
    const v = projectDrawer(
      server,
      [
        close("c1", "mon", { "100": 10 }),
        open("tue", "2026-11-10", { "100": 10 }),
        move("m0", "mon", 5),
      ],
      B,
    );
    expect(v.balance).toEqual({ "100": 10 });
  });

  it("once the server has the opening, it is not counted again", () => {
    const later: DayStateLike = {
      day: {
        id: "tue",
        status: "open",
        businessDate: "2026-11-10",
        opening: { lines: { "100": 8 } },
      },
      balance: { "100": 5 },
      appliedIds: ["tue", "t2"],
      carryOver: { "100": 5 },
    };
    const v = projectDrawer(
      later,
      [open("tue", "2026-11-10", { "100": 8 }), buy("t2", 3), buy("t3", 1)],
      B,
    );
    expect(v).toMatchObject({
      status: "open",
      dayId: "tue",
      balance: { "100": 4 },
      local: false,
      pendingCount: 1,
    });
  });

  it("once the server has the closing, it is not counted again", () => {
    const closed: DayStateLike = {
      day: {
        id: "mon",
        status: "closed",
        businessDate: "2026-11-09",
        opening: { lines: {} },
        closing: { cash: { counted: { "100": 8 } } },
      },
      balance: null,
      appliedIds: ["mon"],
      carryOver: { "100": 8 },
    };
    const v = projectDrawer(closed, [close("c1", "mon", { "100": 8 })], B);
    expect(v).toMatchObject({
      status: "closed",
      local: false,
      pendingCount: 0,
    });
  });

  it("an opening for the date already open is the same day under a second id", () => {
    const v = projectDrawer(
      server,
      [
        open("mon2", "2026-11-09", { "100": 9 }),
        move("m1", "mon2", 2),
        close("c1", "mon2", { "100": 12 }),
      ],
      B,
    );
    expect(v).toMatchObject({
      status: "closed",
      dayId: "mon",
      closingLines: { "100": 12 },
    });
    const mid = projectDrawer(
      server,
      [open("mon2", "2026-11-09", { "100": 9 }), move("m1", "mon2", 2)],
      B,
    );
    expect(mid).toMatchObject({
      status: "open",
      dayId: "mon",
      balance: { "100": 12 },
      local: false,
    });
  });

  it("a second session after closing (same date) is a new opening", () => {
    const v = projectDrawer(
      server,
      [
        close("c1", "mon", { "100": 10 }),
        open("mon-b", "2026-11-09", { "100": 10 }, { afterClose: true }),
        buy("t", 1),
      ],
      B,
    );
    expect(v).toMatchObject({
      status: "open",
      dayId: "mon-b",
      balance: { "100": 9 },
    });
  });

  it("with no day at the server yet, the first opening can be made offline too", () => {
    const none: DayStateLike = {
      day: null,
      balance: null,
      appliedIds: [],
      carryOver: null,
    };
    const v = projectDrawer(
      none,
      [open("first", "2026-11-09", { "50": 4 })],
      B,
    );
    expect(v).toMatchObject({
      status: "open",
      dayId: "first",
      balance: { "50": 4 },
      local: true,
    });
  });

  it("ignores another branch's openings and closings", () => {
    const other: DrawerCommand = {
      id: "x",
      type: "day.close",
      payload: { dayId: "mon", branchId: "b2", declared: { cash: {} } },
    };
    expect(projectDrawer(server, [other], B)).toMatchObject({
      status: "open",
      pendingCount: 0,
    });
  });
});
