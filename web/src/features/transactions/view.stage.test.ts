import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "@/shared/offline/outboxStore";
import { fromOutbox } from "./view";

const entry = (
  split?: Array<{ method: string; amount: string }>,
): OutboxEntry => ({
  id: "tx1",
  type: "transaction.create",
  status: "pending",
  attempts: 0,
  createdAt: 0,
  nextAttemptAt: 0,
  payload: {
    id: "tx1",
    branchId: "b1",
    customerName: "Kofi",
    capturedAt: "2026-10-31T09:00:00Z",
    priceAsOf: "2026-10-31T08:00:00Z",
    clientAmount: "1000",
    items: [{ id: "i1", top: "7.77", down: "0.41", price: "11650" }],
    payout: {
      policy: "down",
      strategy: "fewest-notes",
      payable: "1000",
      lines: { "200": 5 },
      split,
    },
  },
});

describe("a purchase waiting on this device", () => {
  it("is paid at once when two-step is off", () => {
    const v = fromOutbox(entry());
    expect(v.payout.stage).toBe("paid");
    expect(v.payout.lines).toEqual({ "200": 5 });
  });
  it("waits to be paid when two-step is on, with the notes only as a suggestion", () => {
    const v = fromOutbox(entry(), true);
    expect(v.payout.stage).toBe("to_pay");
    expect(v.payout.cashDue).toBe("1000");
    expect(v.payout.suggestedLines).toEqual({ "200": 5 });
    expect(v.payout.lines).toEqual({});
    expect(v.payments.some((p) => p.method === "cash")).toBe(false);
  });
  it("waits only for the cash part when some is paid another way", () => {
    const v = fromOutbox(entry([{ method: "owed", amount: "300" }]), true);
    expect(v.payout.cashDue).toBe("700");
  });
});
