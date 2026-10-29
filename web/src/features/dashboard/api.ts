import { keepPreviousData } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";

const day = z.object({
  date: z.string(),
  count: z.number(),
  paid: z.string(),
  pounds: z.string(),
});
const branch = z.object({
  branchId: z.string(),
  name: z.string(),
  todayCount: z.number(),
  todayPaid: z.string(),
  periodCount: z.number(),
  periodPaid: z.string(),
  flagged: z.number(),
  voided: z.number(),
  day: z.enum(["open", "closed", "none"]),
  signoffPending: z.number(),
  goldOnHand: z.string(),
});

export const dashboardSchema = z.object({
  asOf: z.string(),
  days: z.number(),
  // pounds arrives as a JSON number from the database (every other figure is a string), so accept either.
  today: z.object({
    count: z.number(),
    paid: z.string(),
    voided: z.number(),
    flagged: z.number(),
    pounds: z.coerce.string(),
  }),
  yesterday: z.object({ count: z.number(), paid: z.string() }),
  series: z.array(day),
  branches: z.array(branch),
  /** Absent for people without reports:read. */
  tellers: z
    .array(
      z.object({
        userId: z.string(),
        name: z.string(),
        count: z.number(),
        paid: z.string(),
        flagged: z.number(),
      }),
    )
    .optional(),
  payments: z.object({
    cash: z.string(),
    mobileMoney: z.string(),
    owed: z.string(),
  }),
  pendingMoney: z.number(),
  signoffPending: z.number(),
  stock: z.object({ onHand: z.string(), inTransit: z.string() }),
  transfers: z.object({ onTheRoad: z.number(), value: z.string() }),
  debts: z.object({
    owedToUs: z.string(),
    count: z.number(),
    overdue: z.number(),
  }),
  topCustomers: z
    .array(
      z.object({
        customerId: z.string(),
        name: z.string(),
        count: z.number(),
        paid: z.string(),
      }),
    )
    .optional(),
  flags: z.record(z.string(), z.number()),
  cashDifferences: z
    .object({
      days: z.number(),
      net: z.string(),
      recent: z.array(
        z.object({
          branch: z.string(),
          date: z.string(),
          difference: z.string(),
        }),
      ),
    })
    .optional(),
  mine: z.object({
    todayCount: z.number(),
    todayPaid: z.string(),
    periodCount: z.number(),
    recent: z
      .array(
        z.object({
          reference: z.string(),
          customerName: z.string(),
          payable: z.string(),
          capturedAt: z.string(),
          status: z.string(),
        }),
      )
      .default([]),
  }),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardBranch = z.infer<typeof branch>;

/** `branchId` null means every branch the person may see. Refreshes every minute while the screen is open. */
export function useDashboard(branchId: string | null, days: number) {
  return useApiQuery({
    queryKey: ["dashboard", branchId ?? "all", days],
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: "/dashboard",
          params: { ...(branchId ? { branchId } : {}), days },
          signal,
        },
        dashboardSchema,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
