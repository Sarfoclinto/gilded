import { z } from "zod";

/** Notes by denomination, e.g. { "100": 1688 }. Can be negative in a balance (see NEGATIVE_NOTES), never in a count. */
export const linesSchema = z.record(z.string(), z.number().int());
export const countSchema = z.record(z.string(), z.number().int().positive());

export const personSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

/** The seven figures reconciled at closing. Order matters: this is the order the server returns them in. */
export const FIGURES = [
  "cash",
  "goods_top",
  "goods_down",
  "goods_value",
  "debt",
  "payable",
  "custody_top",
] as const;
export type Figure = (typeof FIGURES)[number];

export const closingFigureSchema = z.object({
  asset: z.enum(FIGURES),
  expected: z.string(),
  actual: z.string(),
  difference: z.string(),
  outcome: z.enum(["balanced", "surplus", "shortage"]),
  explanation: z.string().nullable().optional(),
  detail: z.record(z.string(), z.number()).nullable().optional(),
});
export type ClosingFigure = z.infer<typeof closingFigureSchema>;

export const signoffStatusSchema = z.enum([
  "not_required",
  "pending",
  "approved",
  "rejected",
]);

export const closingSchema = z.object({
  closedAt: z.string(),
  closedBy: personSchema,
  confirmation: z.object({ version: z.string(), text: z.string() }),
  figures: z.array(closingFigureSchema),
  cash: z.object({ expected: linesSchema, counted: linesSchema }),
  signoff: z.object({
    status: signoffStatusSchema,
    by: personSchema.nullable().optional(),
    at: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  }),
});
export type Closing = z.infer<typeof closingSchema>;

export const daySchema = z.object({
  id: z.string(),
  branchId: z.string(),
  businessDate: z.string(),
  status: z.enum(["open", "closed"]),
  opening: z.object({
    lines: linesSchema,
    source: z.enum(["counted", "carried"]),
  }),
  openedAt: z.string(),
  openedBy: personSchema,
  closing: closingSchema.nullable(),
  flags: z.array(z.string()),
});
export type Day = z.infer<typeof daySchema>;

export const movementSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  kind: z.enum(["topup", "withdrawal", "allowance", "exchange"]),
  lines: linesSchema,
  note: z.string(),
  capturedAt: z.string(),
  createdBy: personSchema,
  transactionId: z.string().nullable().optional(),
  /** Only for kind 'exchange': the notes the customer gave back and the notes handed out. */
  exchange: z.object({ gave: linesSchema, took: linesSchema }).optional(),
});
export type Movement = z.infer<typeof movementSchema>;

/** GET /days/current. `balance` already includes everything the server knows; `appliedIds` says which commands those are. */
export const dayStateSchema = z.object({
  day: daySchema.nullable(),
  balance: linesSchema.nullable(),
  movements: z.array(movementSchema),
  appliedIds: z.array(z.string()),
  /** What the books say the drawer holds now (null before the very first day). Offered as the next opening count. */
  carryOver: linesSchema.nullable(),
  /** This branch has the note-by-note rule off: only the total money in the drawer is enforced, and counts at opening/closing match on the total. */
  looseDenominations: z.boolean().optional(),
  /** What the books hold besides cash. Kept on the device so a closing can be worked out with no connection. */
  books: z
    .object({
      goodsTop: z.string(),
      goodsDown: z.string(),
      goodsValue: z.string(),
      debt: z.string(),
      payable: z.string(),
      custodyTop: z.string(),
    })
    .optional(),
  asOf: z.string(),
});
export type DayState = z.infer<typeof dayStateSchema>;

