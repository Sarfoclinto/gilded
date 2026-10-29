import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { transactionSchema, type CreateTransaction } from "./schemas";

export const transactionKeys = createKeys("transactions");

export const searchResultSchema = z.object({
  items: z.array(transactionSchema),
  total: z.number(),
  sumPayable: z.string(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const transactionsApi = {
  /** Filtered, sorted, paged purchases (see features/transactions/search.ts for the filters). */
  search: (
    params: Record<string, string | number | boolean>,
    signal?: AbortSignal,
  ) =>
    request(
      { method: "get", url: "/transactions/search", params, signal },
      searchResultSchema,
    ),
  list: (branchId: string, signal?: AbortSignal) =>
    request(
      {
        method: "get",
        url: "/transactions",
        params: { branchId, limit: 100 },
        signal,
      },
      z.array(transactionSchema),
    ),
  get: (id: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: `/transactions/${id}`, signal },
      transactionSchema,
    ),
  /** The transaction id doubles as the Idempotency-Key, so a retried send can never create a second one. */
  create: (cmd: CreateTransaction) =>
    request(
      {
        method: "post",
        url: "/transactions",
        data: cmd,
        headers: { "Idempotency-Key": cmd.id },
      },
      transactionSchema,
    ),
};
