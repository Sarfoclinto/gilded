import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";

export const searchKeys = createKeys("search");

const text = z.string();
const maybe = z.string().nullable().optional();

export const customerHit = z.object({
  id: text,
  name: text,
  phone: maybe,
  score: z.number(),
  close: z.boolean().optional(),
  purchases: z.number(),
  lastPurchaseAt: maybe,
  lastAmount: maybe,
  /** Only present for people who may see debts. */
  owes: maybe,
});
export const purchaseHit = z.object({
  id: text,
  reference: text,
  customerId: maybe,
  customerName: text,
  customerPhone: maybe,
  amount: text,
  status: text,
  capturedAt: text,
  branch: text,
  flagged: z.boolean().optional(),
  score: z.number().optional(),
  top: maybe,
  down: maybe,
  karat: maybe,
  items: z.number().optional(),
});
export const debtHit = z.object({
  id: text,
  name: text,
  customerId: maybe,
  direction: text,
  status: text,
  reason: maybe,
  principal: text,
  outstanding: text,
  issuedAt: text,
  dueDate: maybe,
  branch: text,
});
export const heldHit = z.object({
  id: text,
  customerId: maybe,
  name: text,
  phone: maybe,
  topWeight: text,
  status: text,
  description: maybe,
  receivedAt: text,
  branch: text,
});
export const transferHit = z.object({
  id: text,
  reference: text,
  kind: text,
  status: text,
  from: text,
  to: text,
  collector: maybe,
  cash: maybe,
  createdAt: text,
});
export const paymentHit = z.object({
  id: text,
  transactionId: text,
  reference: text,
  customerName: text,
  amount: text,
  status: text,
  externalRef: maybe,
  createdAt: text,
});
export const userHit = z.object({
  id: text,
  name: text,
  username: text,
  role: maybe,
  active: z.boolean(),
});
export const branchHit = z.object({
  id: text,
  name: text,
  code: text,
  active: z.boolean(),
  main: z.boolean().optional(),
});
export const guideHit = z.object({
  id: text,
  title: text,
  summary: maybe,
  kind: maybe,
});

const group = <K extends string, S extends z.ZodType>(key: K, item: S) =>
  z.object({ key: z.literal(key), total: z.number(), items: z.array(item) });

export const searchGroupSchema = z.discriminatedUnion("key", [
  group("customers", customerHit),
  group("purchases", purchaseHit),
  group("debts", debtHit),
  group("held", heldHit),
  group("transfers", transferHit),
  group("payments", paymentHit),
  group("users", userHit),
  group("branches", branchHit),
  group("guide", guideHit),
]);
export type SearchGroup = z.infer<typeof searchGroupSchema>;
export type GroupKey = SearchGroup["key"];

export const searchResultSchema = z.object({
  q: z.string(),
  groups: z.array(searchGroupSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchApi = {
  /** One question across everything the person may see. `group` asks for more of one group. */
  search: (
    q: string,
    opts: { group?: GroupKey; limit?: number } = {},
    signal?: AbortSignal,
  ) =>
    request(
      {
        method: "get",
        url: "/search",
        params: {
          q,
          ...(opts.group ? { group: opts.group } : {}),
          ...(opts.limit ? { limit: opts.limit } : {}),
        },
        signal,
      },
      searchResultSchema,
    ),
};
