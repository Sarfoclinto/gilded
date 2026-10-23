import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { dayKeys } from "@/features/drawer/api";
import { transactionKeys } from "@/features/transactions/api";
import { debtKeys } from "@/features/debts/api";
import { transactionSchema } from "@/features/transactions/schemas";

export const pendingPaymentSchema = z.object({
  paymentId: z.string(),
  transactionId: z.string(),
  reference: z.string().nullable().optional(),
  purchaseBranchId: z.string(),
  purchaseBranchName: z.string(),
  sendingBranchId: z.string(),
  sendingBranchName: z.string(),
  customerName: z.string(),
  amount: z.string(),
  externalRef: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PendingPayment = z.infer<typeof pendingPaymentSchema>;

export const paymentKeys = createKeys("payments");

export function usePendingPayments(
  branchId: string | null,
  role: "sending" | "receiving",
  enabled = true,
) {
  return useApiQuery({
    queryKey: paymentKeys.list({ branchId, role }),
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: "/payments/pending",
          params: { branchId, role },
          signal,
        },
        z.array(pendingPaymentSchema),
      ),
    enabled: !!branchId && enabled,
    staleTime: 0,
  });
}

/** What replaces a mobile money part that never arrived. The amounts must add up to the failed part. */
export interface Replacement {
  kind: "cash" | "owed" | "mobile_money";
  amount: string;
  lines?: Record<string, number>;
  paidByBranchId?: string | null;
  externalRef?: string | null;
}

const after = [paymentKeys.all, transactionKeys.all, dayKeys.all, debtKeys.all];

export function useConfirmPayment() {
  return useApiMutation<unknown, { transactionId: string; paymentId: string }>({
    mutationFn: ({ transactionId, paymentId }) =>
      request(
        {
          method: "post",
          url: `/transactions/${transactionId}/payments/${paymentId}/confirm`,
        },
        transactionSchema,
      ),
    invalidates: after,
    successMessage: "Marked as received",
  });
}

export function useFailPayment() {
  return useApiMutation<
    unknown,
    { transactionId: string; paymentId: string; replacements: Replacement[] }
  >({
    mutationFn: ({ transactionId, paymentId, replacements }) =>
      request(
        {
          method: "post",
          url: `/transactions/${transactionId}/payments/${paymentId}/fail`,
          data: {
            cashReplacements: replacements
              .filter((r) => r.kind === "cash")
              .map((r) => ({ amount: r.amount, lines: r.lines ?? {} })),
            replacements: replacements
              .filter((r) => r.kind !== "cash")
              .map((r) => ({
                method: r.kind,
                amount: r.amount,
                paidByBranchId: r.paidByBranchId ?? null,
                externalRef: r.externalRef ?? null,
              })),
          },
        },
        transactionSchema,
      ),
    invalidates: after,
    successMessage: "Marked as failed and replaced",
  });
}
