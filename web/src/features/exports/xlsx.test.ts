import { describe, expect, it } from "vitest";
import writeExcelFile from "write-excel-file/node";
import { readSheet } from "read-excel-file/node";
import { toSheetData, type SheetColumn } from "./xlsx";

const columns: SheetColumn[] = [
  { header: "Name" },
  { header: "When" },
  { header: "Amount", format: "#,##0.00" },
  { header: "Empty" },
];

describe("sheet data", () => {
  it("keeps numbers numeric, dates as dates, and blanks empty, with a bold header row", () => {
    const d = toSheetData(columns, [
      ["Kofi", new Date("2026-03-02T10:15:00Z"), 1250.5, null],
    ]);
    expect(d[0]![0]).toMatchObject({ value: "Name", fontWeight: "bold" });
    expect(d[1]![1]).toMatchObject({ value: new Date("2026-03-02T10:15:00Z") });
    expect(d[1]![2]).toMatchObject({ value: 1250.5, format: "#,##0.00" });
    expect(d[1]![3]).toBeNull();
  });

  it("writes a real xlsx file that reads back the same", async () => {
    const data = toSheetData(columns, [
      ["Kofi", new Date("2026-03-02T10:15:00Z"), 1250.5, null],
      ["Ama", null, 40, "x"],
    ]);
    const buffer = await writeExcelFile(
      data as never,
      {
        sheet: "Purchases",
        columns: columns.map(() => ({ width: 14 })),
        stickyRowsCount: 1,
      } as never,
    ).toBuffer();
    const sheet = (await readSheet(buffer)) as unknown[][];
    expect(sheet[0]).toEqual(["Name", "When", "Amount", "Empty"]);
    expect(sheet[1]![0]).toBe("Kofi");
    expect(sheet[1]![2]).toBe(1250.5);
    expect(sheet[2]![2]).toBe(40);
  });
});
