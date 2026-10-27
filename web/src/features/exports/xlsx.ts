/** Writes a simple one-sheet Excel file in the browser. Figures stay numbers, dates stay dates, so the sheet can be sorted and summed. */
export type SheetCell = string | number | boolean | Date | null | undefined;

export interface SheetColumn {
  header: string;
  width?: number;
  /** Number format, e.g. '#,##0.00'. */
  format?: string;
}

const DATE_TIME = "yyyy-mm-dd hh:mm";

export function toSheetData(columns: SheetColumn[], rows: SheetCell[][]) {
  return [
    columns.map((c) => ({ value: c.header, fontWeight: "bold" as const })),
    ...rows.map((row) =>
      row.map((v, i) => {
        if (v === null || v === undefined || v === "") return null;
        if (v instanceof Date) return { value: v, format: DATE_TIME };
        if (typeof v === "number")
          return columns[i]?.format
            ? { value: v, format: columns[i]!.format }
            : { value: v };
        return typeof v === "boolean" ? { value: v } : { value: v };
      }),
    ),
  ];
}

export async function saveSheet(
  fileName: string,
  sheetName: string,
  columns: SheetColumn[],
  rows: SheetCell[][],
) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  await writeExcelFile(
    toSheetData(columns, rows) as never,
    {
      sheet: sheetName.slice(0, 31),
      columns: columns.map((c) => ({ width: c.width ?? 14 })),
      stickyRowsCount: 1,
    } as never,
  ).toFile(fileName);
}

/** A figure from the API (a string like "1250.5") as a number, or null when empty. */
export const num = (s: string | null | undefined): number | null =>
  s === null || s === undefined || s === "" || Number.isNaN(Number(s))
    ? null
    : Number(s);
export const stamp = (iso: string | null | undefined): Date | null =>
  iso ? new Date(iso) : null;
export const fileDate = () => new Date().toISOString().slice(0, 10);
