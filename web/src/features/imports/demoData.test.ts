import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseCsv,
  parseCustomers,
  parseHistory,
  parseOpeningDebts,
  parseOpeningGold,
} from "./parse";

// The demo files in deploy/demo-data must always be accepted by the import screens.
const read = (f: string) =>
  parseCsv(
    readFileSync(
      new URL(`../../../../deploy/demo-data/${f}`, import.meta.url),
      "utf8",
    ),
  );
const branches = [
  { id: "b1", code: "TKW", name: "Takoradi" },
  { id: "b2", code: "KSI", name: "Kumasi" },
];

describe("demo data files", () => {
  it("customers", () => {
    const r = parseCustomers(read("customers.csv"));
    expect(r.problems).toEqual([]);
    expect(r.rows.length).toBe(40);
  });
  it("past purchases", () => {
    const r = parseHistory(
      read("past-purchases.csv"),
      branches,
      null,
      new Date("2026-10-30"),
    );
    expect(r.problems).toEqual([]);
    expect(r.purchases.length).toBeGreaterThan(50);
  });
  it("opening gold", () => {
    const r = parseOpeningGold(read("opening-gold.csv"), branches, null);
    expect(r.problems).toEqual([]);
    expect(r.rows?.length ?? 2).toBe(2);
  });
  it("opening debts", () => {
    const r = parseOpeningDebts(
      read("opening-debts.csv"),
      branches,
      null,
      new Date("2026-10-30"),
    );
    expect(r.problems).toEqual([]);
  });
});
