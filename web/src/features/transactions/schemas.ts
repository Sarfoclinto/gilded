import { z } from 'zod';

export const payoutPolicySchema = z.enum(['down', 'up', 'nearest']);
export const strategySchema = z.enum(['fewest-notes', 'prefer-100s']);
export const noteLinesSchema = z.record(z.string(), z.number().int().positive());

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

export const payoutInputSchema = z.object({
  policy: payoutPolicySchema,
  strategy: strategySchema,
  payable: z.string(),
  lines: noteLinesSchema,
});

export const payoutSchema = payoutInputSchema.extend({
  difference: z.string(),
  totalNotes: z.number().int(),
});

/** What the device sends. Also what the offline outbox stores, so it must survive JSON round trips. */
export const createTransactionSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  customerName: z.string().trim().min(1, 'Enter the customer name').max(120),
  customerPhone: z.string().max(32).nullable().optional(),
  items: z.array(itemInputSchema).min(1).max(20),
  clientAmount: z.string(),
  payout: payoutInputSchema,
  capturedAt: z.string(),
  priceAsOf: z.string(),
});
export type CreateTransaction = z.infer<typeof createTransactionSchema>;

export const flagSchema = z.enum(['OFFLINE_ENTRY', 'CALC_MISMATCH', 'PRICE_STALE']);
export type TransactionFlag = z.infer<typeof flagSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  reference: z.string(),
  customerName: z.string(),
  customerPhone: z.string().nullable().optional(),
  status: z.enum(['saved', 'paid', 'void']),
  items: z.array(itemSchema),
  formulaVersion: z.string(),
  calculatedAmount: z.string(),
  payout: payoutSchema,
  capturedAt: z.string(),
  createdAt: z.string(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }),
  flags: z.array(flagSchema),
});
export type Transaction = z.infer<typeof transactionSchema>;
