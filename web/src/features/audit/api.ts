import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";

export const auditKeys = createKeys("audit");

const person = z
  .object({ id: z.string(), displayName: z.string() })
  .nullable()
  .optional();
export const auditEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  actor: person,
  branch: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  category: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  summary: z.string(),
  amount: z.string().nullable().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditPageSchema = z.object({
  asOf: z.string(),
  total: z.number(),
  page: z.number(),
  size: z.number(),
  items: z.array(auditEventSchema),
  categories: z.record(z.string(), z.number()),
  actors: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable().optional(),
      count: z.number(),
    }),
  ),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

export type AuditQuery = {
  q?: string;
  category?: string;
  action?: string;
  actorId?: string;
  branchId?: string;
  from?: string;
  to?: string;
  minAmount?: string;
  sort?: string;
  page?: number;
  size?: number;
};

export function useAudit(query: AuditQuery) {
  const params = Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );
  return useApiQuery({
    queryKey: auditKeys.list(params),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/audit", params, signal },
        auditPageSchema,
      ),
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}
