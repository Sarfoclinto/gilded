import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const cashKeys = createKeys("cash");

const branchCashSchema = z.object({
  branchId: z.string(),
  name: z.string(),
  isMain: z.boolean(),
  cashValue: z.coerce.string(),
  lines: z.record(z.string(), z.number()),
  day: z.enum(["open", "closed", "none"]),
  dayDate: z.string().nullable().optional(),
  lastEntryAt: z.string().nullable().optional(),
});
export type BranchCash = z.infer<typeof branchCashSchema>;

export const cashOverviewSchema = z.object({
  asOf: z.string(),
  branches: z.array(branchCashSchema),
});
export type CashOverview = z.infer<typeof cashOverviewSchema>;

/** The books' cash for the branches the caller may see (or one of them). Always asks again when the panel is opened. */
export function useCashOverview(branchId: string | null, enabled = true) {
  return useApiQuery({
    queryKey: cashKeys.list({ branchId }),
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: "/cash/overview",
          params: branchId ? { branchId } : {},
          signal,
        },
        cashOverviewSchema,
      ),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
