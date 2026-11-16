import { describe, expect, it } from "vitest";
import { customerDebtsSchema } from "./schemas";
import { owesHeadline } from "./model";

const debt = (o: Record<string, unknown>) => ({
  id: "d",
  branchId: "b",
  direction: "receivable",
  party: { type: "customer", name: "Kofi", customerId: "c" },
  principal: "1000",
  repaid: "0",
  outstanding: "1000",
  issuedAt: "2026-11-01T10:00:00Z",
  status: "open",
  repayments: [],
  branchName: "Tarkwa",
  ...o,
});
const fmt = (n: number) => `GHS ${n.toLocaleString("en-GB")}`;
const now = new Date("2026-11-16T12:00:00Z");

describe("what a customer already owes", () => {
  it("reads the server payload", () => {
    const s = customerDebtsSchema.parse({
      items: [debt({})],
      total: "1000",
      elsewhere: 0,
    });
    expect(s.items[0]?.branchName).toBe("Tarkwa");
  });
  it("says nothing owed, or nothing at your branches", () => {
    expect(
      owesHeadline("Kofi", { items: [], total: "0", elsewhere: 0 }, fmt, now),
    ).toBe("Kofi owes nothing.");
    expect(
      owesHeadline("Kofi", { items: [], total: "0", elsewhere: 2 }, fmt, now),
    ).toBe("Kofi has no open loans at your branches.");
  });
  it("totals the loans and counts the overdue ones", () => {
    const s = customerDebtsSchema.parse({
      items: [
        debt({ outstanding: "1000", dueDate: "2026-11-10" }),
        debt({ id: "e", outstanding: "500" }),
      ],
      total: "1500",
      elsewhere: 0,
    });
    expect(owesHeadline("Kofi", s, fmt, now)).toBe(
      "Kofi already owes GHS 1,500 on 2 loans, 1 overdue.",
    );
    expect(
      owesHeadline(
        "Kofi",
        { ...s, items: [s.items[1]!], total: "500" },
        fmt,
        now,
      ),
    ).toBe("Kofi already owes GHS 500 on 1 loan.");
  });
});