/** GET /days/{id}/closing-preview: what the books say the branch holds, and the wording to accept. */
export const closingPreviewSchema = z.object({
  dayId: z.string(),
  branchId: z.string(),
  expected: z.object({
    cash: z.object({ lines: linesSchema, value: z.string() }),
    goodsTop: z.string(),
    goodsDown: z.string(),
    goodsValue: z.string(),
    debt: z.string(),
    payable: z.string(),
    custodyTop: z.string(),
  }),
  pendingPayments: z.number(),
  confirmation: z.object({ version: z.string(), text: z.string() }),
  asOf: z.string(),
});
export type ClosingPreview = z.infer<typeof closingPreviewSchema>;

/** The figures a device showed the person while they counted with no connection, so the server knows what they compared against. */
export interface CountBasis {
  cash: Record<string, number>;
  goodsTop?: string;
  goodsDown?: string;
  goodsValue?: string;
  debt?: string;
  payable?: string;
  custodyTop?: string;
  /** When the device last heard the books from the server. */
  asOf?: string;
}

/** Opening a day. Sent straight away when there is a connection; with none it is queued and the day opens on the device first. */
export interface OpenDayInput {
  id: string;
  branchId: string;
  businessDate: string;
  lines: Record<string, number>;
  source: "counted" | "carried";
  capturedAt: string;
  explanation?: string | null;
  /** A customer came after the day was closed: a second session on the same date, with the reason in `explanation`. */
  afterClose?: boolean;
  basis?: CountBasis;
}

export interface CloseDayInput {
  id: string;
  dayId: string;
  branchId: string;
  declared: {
    cash: Record<string, number>;
    goodsTop: string;
    goodsDown: string;
    goodsValue: string;
    debt: string;
    payable: string;
    custodyTop: string;
  };
  explanations: Partial<Record<Figure, string>>;
  /** `text`: the wording the person ticked, sent with a closing made with no connection. */
  confirmation: { accepted: boolean; version: string; text?: string };
  capturedAt: string;
  basis?: CountBasis;
}

/** Cash in or out of the drawer. Safe to queue: it never needs an answer to continue. */
export const movementCommandSchema = z
  .object({
    id: z.string(),
    dayId: z.string(),
    branchId: z.string(),
    kind: z.enum(["topup", "withdrawal", "allowance"]),
    lines: countSchema,
    note: z.string().trim().max(200),
    /** Office allowance only: how many people it is paid for. */
    people: z.number().int().min(1).max(200).optional(),
    capturedAt: z.string(),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "allowance") {
      if (!c.people)
        ctx.addIssue({
          code: "custom",
          path: ["people"],
          message: "Say how many people the allowance is for",
        });
    } else if (c.note.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Say what this is for",
      });
    }
  });
export type MovementCommand = z.infer<typeof movementCommandSchema>;

/** Notes changed for a customer who was already paid. Safe to queue, like any drawer movement. */
export const exchangeCommandSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  branchId: z.string(),
  transactionId: z.string().optional(),
  gave: countSchema,
  took: countSchema,
  note: z.string().trim().max(200).optional(),
  capturedAt: z.string(),
});
export type ExchangeCommand = z.infer<typeof exchangeCommandSchema>;

export const OUTBOX = {
  MOVEMENT: "drawer.movement",
  EXCHANGE: "drawer.exchange",
  PAY: "transaction.pay",
  DAY_OPEN: "day.open",
  DAY_CLOSE: "day.close",
} as const;

/** GET /days/{id}/activity: one day's own movements, apart from the running totals. */
export const dayActivitySchema = z.object({
  dayId: z.string(),
  businessDate: z.string(),
  status: z.string(),
  cash: z.object({
    opening: linesSchema,
    in: linesSchema,
    out: linesSchema,
    net: linesSchema,
    netValue: z.string(),
  }),
  goods: z.object({ top: z.string(), down: z.string(), value: z.string() }),
  debts: z.object({
    net: z.string(),
    debtors: z.array(
      z.object({
        customerId: z.string().nullable().optional(),
        name: z.string(),
        issued: z.string(),
        repaid: z.string(),
        net: z.string(),
      }),
    ),
  }),
  payable: z.string(),
});
export type DayActivity = z.infer<typeof dayActivitySchema>;
