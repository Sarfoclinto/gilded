import { describe, expect, it } from "vitest";
import { newSplit, nonCashTotal, splitProblems, toSplitParts } from "./split";

const ctx = {
  payable: 1000,
  customerPicked: false,
  customerReady: false,
  outstanding: {},
};

describe("split payments", () => {
  it("adds up the non-cash parts", () => {
    expect(
      nonCashTotal([
        newSplit("owed", { amount: "300" }),
        newSplit("mobile_money", { amount: "200" }),
      ]),
    ).toBe(500);
  });
  it("wants a sending branch for mobile money and a phone for an owed amount", () => {
    const p = splitProblems(
      [
        newSplit("mobile_money", { amount: "100" }),
        newSplit("owed", { amount: "50" }),
      ],
      ctx,
    );
    expect(p.join(" ")).toMatch(/sends the mobile money/);
    expect(p.join(" ")).toMatch(/name and phone/);
  });
  it("wants a picked customer and a debt to settle with gold, and never more than owed", () => {
    const part = newSplit("debt_offset", { amount: "900", debtId: "d1" });
    expect(splitProblems([part], { ...ctx, customerPicked: false })[0]).toMatch(
      /pick the customer/,
    );
    expect(
      splitProblems([part], {
        ...ctx,
        customerPicked: true,
        outstanding: { d1: 400 },
      }).join(" "),
    ).toMatch(/more than the customer owes/);
    expect(
      splitProblems(
        [newSplit("debt_offset", { amount: "400", debtId: "d1" })],
        { ...ctx, customerPicked: true, outstanding: { d1: 400 } },
      ),
    ).toEqual([]);
  });
  it("refuses parts that exceed the amount to pay", () => {
    expect(
      splitProblems(
        [newSplit("mobile_money", { amount: "1001", paidByBranchId: "b" })],
        ctx,
      ),
    ).toContain("The non-cash parts are more than the amount to pay.");
  });
  it("rejects decimals and zero", () => {
    expect(
      splitProblems([newSplit("owed", { amount: "10.5" })], {
        ...ctx,
        customerReady: true,
      })[0],
    ).toMatch(/whole amount/);
  });
  it("sends only the fields each method uses", () => {
    const [a, b] = toSplitParts([
      newSplit("mobile_money", {
        amount: "10",
        paidByBranchId: "k",
        externalRef: " X1 ",
      }),
      newSplit("debt_offset", { amount: "5", debtId: "d" }),
    ]);
    expect(a).toMatchObject({
      method: "mobile_money",
      paidByBranchId: "k",
      externalRef: "X1",
    });
    expect(a).not.toHaveProperty("debtId");
    expect(b).toMatchObject({ method: "debt_offset", debtId: "d" });
  });
});
