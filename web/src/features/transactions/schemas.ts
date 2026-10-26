import { z } from "zod";

export const payoutPolicySchema = z.enum(["down", "up", "nearest"]);
export const strategySchema = z.enum(["fewest-notes", "prefer-100s"]);
export const noteLinesSchema = z.record(
  z.string(),
  z.number().int().positive(),
);

export const itemInputSchema = z.object({
  id: z.string(),
  label: z.string().max(80).nullable().optional(),
  top: z.string(),
  down: z.string(),
  price: z.string(),
});
export type ItemInput = z.infer<typeof itemInputSchema>;

export const itemResultSchema = z.object({
  density: z.string(),
  karat: z.string(),
  purity: z.string(),
  netWeight: z.string(),
  pounds: z.string(),
  amount: z.string(),
});

export const itemSchema = itemInputSchema.extend({ result: itemResultSchema });

/** A part of the payment that is not cash. The cash part is whatever is left of `payable`, handed over as `lines`. */
export const splitMethodSchema = z.enum([
  "mobile_money",
  "owed",
  "debt_offset",
]);
export type SplitMethod = z.infer<typeof splitMethodSchema>;

export const splitPartSchema = z.object({
  method: splitMethodSchema,
  amount: z.string(),
  paidByBranchId: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  debtId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export type SplitPart = z.infer<typeof splitPartSchema>;

export const payoutInputSchema = z.object({
  policy: payoutPolicySchema,
  strategy: strategySchema,
  payable: z.string(),
  /** The cash part only. Empty when nothing is paid in cash. */
  lines: noteLinesSchema,
  split: z.array(splitPartSchema).optional(),
});

export const payoutSchema = z.object({
  policy: z.string(),
  strategy: z.string(),
  payable: z.string(),
  lines: z.record(z.string(), z.number()),
  difference: z.string(),
  totalNotes: z.number(),
});

/** What the device sends. Also what the offline outbox stores, so it must survive JSON round trips. */
export const createTransactionSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  customerName: z.string().trim().min(1, "Enter the customer name").max(120),
  customerPhone: z.string().max(32).nullable().optional(),
  customerId: z.string().nullable().optional(),
  representative: z
    .object({
      name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  collateralId: z.string().nullable().optional(),
  items: z.array(itemInputSchema).min(1).max(20),
  clientAmount: z.string(),
  payout: payoutInputSchema,
  capturedAt: z.string(),
  priceAsOf: z.string(),
});
export type CreateTransaction = z.infer<typeof createTransactionSchema>;

export const flagSchema = z.string();
export type TransactionFlag = string;

export const paymentSchema = z.object({
  id: z.string(),
  method: z.string(),
  amount: z.string(),
  status: z.string(),
  paidByBranchId: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  debtId: z.string().nullable().optional(),
  confirmedAt: z.string().nullable().optional(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  reference: z.string(),
  customerId: z.string().nullable().optional(),
  representative: z
    .object({
      name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  customerName: z.string(),
  customerPhone: z.string().nullable().optional(),
  status: z.string(),
  items: z.array(itemSchema),
  formulaVersion: z.string(),
  calculatedAmount: z.string(),
  payout: payoutSchema,
  payments: z.array(paymentSchema).default([]),
  capturedAt: z.string(),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
  flags: z.array(flagSchema),
});
export type Transaction = z.infer<typeof transactionSchema>;
