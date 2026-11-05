import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const syncKeys = createKeys("sync");

/** What the server says about one command sent through POST /sync/commands. */
export const commandResultSchema = z.object({
  id: z.string().nullable().optional(),
  status: z.enum(["applied", "held", "rejected", "refused", "dismissed"]),
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  flags: z.array(z.string()).optional(),
  replayed: z.boolean().optional(),
});
export type CommandResult = z.infer<typeof commandResultSchema>;

const reviewItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["held", "rejected"]),
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  flags: z.array(z.string()).default([]),
  capturedAt: z.string().nullable().optional(),
  receivedAt: z.string(),
  deviceId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  branchName: z.string().nullable().optional(),
  by: z.object({ id: z.string(), name: z.string() }),
  payload: z.record(z.string(), z.unknown()),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const reviewSchema = z.object({
  held: z.number(),
  rejected: z.number(),
  items: z.array(reviewItemSchema),
  recent: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      message: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
      resolvedAt: z.string().nullable().optional(),
      by: z.object({ id: z.string(), name: z.string() }),
    }),
  ),
});
export type Review = z.infer<typeof reviewSchema>;

export interface SyncEnvelope {
  id: string;
  type: string;
  userId: string;
  deviceId: string;
  capturedAt: string;
  payloadJson: string;
  signature: string;
}

export const syncApi = {
  registerDevice: (deviceId: string, publicKey: string) =>
    request(
      { method: "post", url: "/sync/devices", data: { deviceId, publicKey } },
      z.unknown(),
    ),
  submit: (commands: SyncEnvelope[]) =>
    request(
      { method: "post", url: "/sync/commands", data: { commands } },
      z.object({ results: z.array(commandResultSchema) }),
    ),
  review: (signal?: AbortSignal) =>
    request({ method: "get", url: "/sync/review", signal }, reviewSchema),
  resolve: (id: string, action: "retry" | "dismiss", note?: string) =>
    request(
      { method: "post", url: `/sync/review/${id}`, data: { action, note } },
      z.object({
        id: z.string(),
        status: z.string(),
        message: z.string().nullable().optional(),
      }),
    ),
};

export const useSyncReview = () =>
  useApiQuery({
    queryKey: syncKeys.list({}),
    queryFn: ({ signal }) => syncApi.review(signal),
    staleTime: 0,
  });

export const useResolveSync = () =>
  useApiMutation({
    mutationFn: (v: {
      id: string;
      action: "retry" | "dismiss";
      note?: string;
    }) => syncApi.resolve(v.id, v.action, v.note),
    invalidates: [syncKeys.all],
    silent: false,
  });
