import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import type { WorkingDoc } from "@gold/core";

export const workingKeys = createKeys("workings");

const noteSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  text: z.string(),
});
export const docSchema = z.object({
  notes: z.array(noteSchema),
  view: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});

/** One sheet as the server lists it (no contents). */
export const sheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  notes: z.number(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SheetMeta = z.infer<typeof sheetSchema>;
export const sheetFullSchema = sheetSchema.extend({ doc: docSchema });
export type SheetFull = z.infer<typeof sheetFullSchema>;

export const usageSchema = z.object({
  enabled: z.boolean(),
  count: z.number(),
  maxCount: z.number(),
  maxKb: z.number(),
});
export const listSchema = z.object({
  items: z.array(sheetSchema),
  usage: usageSchema,
});
export const saveResultSchema = z.object({
  data: sheetSchema.extend({ doc: docSchema.optional() }),
  copy: sheetSchema.nullable(),
});
export type SaveResult = z.infer<typeof saveResultSchema>;

export const workingsApi = {
  list: (q: string | undefined, signal?: AbortSignal) =>
    request(
      { method: "get", url: "/me/workings", params: q ? { q } : {}, signal },
      listSchema,
    ),
  get: (id: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: `/me/workings/${id}`, signal },
      sheetFullSchema,
    ),
  save: (
    id: string,
    body: { name: string; doc: WorkingDoc; baseVersion: number | null },
  ) =>
    request(
      { method: "put", url: `/me/workings/${id}`, data: body },
      saveResultSchema,
    ),
  rename: (id: string, name: string) =>
    request(
      { method: "patch", url: `/me/workings/${id}`, data: { name } },
      sheetSchema,
    ),
  remove: (ids: string[]) =>
    request(
      { method: "post", url: "/me/workings/delete", data: { ids } },
      z.object({ deleted: z.number() }),
    ),
};

export function useSheets(q?: string) {
  return useApiQuery({
    queryKey: workingKeys.custom("list", { q: q ?? "" }),
    queryFn: ({ signal }) => workingsApi.list(q, signal),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

export function useRenameSheet() {
  return useApiMutation<SheetMeta, { id: string; name: string }>({
    mutationFn: ({ id, name }) => workingsApi.rename(id, name),
    invalidates: [workingKeys.all],
    successMessage: "Renamed",
  });
}

export function useDeleteSheets() {
  return useApiMutation<{ deleted: number }, string[]>({
    mutationFn: (ids) => workingsApi.remove(ids),
    invalidates: [workingKeys.all],
    successMessage: (r) =>
      r.deleted === 1 ? "Sheet deleted" : `${r.deleted} sheets deleted`,
  });
}
