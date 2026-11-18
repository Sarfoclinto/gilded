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

/** GoldBod's own world price (LBMA, US dollars per troy ounce) and dollar rate, from the last price read off its page. */
export const goldbodWorldSchema = z.object({
  usdPerOunce: z.string().nullable(),
  rate: z.string().nullable().optional(),
  publishedAt: z.string().nullable(),
});
export type GoldbodWorld = z.infer<typeof goldbodWorldSchema>;

export const priceHistorySchema = z.object({
  branchId: z.string(),
  days: z.number(),
  from: z.string(),
  asOf: z.string(),
  points: z.array(pricePointSchema),
  daily: z.array(dailyBoughtSchema),
  /** Null until GoldBod has been read once (B73; missing from an older server). */
  goldbod: goldbodWorldSchema.nullable().optional(),
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

export const worldPriceSchema = z.object({
  available: z.boolean(),
  usdPerOunce: z.string().optional(),
  /** When the source last updated the price. */
  at: z.string().optional(),
  source: z.string().optional(),
  /** True when the source could not be reached just now and this is its last good price (up to 30 minutes old). */
  stale: z.boolean().optional(),
  checkedAt: z.string(),
  message: z.string().optional(),
});
export type WorldPrice = z.infer<typeof worldPriceSchema>;

/**
 * The live world gold price (USD per ounce), from an outside source through our server, which asks it at most once a minute.
 * Not kept on the device: an old "live" price would mislead, so offline there is simply none.
 */
export function useWorldPrice(enabled: boolean) {
  return useApiQuery({
    queryKey: ["market", "world-price"] as const,
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/market/world-price", signal },
        worldPriceSchema,
      ),
    enabled,
    staleTime: 55_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
