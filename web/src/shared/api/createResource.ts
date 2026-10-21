import { z } from 'zod';
import { request, requestVoid } from './client';
import { createKeys } from './queryKeys';
import { useApiMutation, useApiQuery } from './hooks';

interface ResourceConfig<TItem> {
  /** Used for query keys and messages, e.g. "branches". */
  name: string;
  /** REST path, e.g. "/branches". */
  path: string;
  itemSchema: z.ZodType<TItem>;
  /** Singular noun for toasts, e.g. "Branch". */
  label: string;
}

/**
 * CRUD helper: one call gives a feature its typed API functions, query keys and React Query hooks.
 * Features that need something unusual add their own functions next to the generated ones; they do not
 * fight this helper.
 *
 *   export const branches = createResource({ name: 'branches', path: '/branches', itemSchema: branchSchema, label: 'Branch' });
 *   const { data } = branches.useList();
 */
export function createResource<TItem extends { id: string }>(cfg: ResourceConfig<TItem>) {
  const keys = createKeys(cfg.name);
  const listSchema = z.array(cfg.itemSchema);

  const api = {
    list: (params?: Record<string, unknown>) => request({ method: 'get', url: cfg.path, params }, listSchema),
    get: (id: string) => request({ method: 'get', url: `${cfg.path}/${id}` }, cfg.itemSchema),
    create: <TBody>(body: TBody, idempotencyKey?: string) =>
      request(
        {
          method: 'post',
          url: cfg.path,
          data: body,
          headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
        },
        cfg.itemSchema,
      ),
    update: <TBody>(id: string, body: TBody) =>
      request({ method: 'put', url: `${cfg.path}/${id}`, data: body }, cfg.itemSchema),
    remove: (id: string) => requestVoid({ method: 'delete', url: `${cfg.path}/${id}` }),
  };

  return {
    keys,
    api,
    useList: (params?: Record<string, unknown>) =>
      useApiQuery({ queryKey: keys.list(params), queryFn: () => api.list(params) }),
    useDetail: (id: string | undefined) =>
      useApiQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => api.get(id as string), enabled: !!id }),
    useCreate: <TBody>() =>
      useApiMutation<TItem, TBody>({
        mutationFn: (body) => api.create(body, crypto.randomUUID()),
        invalidates: [keys.lists()],
        successMessage: `${cfg.label} created`,
      }),
    useUpdate: <TBody>() =>
      useApiMutation<TItem, { id: string; body: TBody }>({
        mutationFn: ({ id, body }) => api.update(id, body),
        invalidates: [keys.all],
        successMessage: `${cfg.label} saved`,
      }),
    useRemove: () =>
      useApiMutation<void, string>({
        mutationFn: (id) => api.remove(id),
        invalidates: [keys.all],
        successMessage: `${cfg.label} deleted`,
      }),
  };
}
