import { reviewApi } from "@/features/review/api";
import { sourceLabel } from "@/features/review/labels";
import { fileDate, num, saveSheet, stamp, type SheetColumn } from "./xlsx";

const COLUMNS: SheetColumn[] = [
  { header: "Date and time", width: 18 },
  { header: "What happened", width: 26 },
  { header: "Kind", width: 12 },
  { header: "Change (GH₵)", width: 15, format: "#,##0.00" },
  { header: "Gold top", width: 11, format: "#,##0.00" },
  { header: "Gold down", width: 11, format: "#,##0.00" },
  { header: "Detail", width: 34 },
  { header: "Recorded by", width: 18 },
  { header: "Cash after", width: 15, format: "#,##0.00" },
  { header: "Gold value after", width: 16, format: "#,##0.00" },
  { header: "Debts after", width: 15, format: "#,##0.00" },
  { header: "We owe after", width: 15, format: "#,##0.00" },
];

const MAX = 5000;
const KIND: Record<string, string> = {
  cash: "Cash",
  goods: "Gold",
  debt: "Debt",
  payable: "We owe",
};

/** Pages through the branch timeline with the screen's filters and saves every row (oldest first) as an Excel file. Returns how many rows were written. */
export async function exportTimeline(
  branchId: string,
  branchName: string,
  params: { from?: string; to?: string; asset?: string },
): Promise<{ rows: number; capped: boolean }> {
  const entries = [];
  let before: number | undefined;
  for (;;) {
    const page = await reviewApi.timeline(branchId, {
      ...params,
      ...(before ? { before } : {}),
    });
    entries.push(...page.entries);
    if (page.nextBefore === null || entries.length >= MAX) {
      before = page.nextBefore ?? undefined;
      break;
    }
    before = page.nextBefore;
  }
  const capped = entries.length >= MAX && before !== undefined;
  const ordered = [...entries].reverse(); // the API returns newest first
  await saveSheet(
    `${branchName}-timeline-${fileDate()}.xlsx`,
    "Timeline",
    COLUMNS,
    ordered.map((e) => [
      stamp(e.occurredAt),
      sourceLabel[e.sourceType] ?? e.sourceType,
      KIND[e.asset] ?? e.asset,
      num(e.deltaValue),
      num(e.deltaTop),
      num(e.deltaDown),
      e.asset === "cash" ? `${e.deltaCount} × ${e.denomination}` : e.memo,
      e.recordedBy?.displayName,
      num(e.running.cash),
      num(e.running.goodsValue),
      num(e.running.debt),
      num(e.running.payable),
    ]),
  );
  return { rows: ordered.length, capped };
}
