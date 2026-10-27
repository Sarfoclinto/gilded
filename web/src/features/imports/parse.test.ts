import { describe, expect, it } from "vitest";
import {
  chunk,
  dateOf,
  figure,
  parseCsv,
  parseCustomers,
  parseHistory,
  type BranchRef,
  type Table,
} from "./parse";

const branches: BranchRef[] = [
  { id: "b-tkw", code: "TKW", name: "Tarkwa" },
  { id: "b-ksi", code: "KSI", name: "Kumasi" },
];
const NOW = new Date("2026-10-27T00:00:00Z");
const head = [
  "Date",
  "Branch",
  "Customer",
  "Phone",
  "Top",
  "Down",
  "Price",
  "Amount paid",
  "Receipt no",
];

describe("dates and figures", () => {
  it("reads iso, day-first, serial and Date cells, and refuses nonsense", () => {
    expect(dateOf("2026-03-02")).toBe("2026-03-02");
    expect(dateOf("02/03/2026")).toBe("2026-03-02");
    expect(dateOf("2.3.26")).toBe("2026-03-02");
    expect(dateOf(46083)).toBe("2026-03-02");
    expect(dateOf(new Date(Date.UTC(2026, 2, 2)))).toBe("2026-03-02");
    expect(dateOf("31/02/2026")).toBeNull();
    expect(dateOf("soon")).toBeNull();
  });
  it("cleans figures", () => {
    expect(figure("GH₵ 1,250.50")).toBe("1250.50");
    expect(figure(7.77)).toBe("7.77");
    expect(figure("  ")).toBeNull();
  });
});

describe("customers", () => {
  it("reads name and phone, restores a dropped leading zero, and flags the rest", () => {
    const t: Table = [
      ["Name", "Phone", "Notes"],
      ["Kofi", 241000001, "regular"],
      ["", "024"],
      ["Ama", ""],
      ["Kofi", "0241000001"],
    ];
    const r = parseCustomers(t);
    expect(r.rows).toEqual([
      { name: "Kofi", phone: "0241000001", notes: "regular" },
    ]);
    expect(r.problems.map((p) => p.row)).toEqual([3, 4, 5]);
  });
  it("explains a missing header", () => {
    expect(
      parseCustomers([
        ["a", "b"],
        ["x", "y"],
      ]).problems[0]!.message,
    ).toContain("Name and Phone");
  });
});

describe("past purchases", () => {
  const table = (...rows: Table) => [head, ...rows];

  it("reads a row into a purchase with a preview amount", () => {
    const r = parseHistory(
      table([
        "2026-03-02",
        "TKW",
        "Kofi",
        "0241",
        "7.77",
        "0.41",
        "11650",
        1000,
        "",
      ]),
      branches,
      null,
      NOW,
    );
    expect(r.problems).toEqual([]);
    expect(r.purchases).toHaveLength(1);
    expect(r.purchases[0]).toMatchObject({
      key: "2",
      branchId: "b-tkw",
      capturedAt: "2026-03-02T12:00:00Z",
      customerName: "Kofi",
      amountPaid: "1000",
    });
    expect(Number(r.purchases[0]!.previewAmount)).toBeGreaterThan(0);
  });

  it("joins the lines of one receipt into one purchase", () => {
    const r = parseHistory(
      table(
        ["2026-03-02", "Tarkwa", "Ama", "", "7.77", "0.41", "11650", "", "R-1"],
        ["2026-03-02", "tkw", "Ama", "", "5.10", "0.33", "11650", 900, "R-1"],
        ["2026-03-02", "TKW", "Ama", "", "5.10", "0.33", "11650", "", "R-2"],
      ),
      branches,
      null,
      NOW,
    );
    expect(r.purchases).toHaveLength(2);
    expect(r.purchases[0]!.items).toHaveLength(2);
    expect(r.purchases[0]!.amountPaid).toBe("900");
  });

  it("uses the chosen branch when the sheet has no branch cell and reports every bad row", () => {
    const r = parseHistory(
      table(
        ["2026-03-02", "", "Kofi", "", "7.77", "0.41", "11650", "", ""],
        ["2027-01-01", "TKW", "Kofi", "", "7.77", "0.41", "11650", "", ""],
        ["2026-03-02", "XYZ", "Kofi", "", "7.77", "0.41", "11650", "", ""],
        ["2026-03-02", "TKW", "", "", "7.77", "0.41", "11650", "", ""],
        ["2026-03-02", "TKW", "Kofi", "", "abc", "0.41", "11650", "", ""],
        ["", "", "", "", "", "", "", "", ""],
      ),
      branches,
      "b-ksi",
      NOW,
    );
    expect(r.purchases.map((p) => p.branchId)).toEqual(["b-ksi"]);
    expect(r.problems.map((p) => p.row)).toEqual([3, 4, 5, 6]);
  });

  it("needs the key columns", () => {
    expect(
      parseHistory([["Date", "Customer", "Top"]], branches, "b-tkw", NOW)
        .problems[0]!.message,
    ).toContain("Missing");
    expect(parseHistory([head], branches, null, NOW).purchases).toEqual([]);
  });
});

describe("csv", () => {
  it("handles quotes, semicolons and windows line endings", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("splits in chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
