import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import {
  transactionSchema,
  type CreateTransaction,
  type PayTransaction,
} from "./schemas";

export const transactionKeys = createKeys("transactions");

/** The purchase after cancelling, with what came back. */
export const cancelResultSchema = z.object({
  data: transactionSchema,
  entriesReversed: z.number().optional(),
  cashBack: z.string().optional(),
});
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
  /** Purchases of a branch whose cash is still to be paid out, newest first. `q` matches number, name or phone. */
  toPay: (branchId: string, q: string, signal?: AbortSignal) =>
    request(
      {
        method: "get",
        url: "/transactions/to-pay",
        params: { branchId, ...(q.trim() ? { q: q.trim() } : {}) },
        signal,
      },
      z.array(transactionSchema),
    ),
  /** Hands over the cash. The server accepts the first payment only; the same payment sent twice is one payment. */
  pay: (cmd: PayTransaction) =>
    request(
      {
        method: "post",
        url: `/transactions/${cmd.transactionId}/pay`,
        data: {
          lines: cmd.lines,
          capturedAt: cmd.capturedAt,
          checkAmount: cmd.checkAmount ?? null,
        },
      },
      transactionSchema,
    ),
  /** Cancel a wrongly saved purchase (needs transactions:cancel). The books are put back by new entries; the purchase stays, marked cancelled. */
  cancel: (id: string, reason: string) =>
    request(
      { method: "post", url: `/transactions/${id}/cancel`, data: { reason } },
      cancelResultSchema,
    ),
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
