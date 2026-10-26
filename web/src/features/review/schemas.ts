import { z } from "zod";

const person = z
  .object({ id: z.string(), displayName: z.string() })
  .nullable()
  .optional();
const num = z.string().nullable().optional();

export const CASE_STATUSES = [
  "open",
  "under_review",
  "resolved",
  "written_off",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const RESOLUTION_TYPES = [
  "explained",
  "found",
  "recovered",
  "corrected_entry",
  "written_off",
] as const;

export const caseSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchName: z.string().nullable().optional(),
  kind: z.string(),
  asset: z.string().nullable().optional(),
  status: z.enum(CASE_STATUSES),
  expected: num,
  actual: num,
  difference: num,
  reportedExplanation: z.string().nullable().optional(),
  businessDate: z.string().nullable().optional(),
  dayId: z.string().nullable().optional(),
  transferId: z.string().nullable().optional(),
  transferReference: z.string().nullable().optional(),
  openedAt: z.string(),
  openedBy: person,
  assignedTo: person,
  resolvedAt: z.string().nullable().optional(),
  resolvedBy: person,
  resolutionType: z.string().nullable().optional(),
  resolutionSummary: z.string().nullable().optional(),
});
export type Case = z.infer<typeof caseSchema>;

export const caseDetailSchema = caseSchema.extend({
  actions: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      fromStatus: z.string().nullable().optional(),
      toStatus: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      by: person,
      at: z.string(),
    }),
  ),
});
export type CaseDetail = z.infer<typeof caseDetailSchema>;

export const timelineEntrySchema = z.object({
  seq: z.number(),
  occurredAt: z.string(),
  recordedAt: z.string(),
  recordedBy: person,
  dayId: z.string().nullable().optional(),
  asset: z.string(),
  denomination: z.number().nullable().optional(),
  deltaCount: z.number().nullable().optional(),
  deltaTop: num,
  deltaDown: num,
  deltaValue: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  memo: z.string().nullable().optional(),
  running: z.object({
    cash: z.string(),
    goodsTop: z.string(),
    goodsDown: z.string(),
    goodsValue: z.string(),
    debt: z.string(),
    payable: z.string(),
  }),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
export const timelineSchema = z.object({
  entries: z.array(timelineEntrySchema),
  nextBefore: z.number().nullable(),
});

export const positionRowSchema = z.object({
  senderBranchId: z.string(),
  senderName: z.string().nullable().optional(),
  receiverBranchId: z.string(),
  receiverName: z.string().nullable().optional(),
  cashSent: z.string(),
  mobileMoneyPaidOnBehalf: z.string(),
  goodsValueSent: z.string(),
  mobileMoneyFailedCoveredByCash: z.string(),
});
export type PositionRow = z.infer<typeof positionRowSchema>;
