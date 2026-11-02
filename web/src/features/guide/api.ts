import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";
import { blocksSchema, type Block } from "./blocks";

export const guideKeys = createKeys("guide");

export const articleRowSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable().optional(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  kind: z.string(),
  status: z.enum(["draft", "published"]),
  version: z.number(),
  rev: z.number(),
  mustRead: z.boolean(),
  position: z.number(),
  publishedAt: z.string().nullable().optional(),
  updatedAt: z.string(),
  read: z.boolean(),
  readAt: z.string().nullable().optional(),
  /** Admin list only: how many active people have read the current version. */
  readers: z.number().optional(),
});
export type ArticleRow = z.infer<typeof articleRowSchema>;

export const articleSchema = articleRowSchema.extend({ blocks: blocksSchema });
export type Article = z.infer<typeof articleSchema>;

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
});
export type Category = z.infer<typeof categorySchema>;

export const guideSchema = z.object({
  unread: z.number(),
  categories: z.array(categorySchema),
  articles: z.array(articleRowSchema),
});

export const remindersSchema = z.object({
  frequency: z.enum(["off", "daily", "weekly", "monthly"]),
  time: z.string(),
  weekday: z.number(),
  audience: z.enum(["unread", "everyone"]),
});
export type Reminders = z.infer<typeof remindersSchema>;

export const adminSchema = z.object({
  staff: z.number(),
  categories: z.array(categorySchema),
  articles: z.array(articleRowSchema),
  reminders: remindersSchema,
});

export const readerSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  read: z.boolean(),
  readAt: z.string().nullable().optional(),
  readVersion: z.number().nullable().optional(),
});

/** What a person sees: published articles by category. */
export function useGuide() {
  return useApiQuery({
    queryKey: guideKeys.custom("list", {}),
    queryFn: ({ signal }) =>
      request({ method: "get", url: "/guide", signal }, guideSchema),
    staleTime: 30_000,
  });
}

export function useArticle(id: string | undefined, draft = false) {
  return useApiQuery({
    queryKey: guideKeys.custom("article", { id, draft }),
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: `/guide/articles/${id}`,
          params: draft ? { draft: true } : undefined,
          signal,
        },
        articleSchema,
      ),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useMarkRead() {
  return useApiMutation<{ unread: number }, string>({
    mutationFn: (id) =>
      request(
        { method: "post", url: `/guide/articles/${id}/read` },
        z.object({ unread: z.number() }),
      ),
    invalidates: [guideKeys.all],
    silent: true,
    requiresOnline: true,
  });
}

export function useGuideAdmin() {
  return useApiQuery({
    queryKey: guideKeys.custom("admin", {}),
    queryFn: ({ signal }) =>
      request({ method: "get", url: "/guide/admin", signal }, adminSchema),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useReaders(id: string | null) {
  return useApiQuery({
    queryKey: guideKeys.custom("readers", { id }),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: `/guide/admin/articles/${id}/readers`, signal },
        z.array(readerSchema),
      ),
    enabled: !!id,
    staleTime: 0,
  });
}

export interface ArticleDraft {
  title: string;
  summary: string;
  kind: string;
  categoryId: string | null;
  mustRead: boolean;
  blocks: Block[];
  rev?: number;
}

export function useSaveArticle() {
  return useApiMutation<Article, { id: string; draft: ArticleDraft }>({
    mutationFn: ({ id, draft }) =>
      request(
        { method: "put", url: `/guide/admin/articles/${id}`, data: draft },
        articleSchema,
      ),
    invalidates: [guideKeys.all],
    requiresOnline: true,
  });
}

export function usePublish() {
  return useApiMutation<
    ArticleRow & { notified: number },
    { id: string; notify: boolean; material: boolean }
  >({
    mutationFn: ({ id, ...data }) =>
      request(
        { method: "post", url: `/guide/admin/articles/${id}/publish`, data },
        articleRowSchema.extend({ notified: z.number() }),
      ),
    invalidates: [guideKeys.all],
    requiresOnline: true,
  });
}

export function useUnpublish() {
  return useApiMutation<ArticleRow, string>({
    mutationFn: (id) =>
      request(
        { method: "post", url: `/guide/admin/articles/${id}/unpublish` },
        articleRowSchema,
      ),
    invalidates: [guideKeys.all],
    requiresOnline: true,
  });
}

export function useDeleteArticle() {
  return useApiMutation<unknown, string>({
    mutationFn: (id) =>
      request(
        { method: "delete", url: `/guide/admin/articles/${id}` },
        z.unknown(),
      ),
    invalidates: [guideKeys.all],
    requiresOnline: true,
  });
}

export function useSaveCategory() {
  return useApiMutation<
    Category,
    { id: string; name: string; position?: number }
  >({
    mutationFn: ({ id, ...data }) =>
      request(
        { method: "put", url: `/guide/admin/categories/${id}`, data },
        categorySchema,
      ),
    invalidates: [guideKeys.all],
    requiresOnline: true,
  });
}

export function useDeleteCategory() {
  return useApiMutation<unknown, string>({
    mutationFn: (id) =>
      request(
        { method: "delete", url: `/guide/admin/categories/${id}` },
        z.unknown(),
      ),
    invalidates: [guideKeys.all],
    requiresOnline: true,
  });
}

export function useSaveReminders() {
  return useApiMutation<Reminders, Reminders>({
    mutationFn: (data) =>
      request(
        { method: "put", url: "/guide/admin/reminders", data },
        remindersSchema,
      ),
    invalidates: [guideKeys.all],
    requiresOnline: true,
  });
}
