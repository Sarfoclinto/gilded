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
const personSchema = z.object({ id: z.string(), displayName: z.string() });
export const sheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  notes: z.number(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Colleagues this sheet is shared with right now (owner's view only). */
  sharedWith: z.array(personSchema).optional(),
});
export type SheetMeta = z.infer<typeof sheetSchema>;
/** A sheet with its contents. `mine` false means it was shared with the caller: read only. */
export const sheetFullSchema = sheetSchema.extend({
  doc: docSchema,
  mine: z.boolean().optional(),
  owner: personSchema.optional(),
});
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
  sharedCount: z.number().optional(),
});
export const sharedSheetSchema = sheetSchema.extend({
  sharedBy: personSchema,
  sharedAt: z.string(),
});
export type SharedSheet = z.infer<typeof sharedSheetSchema>;
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
  shared: (signal?: AbortSignal) =>
    request(
      { method: "get", url: "/me/workings/shared", signal },
      z.object({ items: z.array(sharedSheetSchema) }),
    ),
  share: (id: string, to: string) =>
    request(
      { method: "post", url: `/me/workings/${id}/share`, data: { to } },
      z.object({ shared: z.boolean() }),
    ),
  unshare: (id: string, to?: string) =>
    request(
      {
        method: "post",
        url: `/me/workings/${id}/unshare`,
        data: { to: to ?? null },
      },
      z.object({ stopped: z.number() }),
    ),
  hide: (id: string) =>
    request(
      { method: "post", url: `/me/workings/${id}/hide`, data: {} },
      z.object({ hidden: z.number() }),
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

export function useSharedSheets(enabled = true) {
  return useApiQuery({
    queryKey: workingKeys.custom("shared", {}),
    queryFn: ({ signal }) => workingsApi.shared(signal),
    enabled,
    staleTime: 10_000,
  });
}

/** The sharing state of one of the person's own sheets (who it is shared with), straight from the server. */
export function useSheetShares(id: string, enabled: boolean) {
  return useApiQuery({
    queryKey: workingKeys.custom("shares", { id }),
    queryFn: ({ signal }) =>
      workingsApi.get(id, signal).then((s) => s.sharedWith ?? []),
    enabled,
    staleTime: 0,
  });
}

export function useShareSheet() {
  return useApiMutation<
    { shared: boolean },
    { id: string; to: string; name: string }
  >({
    mutationFn: ({ id, to }) => workingsApi.share(id, to),
    invalidates: [workingKeys.all],
    successMessage: (r, v) =>
      r.shared ? `Shared with ${v.name}` : `Already shared with ${v.name}`,
  });
}

export function useUnshareSheet() {
  return useApiMutation<{ stopped: number }, { id: string; to?: string }>({
    mutationFn: ({ id, to }) => workingsApi.unshare(id, to),
    invalidates: [workingKeys.all],
    successMessage: "Stopped sharing",
  });
}

export function useHideSharedSheet() {
  return useApiMutation<{ hidden: number }, string>({
    mutationFn: (id) => workingsApi.hide(id),
    invalidates: [workingKeys.all],
    successMessage: "Removed from your list",
  });
}
