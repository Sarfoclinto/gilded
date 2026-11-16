import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { photoKeys } from "@/features/photos/api";

/** One of the person's own pictures (My pictures). Private: only its owner can ever list or open it. */
export const personalPictureSchema = z.object({
  id: z.string(),
  caption: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  size: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  takenAt: z.string(),
  createdAt: z.string(),
});
export type PersonalPicture = z.infer<typeof personalPictureSchema>;

export const personalUsageSchema = z.object({
  enabled: z.boolean(),
  count: z.number(),
  bytes: z.number(),
  maxCount: z.number(),
  maxMb: z.number(),
});
export type PersonalUsage = z.infer<typeof personalUsageSchema>;

export const personalListSchema = z.object({
  items: z.array(personalPictureSchema),
  total: z.number(),
  page: z.number(),
  size: z.number(),
  usage: personalUsageSchema,
});

export interface PersonalFilters {
  q?: string;
  page?: number;
  size?: number;
}

export const personalApi = {
  list: (f: PersonalFilters, signal?: AbortSignal) =>
    request(
      {
        method: "get",
        url: "/me/pictures",
        params: Object.fromEntries(
          Object.entries(f).filter(([, v]) => v !== undefined && v !== ""),
        ),
        signal,
      },
      personalListSchema,
    ),
  caption: (id: string, caption: string) =>
    request(
      { method: "patch", url: `/me/pictures/${id}`, data: { caption } },
      personalPictureSchema,
    ),
  remove: (ids: string[]) =>
    request(
      { method: "post", url: "/me/pictures/delete", data: { ids } },
      z.object({ deleted: z.number() }),
    ),
};

// kept under the photos keys, so a picture arriving from the queue refreshes the page without any extra wiring
export const personalKey = (f: PersonalFilters) =>
  photoKeys.custom("personal", { ...f });

export function useMyPictures(f: PersonalFilters) {
  return useApiQuery({
    queryKey: personalKey(f),
    queryFn: ({ signal }) => personalApi.list(f, signal),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useSetCaption() {
  return useApiMutation<PersonalPicture, { id: string; caption: string }>({
    mutationFn: ({ id, caption }) => personalApi.caption(id, caption),
    invalidates: [photoKeys.all],
    successMessage: "Caption saved",
  });
}

export function useDeleteMyPictures() {
  return useApiMutation<{ deleted: number }, string[]>({
    mutationFn: (ids) => personalApi.remove(ids),
    invalidates: [photoKeys.all],
    successMessage: (r) =>
      r.deleted === 1 ? "Picture deleted" : `${r.deleted} pictures deleted`,
  });
}

export const personalPictureUrl = (id: string, thumb: boolean) =>
  `/me/pictures/${id}/${thumb ? "thumb" : "file"}`;

/** "12 of 300 pictures · 5.4 of 300 MB". */
export function usageText(u: PersonalUsage): string {
  const mb = (u.bytes / 1024 / 1024).toFixed(
    u.bytes < 10 * 1024 * 1024 ? 1 : 0,
  );
  return `${u.count} of ${u.maxCount} pictures · ${mb} of ${u.maxMb} MB`;
}

/** True when the person has used most of what they may keep (a gentle warning, never a block). */
export const nearlyFull = (u: PersonalUsage) =>
  u.count >= u.maxCount * 0.9 || u.bytes >= u.maxMb * 1024 * 1024 * 0.9;
