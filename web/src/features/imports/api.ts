import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";
import type { HistoryPurchase } from "./parse";

export const importKeys = createKeys("imports");

export const batchSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.object({ displayName: z.string() }).nullable(),
  undone: z.boolean(),
  purchases: z.number(),
  worth: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type ImportBatch = z.infer<typeof batchSchema>;

const historyResult = z
  .object({ created: z.number(), skipped: z.number() })
  .loose();
const customersResult = z.object({ created: z.number(), existing: z.number() });

export const importsApi = {
  history: (batchId: string, label: string, purchases: HistoryPurchase[]) =>
    request(
      {
        method: "post",
        url: "/imports/history",
        data: {
          batchId,
          label,
          rows: purchases.map((p) => ({
            key: p.key,
            branchId: p.branchId,
            capturedAt: p.capturedAt,
            customerName: p.customerName,
            customerPhone: p.customerPhone,
            receiptNo: p.receiptNo,
            note: p.note,
            items: p.items,
            amountPaid: p.amountPaid,
            sheetAmount: p.sheetAmount,
          })),
        },
      },
      historyResult,
    ),
  customers: (rows: Array<{ name: string; phone: string; notes?: string }>) =>
    request(
      { method: "post", url: "/imports/customers", data: { rows } },
      customersResult,
    ),
  batches: (signal?: AbortSignal) =>
    request({ method: "get", url: "/imports", signal }, z.array(batchSchema)),
  undo: (id: string, reason: string) =>
    request(
      { method: "post", url: `/imports/${id}/undo`, data: { reason } },
      z.object({ voided: z.number() }),
    ),
};

export const useImportBatches = () =>
  useApiQuery({
    queryKey: importKeys.list({}),
    queryFn: ({ signal }) => importsApi.batches(signal),
    staleTime: 0,
  });

export function useUndoImport() {
  return useApiMutation<{ voided: number }, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => importsApi.undo(id, reason),
    invalidates: [importKeys.all],
    successMessage: (r) => `${r.voided} purchases were voided`,
  });
}
