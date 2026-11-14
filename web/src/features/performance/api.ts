import { keepPreviousData } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";

const figures = z.object({
  count: z.number(),
  paid: z.string(),
  pounds: z.string(),
  top: z.string(),
});
const point = figures.extend({ date: z.string() });
export const performanceBranchSchema = z.object({
  branchId: z.string(),
  name: z.string(),
  code: z.string(),
  points: z.array(point),
  total: figures,
  /** The same length of time just before this period. */
  previous: figures,
  best: z.object({ date: z.string(), paid: z.string() }).nullable(),
});
export const performanceSchema = z.object({
  asOf: z.string(),
  days: z.number(),
  grain: z.enum(["day", "week", "month"]),
  from: z.string(),
  to: z.string(),
  buckets: z.array(z.string()),
  branches: z.array(performanceBranchSchema),
});
export type Performance = z.infer<typeof performanceSchema>;
export type PerformanceBranch = z.infer<typeof performanceBranchSchema>;
export type PerformancePoint = z.infer<typeof point>;
export type Figures = z.infer<typeof figures>;

/** Every branch the person may see, over `days`. Branches are hidden on the device, never re-fetched, so each keeps its colour. */
export function useBranchPerformance(days: number, enabled = true) {
  return useApiQuery({
    queryKey: ["dashboard", "performance", days],
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: "/dashboard/performance",
          params: { days },
          signal,
        },
        performanceSchema,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
    enabled,
  });
}
