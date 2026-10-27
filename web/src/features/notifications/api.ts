import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const notificationKeys = createKeys("notifications");

export const notificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  createdAt: z.string(),
  read: z.boolean(),
});
export type AppNotification = z.infer<typeof notificationSchema>;

export const inboxSchema = z.object({
  unread: z.number(),
  items: z.array(notificationSchema),
});
export type Inbox = z.infer<typeof inboxSchema>;

export function useNotifications(enabled = true) {
  return useApiQuery({
    queryKey: notificationKeys.custom("inbox", {}),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/notifications", params: { limit: 30 }, signal },
        inboxSchema,
      ),
    enabled,
    staleTime: 60_000,
  });
}

export function useMarkRead() {
  return useApiMutation<Inbox, { ids: string[] } | { all: true }>({
    mutationFn: (data) =>
      request(
        { method: "post", url: "/notifications/read", data },
        inboxSchema,
      ),
    invalidates: [notificationKeys.all],
    silent: true,
    requiresOnline: true,
  });
}
