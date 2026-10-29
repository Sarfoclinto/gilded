import { describe, expect, it } from "vitest";
import {
  differenceOf,
  filterItems,
  matches,
  pickedTotals,
  roadAge,
  stageOf,
  summarize,
} from "./model";
import type { TransferableItem, TransferRow } from "./schemas";

const now = new Date(2026, 9, 29, 15, 0);
const row = (o: Partial<TransferRow> = {}): TransferRow => ({
  id: "x",
  reference: "TRF-KSI-0001",
  kind: "goods",
  status: "released",
  originBranchId: "ksi",
  originBranchName: "Kumasi",
  destinationBranchId: "tkw",
  destinationBranchName: "Tarkwa",
  purpose: "stock_collection",
  method: "staff_travelling",
  collectorName: "Ama",
  lineCount: 2,
  declaredValue: "1000",
  receivedValue: null,
  hasDiscrepancy: false,
  releasedAt: new Date(2026, 9, 29, 9, 0).toISOString(),
  receivedAt: null,
  createdAt: new Date(2026, 9, 28).toISOString(),
  ...o,
});
const item = (o: Partial<TransferableItem> = {}): TransferableItem => ({
  itemId: "i",
  transactionId: "t",
  reference: "KSI-1",
  customerName: "Kofi",
  label: "Ring",
  top: "10",
  down: "9",
  value: "500",
  purchasedAt: "",
  ...o,
});

describe("stage", () => {
  it("maps the status to a step", () => {
    expect(stageOf("draft")).toEqual({ index: 0, tone: "normal" });
    expect(stageOf("released").index).toBe(1);
    expect(stageOf("received_with_discrepancy")).toEqual({
      index: 2,
      tone: "warn",
    });
    expect(stageOf("cancelled")).toEqual({ index: -1, tone: "cancelled" });
  });
});

describe("road age", () => {
  it("only applies to transfers on the road", () => {
    expect(roadAge(row({ status: "received" }), now)).toBeNull();
    expect(roadAge(row({ releasedAt: null }), now)).toBeNull();
  });
  it("counts calendar days and warns from two days", () => {
    expect(roadAge(row(), now)).toMatchObject({
      days: 0,
      tone: "ok",
      text: "Left today",
    });
    expect(
      roadAge(
        row({ releasedAt: new Date(2026, 9, 28, 23).toISOString() }),
        now,
      ),
    ).toMatchObject({ days: 1, tone: "ok" });
    expect(
      roadAge(row({ releasedAt: new Date(2026, 9, 27).toISOString() }), now),
    ).toMatchObject({ days: 2, tone: "late" });
    expect(
      roadAge(row({ releasedAt: new Date(2026, 9, 20).toISOString() }), now),
    ).toMatchObject({ days: 9, tone: "stale", text: "On the road for 9 days" });
  });
});

describe("summary", () => {
  it("splits coming, going, drafts, differences and stale ones for a branch", () => {
    const rows = [
      row({
        id: "1",
        destinationBranchId: "tkw",
        originBranchId: "ksi",
        declaredValue: "1000",
      }),
      row({
        id: "2",
        destinationBranchId: "ksi",
        originBranchId: "tkw",
        declaredValue: "250",
        releasedAt: new Date(2026, 9, 20).toISOString(),
      }),
      row({
        id: "3",
        status: "draft",
        originBranchId: "tkw",
        releasedAt: null,
      }),
      row({
        id: "4",
        status: "draft",
        originBranchId: "ksi",
        releasedAt: null,
      }),
      row({ id: "5", status: "received_with_discrepancy" }),
    ];
    expect(summarize(rows, "tkw", now)).toEqual({
      coming: { count: 1, value: 1000 },
      going: { count: 1, value: 250 },
      drafts: 1,
      differences: 1,
      stale: 1,
    });
  });
});

describe("search", () => {
  it("matches the receipt, branches and collector", () => {
    expect(matches(row(), "kumasi")).toBe(true);
    expect(matches(row(), "TRF-KSI")).toBe(true);
    expect(matches(row(), "ama")).toBe(true);
    expect(matches(row(), "accra")).toBe(false);
    expect(matches(row(), "  ")).toBe(true);
  });
  it("searches the gold to send", () => {
    const items = [
      item(),
      item({
        itemId: "j",
        customerName: "Ama",
        label: "Chain",
        reference: "KSI-2",
      }),
    ];
    expect(filterItems(items, "chain").map((i) => i.itemId)).toEqual(["j"]);
    expect(filterItems(items, "ksi-1").map((i) => i.itemId)).toEqual(["i"]);
    expect(filterItems(items, "")).toHaveLength(2);
  });
  it("totals what is picked", () => {
    const items = [
      item(),
      item({ itemId: "j", top: "5", down: "4", value: "250" }),
    ];
    expect(pickedTotals(items, ["i", "j"])).toEqual({
      count: 2,
      top: 15,
      down: 13,
      value: 750,
    });
    expect(pickedTotals(items, [])).toEqual({
      count: 0,
      top: 0,
      down: 0,
      value: 0,
    });
  });
});

describe("difference on receipt", () => {
  it("is null before it is received", () =>
    expect(
      differenceOf({
        declared: { top: "10", down: "9", value: "500" },
        receipt: null,
      }),
    ).toBeNull());
  it("shows what is short", () => {
    const d = differenceOf({
      declared: { top: "10", down: "9", value: "500" },
      receipt: { top: "9.5", down: "8.5", value: "480", at: "" },
    });
    expect(d).toMatchObject({ top: -0.5, down: -0.5, value: -20 });
  });
  it("works for cash", () => {
    expect(
      differenceOf({
        declared: { cash: "1000" },
        receipt: { cash: "1000", at: "" },
      })?.cash,
    ).toBe(0);
  });
});
