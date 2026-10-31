import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const accountKeys = createKeys("accounts");

const num = z.coerce.number();
const denomRow = z.object({
  denomination: z.number(),
  count: z.number(),
  value: num,
});

export const closedAccountSchema = z.object({
  branchId: z.string(),
  name: z.string(),
  isMain: z.boolean(),
  businessDate: z.string(),
  status: z.literal("closed"),
  day: z.object({
    id: z.string(),
    openedAt: z.string(),
    closedAt: z.string(),
    closedBy: z
      .object({ id: z.string(), displayName: z.string() })
      .nullable()
      .optional(),
    signoff: z.enum(["not_required", "pending", "approved", "rejected"]),
    sessions: z.number(),
  }),
  debtors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      amount: num,
      change: num.nullable(),
      isNew: z.boolean(),
      branch: z.string().optional(),
    }),
  ),
  debtTotal: num,
  debtUnlisted: num,
  cash: z.object({
    bundles: z.array(denomRow),
    bundlesTotal: num,
    loose: z.array(denomRow),
    looseTotal: num,
    total: num,
  }),
  goods: z.object({
    total: num,
    days: z.array(z.object({ date: z.string(), value: num })),
    broughtForward: num,
    lastSentOn: z.string().nullable(),
    sent: z.array(
      z.object({
        reference: z.string(),
        date: z.string(),
        value: num,
        to: z.string().nullable(),
      }),
    ),
  }),
  owedToCustomers: num,
  allowance: z.object({ paid: num, people: z.number() }),
  closing: num,
  previous: z.object({ date: z.string(), closing: num }).nullable(),
  change: num.nullable(),
});
export type ClosedAccount = z.infer<typeof closedAccountSchema>;

const notClosedSchema = z.object({
  branchId: z.string(),
  name: z.string(),
  isMain: z.boolean(),
  businessDate: z.string(),
  status: z.enum(["open", "none"]),
});
export type NotClosed = z.infer<typeof notClosedSchema>;

export const dailyAccountsSchema = z.object({
  date: z.string(),
  branches: z.array(
    z.discriminatedUnion("status", [closedAccountSchema, notClosedSchema]),
  ),
});
export type DailyAccounts = z.infer<typeof dailyAccountsSchema>;

/** Every branch the caller may see for one date. The page picks one, or adds them together. */
export function useDailyAccounts(date: string) {
  return useApiQuery({
    queryKey: accountKeys.list({ date }),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/accounts/daily", params: { date }, signal },
        dailyAccountsSchema,
      ),
  });
}
