import { useMemo } from 'react';
import { useApiQuery } from '@/shared/api/hooks';
import { useOutbox } from '@/shared/offline/OutboxProvider';
import { TX_CREATE } from '@/app/outbox';
import { transactionKeys, transactionsApi } from './api';
import { fromOutbox, fromServer, type TransactionView } from './view';

/** Saved transactions for a branch plus anything still waiting on this device, newest first. */
export function useTransactionList(branchId: string | null) {
  const { entries } = useOutbox();
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
      .map(fromOutbox)
      .filter((t) => t.branchId === branchId);
    return [...local.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)), ...server];
  }, [query.data, entries, branchId]);

  return { rows, query };
}

/** One transaction: from the server when it is there, from this device while it is still waiting. */
export function useTransactionView(id: string | undefined) {
  const { entries } = useOutbox();
  const local = entries.find((e) => e.id === id && e.type === TX_CREATE);
  const query = useApiQuery({
    queryKey: transactionKeys.detail(id ?? ''),
    queryFn: ({ signal }) => transactionsApi.get(id as string, signal),
    enabled: !!id && !local,
    retry: false,
  });
  const view: TransactionView | null = local ? fromOutbox(local) : query.data ? fromServer(query.data) : null;
  return { view, isLoading: !local && query.isLoading, error: local ? null : query.error };
}
