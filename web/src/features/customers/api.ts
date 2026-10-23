import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiQuery } from "@/shared/api/hooks";

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
