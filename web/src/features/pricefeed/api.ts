import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const feedKeys = createKeys("price-feed");

const windowSchema = z.object({
  start: z.string(),
  end: z.string(),
  everyMinutes: z.number(),
});
export type FeedWindow = z.infer<typeof windowSchema>;

const eventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum(["applied", "held", "failed"]),
  state: z.enum(["done", "pending", "accepted", "dismissed"]),
  message: z.string(),
  basePrice: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  usdPerOunce: z.string().nullable().optional(),
  rate: z.string().nullable().optional(),
  computed: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  decidedBy: z.object({ displayName: z.string() }).nullable().optional(),
});
export type FeedEvent = z.infer<typeof eventSchema>;

export const feedSchema = z.object({
  enabled: z.boolean(),
  windows: z.array(windowSchema),
  weekdays: z.array(z.number()),
  timezone: z.string(),
  marginPolicy: z.enum(["approve", "carry"]),
  maxJumpPct: z.string(),
  updatedBy: z.object({ displayName: z.string() }).nullable().optional(),
  lastCheckedAt: z.string().nullable().optional(),
  lastResult: z.string().nullable().optional(),
  latest: z
    .object({
      basePrice: z.string(),
      publishedAt: z.string(),
      source: z.string(),
    })
    .nullable()
    .optional(),
  events: z.array(eventSchema),
});
export type Feed = z.infer<typeof feedSchema>;

export interface FeedSettings {
  enabled: boolean;
  windows: FeedWindow[];
  weekdays: number[];
  timezone: string;
  marginPolicy: "approve" | "carry";
  maxJumpPct: number;
}

export const previewSchema = z.object({
  found: z.boolean(),
  message: z.string(),
  price: z
    .object({
      ghsPerPound: z.number(),
      usdPerOunce: z.number().nullable().optional(),
      rate: z.number().nullable().optional(),
      discountPct: z.number().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      expected: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  excerpt: z.string().nullable().optional(),
});
export type Preview = z.infer<typeof previewSchema>;

export const usePriceFeed = () =>
  useApiQuery({
    queryKey: feedKeys.list({}),
    queryFn: ({ signal }) =>
      request({ method: "get", url: "/price-feed", signal }, feedSchema),
    staleTime: 0,
  });

// The base price shown elsewhere changes too, so everything that reads prices is refreshed.
const after = [feedKeys.all, ["prices"]];

export function useSaveFeed() {
  return useApiMutation<Feed, FeedSettings>({
    mutationFn: (data) =>
      request({ method: "put", url: "/price-feed", data }, feedSchema),
    invalidates: after,
    successMessage: "Saved",
  });
}

export const usePreviewFeed = () =>
  useApiMutation<Preview, void>({
    mutationFn: () =>
      request({ method: "post", url: "/price-feed/preview" }, previewSchema),
  });

export const useCheckNow = () =>
  useApiMutation<{ result?: string }, void>({
    mutationFn: () =>
      request(
        { method: "post", url: "/price-feed/check" },
        z.object({ result: z.string().optional() }).loose(),
      ),
    invalidates: after,
    successMessage: (d) =>
      (
        ({
          applied: "New price is now in use",
          unchanged: "Nothing new: the price is already up to date",
          held: "Found a big change: a director must confirm it",
          failed: "Could not read the price. See the message below.",
        }) as Record<string, string>
      )[d.result ?? ""] ?? "Checked",
  });

export function useDecideHeld() {
  return useApiMutation<Feed, { id: string; accept: boolean }>({
    mutationFn: ({ id, accept }) =>
      request(
        {
          method: "post",
          url: `/price-feed/events/${id}/${accept ? "accept" : "dismiss"}`,
        },
        feedSchema,
      ),
    invalidates: after,
    successMessage: (_, v) =>
      v.accept ? "The price is now in use" : "Dismissed",
  });
}
