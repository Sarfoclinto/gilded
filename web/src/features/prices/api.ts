import { z } from "zod";
import { useQueries } from "@tanstack/react-query";
import { request, requestVoid } from "@/shared/api/client";
import { isApiError, type ApiError } from "@/shared/api/errors";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";

export const currentPriceSchema = z.object({
  branchId: z.string(),
  basePrice: z.string(),
  margin: z.string(),
  effectivePrice: z.string(),
  source: z.enum(["goldbod", "manual"]),
  status: z.enum(["approved", "provisional"]),
  asOf: z.string(),
});
export type CurrentPrice = z.infer<typeof currentPriceSchema>;

export const priceKeys = {
  all: ["prices"] as const,
  current: (branchId: string) => ["prices", "current", branchId] as const,
};

const fetchPrice = (branchId: string, signal?: AbortSignal) =>
  request(
    { method: "get", url: "/prices/current", params: { branchId }, signal },
    currentPriceSchema,
  );

/** The price in force for a branch. A branch with no price yet answers 404 PRICE_NOT_SET: `data` stays empty and `notSet` is true. */
export function useCurrentPrice(branchId: string | null) {
  const query = useApiQuery({
    queryKey: priceKeys.current(branchId ?? ""),
    queryFn: ({ signal }) => fetchPrice(branchId as string, signal),
    enabled: !!branchId,
    staleTime: 60_000,
  });
  return Object.assign(query, { notSet: isPriceNotSet(query.error) });
}

export const isPriceNotSet = (e: ApiError | null | undefined) =>
  !!e && isApiError(e) && e.code === "PRICE_NOT_SET";

/** Prices for several branches at once (the prices screen). A missing price is `null`, not an error. */
export function useBranchPrices(branchIds: string[]) {
  return useQueries({
    queries: branchIds.map((id) => ({
      queryKey: priceKeys.current(id),
      queryFn: async ({
        signal,
      }: {
        signal: AbortSignal;
      }): Promise<CurrentPrice | null> => {
        try {
          return await fetchPrice(id, signal);
        } catch (e) {
          if (isPriceNotSet(e as ApiError)) return null;
          throw e;
        }
      },
      staleTime: 0,
    })),
  });
}

export function useSetBasePrice() {
  return useApiMutation<void, string>({
    mutationFn: (basePrice) =>
      requestVoid({ method: "post", url: "/prices/base", data: { basePrice } }),
    invalidates: [priceKeys.all],
    successMessage: "New reference price published",
  });
}

export function useSetMargin() {
  return useApiMutation<
    CurrentPrice,
    { branchId: string; margin: string; approve: boolean }
  >({
    mutationFn: ({ branchId, margin, approve }) =>
      request(
        {
          method: "put",
          url: `/prices/margins/${branchId}`,
          data: { margin, approve },
        },
        currentPriceSchema,
      ),
    invalidates: [priceKeys.all],
    successMessage: (_d, v) =>
      v.approve
        ? "Margin saved and approved"
        : "Margin saved, waiting for approval",
  });
}

export function useApproveMargin() {
  return useApiMutation<CurrentPrice, string>({
    mutationFn: (branchId) =>
      request(
        { method: "post", url: `/prices/margins/${branchId}/approve` },
        currentPriceSchema,
      ),
    invalidates: [priceKeys.all],
    successMessage: "Margin approved",
  });
}
