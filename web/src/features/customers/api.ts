import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";
import { collateralSchema, debtSchema } from "@/features/debts/schemas";

export const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable().optional(),
});
export type Customer = z.infer<typeof customerSchema>;

export const customerKeys = {
  search: (q: string) => ["customers", "search", q] as const,
};

/** Find existing customers by name or phone. Needs a connection; the forms still work without it (a new customer is created on save). */
export function useCustomerSearch(q: string) {
  const text = q.trim();
  return useApiQuery({
    queryKey: customerKeys.search(text),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: "/customers", params: { q: text }, signal },
        z.array(customerSchema),
      ),
    enabled: text.length >= 2,
    staleTime: 15_000,
    retry: false,
  });
}

// ---------------------------------------------------------------- the customers screens
export const customerRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  purchases: z.number(),
  lastPurchaseAt: z.string().nullable().optional(),
  owesUs: z.string(),
  weOwe: z.string(),
});
export type CustomerRow = z.infer<typeof customerRowSchema>;

export const customerDetailSchema = customerRowSchema.extend({
  transactions: z.array(
    z.object({
      id: z.string(),
      reference: z.string(),
      branchId: z.string(),
      branchName: z.string(),
      payable: z.string(),
      capturedAt: z.string(),
      customerName: z.string(),
    }),
  ),
  debts: z.array(debtSchema),
  held: z.array(collateralSchema),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

const pageSchema = z.object({
  total: z.number(),
  items: z.array(customerRowSchema),
});

export const customerAdminKeys = createKeys("customer-admin");

export function useCustomerPage(q: string, page: number, pageSize: number) {
  const text = q.trim();
  return useApiQuery({
    queryKey: customerAdminKeys.list({ q: text, page, pageSize }),
    queryFn: ({ signal }) =>
      request(
        {
          method: "get",
          url: "/customers/list",
          params: {
            q: text || undefined,
            limit: pageSize,
            offset: (page - 1) * pageSize,
          },
          signal,
        },
        pageSchema,
      ),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useCustomerDetail(id: string | undefined) {
  return useApiQuery({
    queryKey: customerAdminKeys.detail(id ?? ""),
    queryFn: ({ signal }) =>
      request(
        { method: "get", url: `/customers/${id}`, signal },
        customerDetailSchema,
      ),
    enabled: !!id,
    staleTime: 0,
  });
}

const refresh = [customerAdminKeys.all, ["customers"]];

export function useCreateCustomer() {
  return useApiMutation<
    CustomerDetail,
    { id: string; name: string; phone: string; notes?: string | null }
  >({
    mutationFn: (cmd) =>
      request(
        {
          method: "post",
          url: "/customers",
          data: cmd,
          headers: { "Idempotency-Key": cmd.id },
        },
        customerDetailSchema,
      ),
    invalidates: refresh,
    silent: true,
    successMessage: "Customer added",
  });
}

export function useUpdateCustomer() {
  return useApiMutation<
    CustomerDetail,
    {
      id: string;
      changes: { name?: string; phone?: string; notes?: string | null };
    }
  >({
    mutationFn: ({ id, changes }) =>
      request(
        { method: "patch", url: `/customers/${id}`, data: changes },
        customerDetailSchema,
      ),
    invalidates: refresh,
    silent: true,
    successMessage: "Saved",
  });
}

export function useMergeCustomers() {
  return useApiMutation<CustomerDetail, { keepId: string; removeId: string }>({
    mutationFn: ({ keepId, removeId }) =>
      request(
        {
          method: "post",
          url: `/customers/${keepId}/merge`,
          data: { removeId },
        },
        customerDetailSchema,
      ),
    invalidates: [...refresh, ["debts"], ["collateral"], ["transactions"]],
    silent: true,
    successMessage: "Customers merged",
  });
}
