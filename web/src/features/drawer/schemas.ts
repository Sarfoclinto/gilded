import { z } from 'zod';

/** Notes by denomination, e.g. { "100": 1688 }. Can be negative in a balance (see NEGATIVE_NOTES), never in a count. */
export const linesSchema = z.record(z.string(), z.number().int());
export const countSchema = z.record(z.string(), z.number().int().positive());

const personSchema = z.object({ id: z.string(), displayName: z.string() });

export const daySchema = z.object({
  id: z.string(),
  branchId: z.string(),
  businessDate: z.string(),
  status: z.enum(['open', 'closed']),
  opening: z.object({ lines: countSchema, source: z.enum(['counted', 'carried']) }),
  openedAt: z.string(),
  openedBy: personSchema,
  closing: z
    .object({
      expected: linesSchema,
      counted: countSchema,
      variance: linesSchema,
      varianceAmount: z.string(),
      reason: z.string().nullable(),
      closedAt: z.string(),
      closedBy: personSchema,
      signoff: z.object({
        status: z.enum(['not_required', 'pending', 'signed']),
        by: personSchema.nullable().optional(),
        at: z.string().nullable().optional(),
      }),
    })
    .nullable(),
  flags: z.array(z.enum(['OFFLINE_ENTRY', 'OPENING_DIFFERS'])),
});
export type Day = z.infer<typeof daySchema>;

export const movementSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  kind: z.enum(['topup', 'withdrawal']),
  lines: countSchema,
  note: z.string(),
  capturedAt: z.string(),
  createdBy: personSchema,
});
export type Movement = z.infer<typeof movementSchema>;

/** GET /days/current. `balance` already includes everything the server knows; `appliedIds` says which commands those are. */
export const dayStateSchema = z.object({
  day: daySchema.nullable(),
  balance: linesSchema.nullable(),
  movements: z.array(movementSchema),
  appliedIds: z.array(z.string()),
  /** What the last closed day ended with, offered as the next opening count. */
  carryOver: countSchema.nullable(),
  asOf: z.string(),
});
export type DayState = z.infer<typeof dayStateSchema>;

/** Commands the device queues. They must survive a JSON round trip. */
export const openDaySchema = z.object({
  id: z.string(),
  branchId: z.string(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: countSchema,
  source: z.enum(['counted', 'carried']),
  capturedAt: z.string(),
});
export type OpenDay = z.infer<typeof openDaySchema>;

export const closeDaySchema = z.object({
  id: z.string(),
  dayId: z.string(),
  branchId: z.string(),
  counted: countSchema,
  reason: z.string().max(500).nullable(),
  capturedAt: z.string(),
});
export type CloseDay = z.infer<typeof closeDaySchema>;

export const movementCommandSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  branchId: z.string(),
  kind: z.enum(['topup', 'withdrawal']),
  lines: countSchema,
  note: z.string().trim().min(1, 'Say what this is for').max(200),
  capturedAt: z.string(),
});
export type MovementCommand = z.infer<typeof movementCommandSchema>;

export const OUTBOX = {
  OPEN: 'day.open',
  CLOSE: 'day.close',
  MOVEMENT: 'drawer.movement',
} as const;
