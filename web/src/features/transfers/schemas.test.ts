import { describe, expect, it } from "vitest";
import { transferSchema } from "./schemas";

// A real answer from POST /transfers/{id}/release (B57 scale reading + B60 photo counts), copied from a live server.
const released = {
  id: "b1c05977-f387-45c4-b13a-38093a0e9e78",
  kind: "goods",
  method: "staff_travelling",
  purpose: "stock_collection",
  status: "released",
  reference: "TRF-KSI-20261115-0001",
  purposeNote: null,
  cancellation: null,
  discrepancies: [],
  receipt: null,
  payments: [],
  expectedArrivalAt: null,
  originBranchId: "6a41db78-a198-4a53-8a5f-ae7a6e65440e",
  originBranchName: "Kumasi",
  destinationBranchId: "acba77e3-6b2b-45b4-8d2e-94ea8d2d8eed",
  destinationBranchName: "Anyaso",
  createdAt: "2026-11-15T13:13:31.971Z",
  createdBy: { id: "u", displayName: "Hec" },
  photos: { other: 0, receive: 0, release: 0 },
  scaled: {
    top: "54.61",
    down: "3.12",
    level: "ok",
    topLevel: "ok",
    downLevel: "ok",
    downAllowance: 0.085,
    topDifference: "0",
    downDifference: "0",
  },
  release: {
    at: "2026-11-15T13:14:42.817Z",
    by: { id: "u", displayName: "Hec" },
    note: null,
  },
  declared: {
    top: "54.61",
    cash: null,
    down: "3.12",
    value: "69830",
    cashLines: {},
  },
  collector: {
    name: "Super Admin",
    type: "staff",
    phone: null,
    idType: null,
    userId: "x",
    idNumber: null,
    collectedAt: "2026-11-15T13:14:42.817Z",
    relationship: null,
  },
  lines: [
    {
      id: "l",
      itemId: "i",
      lineNo: 1,
      outcome: "pending",
      reference: "KSI-1",
      description: "lump",
      receivedTop: null,
      releasedTop: "54.61",
      customerName: "T",
      receivedDown: null,
      releasedDown: "3.12",
      receivedValue: null,
      releasedValue: "69830",
    },
  ],
  events: [
    {
      at: "2026-11-15T13:14:42.817Z",
      by: { id: "u", displayName: "Hec" },
      id: 38,
      data: { kind: "goods", note: null },
      type: "released",
    },
  ],
};

describe("transfer answer", () => {
  it("accepts a released transfer whose scale allowance is a number", () => {
    expect(transferSchema.safeParse(released).success).toBe(true);
  });
  it("still accepts the allowance as text", () => {
    expect(
      transferSchema.safeParse({
        ...released,
        scaled: { ...released.scaled, downAllowance: "0.085" },
      }).success,
    ).toBe(true);
  });
});
