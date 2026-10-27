import { useState } from "react";
import { Alert, Input, Modal } from "antd";
import { z } from "zod";
import { DownloadIcon } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { branches } from "@/features/branches/api";
import { request } from "@/shared/api/client";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { num, saveSheet, stamp, type SheetColumn } from "./xlsx";

const rowSchema = z.object({
  reference: z.string(),
  capturedAt: z.string(),
  status: z.string(),
  customerName: z.string(),
  customerPhone: z.string().nullable().optional(),
  pieces: z.number(),
  topWeight: z.string(),
  netWeight: z.string(),
  calculated: z.string(),
  payable: z.string(),
  difference: z.string(),
  cash: z.string(),
  mobileMoney: z.string(),
  owed: z.string(),
  flags: z.string().nullable().optional(),
  imported: z.boolean(),
  receiptNo: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  voidReason: z.string().nullable().optional(),
});
const exportSchema = z.object({
  truncated: z.boolean(),
  rows: z.array(rowSchema),
});

const COLUMNS: SheetColumn[] = [
  { header: "Reference", width: 22 },
  { header: "Date and time", width: 18 },
  { header: "Status", width: 10 },
  { header: "Customer", width: 26 },
  { header: "Phone", width: 14 },
  { header: "Pieces", width: 8 },
  { header: "Top weight", width: 11, format: "#,##0.00" },
  { header: "Net weight", width: 11, format: "#,##0.00" },
  { header: "Calculated (GH₵)", width: 16, format: "#,##0.00" },
  { header: "Paid (GH₵)", width: 14, format: "#,##0.00" },
  { header: "Difference", width: 12, format: "#,##0.00" },
  { header: "Cash", width: 12, format: "#,##0.00" },
  { header: "Mobile money", width: 14, format: "#,##0.00" },
  { header: "Owed to customer", width: 16, format: "#,##0.00" },
  { header: "Notes", width: 30 },
  { header: "Imported", width: 10 },
  { header: "Receipt no", width: 12 },
  { header: "Recorded by", width: 18 },
  { header: "Void reason", width: 24 },
];

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Downloads a branch's purchases for a date range as an Excel file. */
export function ExportTransactionsButton() {
  const branchId = useAuth((s) => s.activeBranchId);
  const list = branches.useList();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() =>
    day(new Date(Date.now() - 30 * 86_400_000)),
  );
  const [to, setTo] = useState(() => day(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const branch = list.data?.find((b) => b.id === branchId);

  async function go() {
    if (!branchId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const params = {
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(
          new Date(`${to}T00:00:00`).getTime() + 86_400_000,
        ).toISOString(),
      };
      const r = await request(
        {
          method: "get",
          url: `/branches/${branchId}/transactions/export`,
          params,
        },
        exportSchema,
      );
      await saveSheet(
        `${branch?.code ?? "branch"}-purchases-${from}-to-${to}.xlsx`,
        "Purchases",
        COLUMNS,
        r.rows.map((x) => [
          x.reference,
          stamp(x.capturedAt),
          x.status,
          x.customerName,
          x.customerPhone,
          x.pieces,
          num(x.topWeight),
          num(x.netWeight),
          num(x.calculated),
          num(x.payable),
          num(x.difference),
          num(x.cash),
          num(x.mobileMoney),
          num(x.owed),
          x.flags,
          x.imported ? "Yes" : "",
          x.receiptNo,
          x.createdBy,
          x.voidReason,
        ]),
      );
      setNote(
        r.rows.length === 0
          ? "There were no purchases in that range."
          : r.truncated
            ? "The file has the first 5000 purchases of the range. Choose a shorter range for the rest."
            : `${r.rows.length} purchases saved to your downloads.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          setNote(null);
          setError(null);
        }}
      >
        <DownloadIcon className="size-4" /> Excel
      </Button>
      <Modal
        open={open}
        title={`Export ${branch?.name ?? "this branch"}'s purchases`}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              loading={busy}
              disabled={!from || !to || from > to}
              onClick={go}
            >
              Download
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              From{" "}
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block"
              />
            </label>
            <label className="text-sm">
              To{" "}
              <Input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 block"
              />
            </label>
          </div>
          {error ? <Alert type="error" showIcon title={error} /> : null}
          {note ? <Alert type="success" showIcon title={note} /> : null}
        </div>
      </Modal>
    </>
  );
}
