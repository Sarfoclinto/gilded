import { z } from "zod";
import { keepPreviousData } from "@tanstack/react-query";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";

export const pricePointSchema = z.object({
  at: z.string(),
  /** The published reference price (GoldBod, or typed in by hand). */
  base: z.string(),
  margin: z.string(),
  /** What the branch pays per pound: base + margin. */
  price: z.string(),
  source: z.string(),
  status: z.string(),
});
export type PricePoint = z.infer<typeof pricePointSchema>;

export const dailyBoughtSchema = z.object({
  date: z.string(),
  purchases: z.number(),
  top: z.string(),
  amount: z.string(),
  /** Average price per pound on that day's purchases, weighted by weight. */
  avgPrice: z.string().nullable().optional(),
});
export type DailyBought = z.infer<typeof dailyBoughtSchema>;

export const priceHistorySchema = z.object({
  branchId: z.string(),
  days: z.number(),
  from: z.string(),
  asOf: z.string(),
  points: z.array(pricePointSchema),
  daily: z.array(dailyBoughtSchema),
});
export type PriceHistory = z.infer<typeof priceHistorySchema>;

/**
 * The branch's price over time. Kept on the device like the current price (the key starts with "prices"),
 * so the chart still shows with no connection, as old as the last time it was loaded.
 */
export function usePriceHistory(branchId: string | null, days: number) {
  return useApiQuery({
    queryKey: ["prices", "history", branchId ?? "", days] as const,
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: "/prices/history",
          params: { branchId, days },
          signal,
        },
        priceHistorySchema,
      ),
    enabled: !!branchId,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
