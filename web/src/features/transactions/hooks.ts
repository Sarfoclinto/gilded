import { useMemo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/api/hooks";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { TX_CREATE } from "@/app/outbox";
import { OUTBOX } from "@/features/drawer/schemas";
import { transactionKeys, transactionsApi } from "./api";
import type { PayTransaction } from "./schemas";
import { useSettings } from "@/features/settings/api";
import { fromOutbox, fromServer, type TransactionView } from "./view";

/** Saved transactions for a branch plus anything still waiting on this device, newest first. */
export function useTransactionList(branchId: string | null) {
  const { entries } = useOutbox();
  const twoStep = useSettings()["payout.twoStep"];
  const query = useApiQuery({
    queryKey: transactionKeys.list({ branchId }),
    queryFn: ({ signal }) => transactionsApi.list(branchId as string, signal),
    enabled: !!branchId,
  });

  const rows = useMemo<TransactionView[]>(() => {
    const server = (query.data ?? []).map(fromServer);
    const known = new Set(server.map((t) => t.id));
    const local = entries
      .filter((e) => e.type === TX_CREATE && !known.has(e.id))
      .map((e) => fromOutbox(e, twoStep))
      .filter((t) => t.branchId === branchId);
    return [
      ...local.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
      ...server,
    ];
  }, [query.data, entries, branchId, twoStep]);

  return { rows, query };
}

/** One transaction: from the server when it is there, from this device while it is still waiting. */
export function useTransactionView(id: string | undefined) {
  const { entries } = useOutbox();
  const twoStep = useSettings()["payout.twoStep"];
  const local = entries.find((e) => e.id === id && e.type === TX_CREATE);
  const query = useApiQuery({
    queryKey: transactionKeys.detail(id ?? ""),
    queryFn: ({ signal }) => transactionsApi.get(id as string, signal),
    enabled: !!id && !local,
    retry: false,
  });
  const view: TransactionView | null = local
    ? fromOutbox(local, twoStep)
    : query.data
      ? fromServer(query.data)
      : null;
  return {
    view,
    isLoading: !local && query.isLoading,
    error: local ? null : query.error,
  };
}

/** One page of purchases for the current filters. The previous page stays on screen while the next one loads. */
export function useTransactionSearch(
  query: Record<string, string | number | boolean> | null,
) {
  return useApiQuery({
    queryKey: transactionKeys.custom("search", query ?? {}),
    queryFn: ({ signal }) =>
      transactionsApi.search(
        query as Record<string, string | number | boolean>,
        signal,
      ),
    enabled: !!query,
    placeholderData: keepPreviousData,
  });
}

/** What this device has queued to hand over cash, by purchase id. */
export function usePayQueue() {
  const { entries } = useOutbox();
  return useMemo(
    () =>
      new Map(
        entries
          .filter((e) => e.type === OUTBOX.PAY)
          .map((e) => [(e.payload as PayTransaction).transactionId, e]),
      ),
    [entries],
  );
}

/**
 * Purchases waiting to be paid out at a branch, newest first: the server's list (live, so a purchase saved at the next desk shows up
 * within a moment) plus any saved on this device that have not reached the server yet. A purchase this device has already queued a payout
 * for is left off. Search matches the number, name or phone.
 */
export function useToPay(branchId: string | null, search: string) {
  const { entries } = useOutbox();
  const twoStep = useSettings()["payout.twoStep"];
  const queue = usePayQueue();
  const query = useApiQuery({
    queryKey: transactionKeys.custom("to-pay", {
      branchId,
      search: search.trim(),
    }),
    queryFn: ({ signal }) =>
      transactionsApi.toPay(branchId as string, search, signal),
    enabled: !!branchId,
    staleTime: 0,
    refetchOnMount: "always",
    placeholderData: keepPreviousData,
    // A second desk may save a purchase while this screen is open and the live signal may be missed: ask again now and then.
    refetchInterval: 30_000,
  });
  const rows = useMemo<TransactionView[]>(() => {
    const server = (query.data ?? [])
      .map(fromServer)
      .filter((t) => !queue.has(t.id));
    const known = new Set((query.data ?? []).map((t) => t.id));
    const needle = search.trim().toLowerCase();
    const local = entries
      .filter(
        (e) => e.type === TX_CREATE && !known.has(e.id) && !queue.has(e.id),
      )
      .map((e) => fromOutbox(e, twoStep))
      .filter((t) => t.branchId === branchId && t.payout.stage === "to_pay")
      .filter(
        (t) =>
          !needle ||
          t.customerName.toLowerCase().includes(needle) ||
          (t.customerPhone ?? "").includes(needle),
      );
    return [
      ...local.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
      ...server,
    ];
  }, [query.data, entries, queue, search, branchId, twoStep]);
  return { rows, query };
}
