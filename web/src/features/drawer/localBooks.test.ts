import { describe, expect, it } from "vitest";
import {
  basisOf,
  FALLBACK_CONFIRMATION,
  localBooks,
  type WaitingEntry,
} from "./localBooks";
import type { DayState } from "./schemas";

const B = "b1";
const state = (over: Partial<DayState> = {}): DayState => ({
  day: null,
  balance: null,
  movements: [],
  appliedIds: [],
  carryOver: null,
  books: {
    goodsTop: "100.5",
    goodsDown: "90.25",
    goodsValue: "50000",
    debt: "1200",
    payable: "300",
    custodyTop: "12.3456",
  },
  asOf: "2026-11-12T08:00:00.000Z",
  ...over,
});
const view = {
  status: "open" as const,
  dayId: "d1",
  balance: { "100": 40, "50": 0 },
};
const buy = (
  id: string,
  o: {
    top: string;
    down: string;
    payable: string;
    split?: { method: string; amount: string }[];
    collateralId?: string;
    branchId?: string;
  },
): WaitingEntry => ({
  id,
  type: "transaction.create",
  payload: {
    branchId: o.branchId ?? B,
    collateralId: o.collateralId,
    items: [{ top: o.top, down: o.down }],
    payout: { payable: o.payable, lines: {}, split: o.split },
  },
});
const run = (waiting: WaitingEntry[], twoStep = false, s = state()) =>
  localBooks(s, view, waiting, B, twoStep, FALLBACK_CONFIRMATION);

describe("the books worked out on the device", () => {
  it("with nothing waiting they are the last figures from the server, and the cash is the drawer", () => {
    const r = run([])!;
    expect(r.preview.expected).toEqual({
      cash: { lines: { "100": 40 }, value: "4000" },
      goodsTop: "100.5",
      goodsDown: "90.25",
      goodsValue: "50000",
      debt: "1200",
      payable: "300",
      custodyTop: "12.3456",
    });
    expect(r.preview.dayId).toBe("d1");
    expect(r.custodyUncertain).toBe(false);
  });

  it("a waiting purchase adds its gold and its value", () => {
    const e = run([
      buy("t1", { top: "10.1", down: "9.2", payable: "8605" }),
      buy("t2", { top: "0.0005", down: "0.0004", payable: "0.50" }),
    ])!.preview.expected;
    expect([e.goodsTop, e.goodsDown, e.goodsValue]).toEqual([
      "110.6005",
      "99.4504",
      "58605.5",
    ]);
    expect([e.debt, e.payable]).toEqual(["1200", "300"]);
  });

  it("money owed to the customer and a debt settled with gold move those figures", () => {
    const e = run([
      buy("t1", {
        top: "1",
        down: "1",
        payable: "1000",
        split: [
          { method: "owed", amount: "400" },
          { method: "debt_offset", amount: "250.5" },
          { method: "mobile_money", amount: "100" },
        ],
      }),
    ])!.preview.expected;
    expect(e.payable).toBe("700");
    expect(e.debt).toBe("949.5");
  });

  it("two-step payout: the cash is owed until it is handed over", () => {
    const waiting = [
      buy("t1", {
        top: "1",
        down: "1",
        payable: "1000",
        split: [{ method: "mobile_money", amount: "300" }],
      }),
    ];
    expect(run(waiting, true)!.preview.expected.payable).toBe("1000"); // 300 + 700 cash still to pay
    const paid = [
      ...waiting,
      {
        id: "p1",
        type: "transaction.pay",
        payload: { transactionId: "t1", branchId: B, lines: { "100": 7 } },
      },
    ];
    expect(run(paid, true)!.preview.expected.payable).toBe("300");
    expect(run(waiting, false)!.preview.expected.payable).toBe("300");
  });

  it("skips what the server already has, and other branches", () => {
    const waiting = [
      buy("t1", { top: "5", down: "5", payable: "100" }),
      buy("t2", { top: "5", down: "5", payable: "100", branchId: "other" }),
    ];
    const e = run(waiting, false, state({ appliedIds: ["t1"] }))!.preview
      .expected;
    expect(e.goodsTop).toBe("100.5");
  });

  it("says when the held-gold figure may be off", () => {
    expect(
      run([
        buy("t1", { top: "1", down: "1", payable: "10", collateralId: "c" }),
      ])!.custodyUncertain,
    ).toBe(true);
  });

  it("has nothing to work from without the books (an old stored copy) or without an open day", () => {
    expect(run([], false, state({ books: undefined }))).toBeNull();
    expect(
      localBooks(
        state(),
        { status: "closed", dayId: "d1", balance: null },
        [],
        B,
        false,
        FALLBACK_CONFIRMATION,
      ),
    ).toBeNull();
  });

  it("the basis is what was shown", () => {
    const p = run([])!.preview;
    expect(basisOf(p)).toMatchObject({
      cash: { "100": 40 },
      goodsValue: "50000",
      asOf: "2026-11-12T08:00:00.000Z",
    });
  });
});
