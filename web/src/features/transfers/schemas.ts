import { z } from "zod";
import { personSchema } from "@/features/drawer/schemas";

const text = z.string().nullable().optional();
const notes = z.record(z.string(), z.number());

export const transferStatusSchema = z.enum([
  "draft",
  "released",
  "received",
  "received_with_discrepancy",
  "cancelled",
]);
export type TransferStatus = z.infer<typeof transferStatusSchema>;

export const transferRowSchema = z.object({
  id: z.string(),
  reference: z.string(),
  kind: z.enum(["goods", "cash"]),
  status: transferStatusSchema,
  originBranchId: z.string(),
  originBranchName: z.string(),
  destinationBranchId: z.string(),
  destinationBranchName: z.string(),
  purpose: z.string(),
  method: z.string(),
  collectorName: text,
  lineCount: z.number(),
  declaredValue: text,
  receivedValue: text,
  hasDiscrepancy: z.boolean(),
  releasedAt: text,
  receivedAt: text,
  createdAt: z.string(),
});
export type TransferRow = z.infer<typeof transferRowSchema>;

export const transferableItemSchema = z.object({
  itemId: z.string(),
  transactionId: z.string(),
  reference: z.string(),
  customerName: z.string(),
  label: z.string(),
  top: z.string(),
  down: z.string(),
  value: z.string(),
  purchasedAt: z.string(),
});
export type TransferableItem = z.infer<typeof transferableItemSchema>;

export const staffSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

const collectorSchema = z.object({
  type: z.enum(["staff", "external"]),
  userId: text,
  name: text,
  phone: text,
  idType: text,
  idNumber: text,
  relationship: text,
  collectedAt: text,
});

const lineSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  itemId: text,
  description: z.string(),
  reference: text,
  customerName: text,
  releasedTop: z.string(),
  releasedDown: z.string(),
  releasedValue: z.string(),
  receivedTop: text,
  receivedDown: text,
  receivedValue: text,
  outcome: z.enum(["pending", "matched", "differs", "missing"]),
});
export type TransferLine = z.infer<typeof lineSchema>;

const totalsSchema = z.object({
  top: text,
  down: text,
  value: text,
  cash: text,
  cashLines: notes.optional(),
});

export const transferSchema = z.object({
  id: z.string(),
  reference: z.string(),
  kind: z.enum(["goods", "cash"]),
  status: transferStatusSchema,
  originBranchId: z.string(),
  originBranchName: z.string(),
  destinationBranchId: z.string(),
  destinationBranchName: z.string(),
  purpose: z.string(),
  purposeNote: text,
  method: z.string(),
  collector: collectorSchema.nullable().optional(),
  expectedArrivalAt: text,
  release: z
    .object({
      by: personSchema.nullable().optional(),
      at: z.string(),
      note: text,
    })
    .nullable()
    .optional(),
  declared: totalsSchema.nullable().optional(),
  receipt: totalsSchema
    .extend({
      by: personSchema.nullable().optional(),
      at: z.string(),
      note: text,
    })
    .nullable()
    .optional(),
  cancellation: z
    .object({
      by: personSchema.nullable().optional(),
      at: z.string(),
      reason: z.string(),
    })
    .nullable()
    .optional(),
  lines: z.array(lineSchema),
  payments: z.array(
    z.object({
      id: z.string(),
      direction: z.enum(["paid_to_collector", "received_from_collector"]),
      amount: z.string(),
      method: z.string(),
      purpose: z.string(),
      externalRef: text,
      paidAt: z.string(),
      recordedBy: personSchema.nullable().optional(),
      note: text,
      lines: notes.optional(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      by: personSchema.nullable().optional(),
      at: z.string(),
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  discrepancies: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      asset: text,
      lineId: text,
      expected: text,
      actual: text,
      difference: text,
      explanation: text,
    }),
  ),
  createdBy: personSchema.nullable().optional(),
  createdAt: z.string(),
});
export type Transfer = z.infer<typeof transferSchema>;

export interface CollectorInput {
  type: "staff" | "external";
  userId?: string;
  name?: string;
  phone?: string;
  idType?: string;
  idNumber?: string;
  relationship?: string;
}

export interface ReceiveLineInput {
  lineId: string;
  outcome: "matched" | "differs" | "missing";
  top?: string;
  down?: string;
  note?: string;
}
