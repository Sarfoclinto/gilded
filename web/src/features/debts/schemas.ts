import { z } from "zod";
import { countSchema, personSchema } from "@/features/drawer/schemas";

export const collateralBriefSchema = z.object({
  id: z.string(),
  topWeight: z.string(),
  status: z.enum(["held", "converted", "returned"]),
  description: z.string().nullable().optional(),
});

export const repaymentSchema = z.object({
  id: z.string(),
  amount: z.string(),
  method: z.string(),
  receivedAt: z.string(),
  receivedBy: personSchema.nullable().optional(),
  paidByBranchId: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
  transactionId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const debtSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  direction: z.enum(["receivable", "payable"]),
  party: z.object({
    type: z.string(),
    name: z.string(),
    customerId: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }),
  principal: z.string(),
  repaid: z.string(),
  outstanding: z.string(),
  reason: z.string().nullable().optional(),
  issuedAt: z.string(),
  dueDate: z.string().nullable().optional(),
  status: z.string(),
  sourceTransactionId: z.string().nullable().optional(),
  collateral: collateralBriefSchema.nullable().optional(),
  repayments: z.array(repaymentSchema),
});
export type Debt = z.infer<typeof debtSchema>;

/** One branch's debts at a glance, counted by the server over all debts (the list itself may be a page). */
export const debtSummarySchema = z.object({
  receivable: z.object({
    open: z.number(),
    total: z.string(),
    overdue: z.number(),
    held: z.number(),
  }),
  payable: z.object({
    open: z.number(),
    total: z.string(),
    overdue: z.number(),
  }),
  allCount: z.number(),
});
export type DebtSummary = z.infer<typeof debtSummarySchema>;

export const customerDebtsSchema = z.object({
  items: z.array(debtSchema.extend({ branchName: z.string().optional() })),
  total: z.string(),
  elsewhere: z.number(),
});

export const collateralSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  debtId: z.string(),
  status: z.enum(["held", "converted", "returned"]),
  topWeight: z.string(),
  description: z.string().nullable().optional(),
  receivedAt: z.string(),
  receivedBy: personSchema.nullable().optional(),
  customer: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string().nullable().optional(),
  }),
  debtOutstanding: z.string().nullable().optional(),
  convertedTransactionId: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  closeNote: z.string().nullable().optional(),
  photos: z.number().nullable().optional(),
});
export type Collateral = z.infer<typeof collateralSchema>;

export interface LoanInput {
  id: string;
  branchId: string;
  partyType: "customer" | "staff" | "other";
  customer: { id?: string | null; name: string; phone?: string | null };
  principal: string;
  lines: z.infer<typeof countSchema>;
  reason?: string | null;
  dueDate?: string | null;
  collateral?: { topWeight: string; description?: string | null } | null;
  capturedAt: string;
}

export interface RepaymentInput {
  id: string;
  amount: string;
  method: "cash" | "mobile_money";
  lines?: z.infer<typeof countSchema>;
  paidByBranchId?: string | null;
  externalRef?: string | null;
  note?: string | null;
  capturedAt: string;
}
