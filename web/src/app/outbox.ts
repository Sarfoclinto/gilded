import type { QueryClient } from '@tanstack/react-query';
import { transactionKeys, transactionsApi } from '@/features/transactions/api';
import type { CreateTransaction } from '@/features/transactions/schemas';
import type { Handler } from '@/shared/offline/outbox';
import type { OutboxEntry } from '@/shared/offline/outboxStore';

/** What each queued command does when it is finally sent. */
export const TX_CREATE = 'transaction.create';

export const outboxHandlers: Record<string, Handler> = {
  [TX_CREATE]: ((payload: CreateTransaction) => transactionsApi.create(payload)) as Handler,
};

/** After the server confirms a command, refresh what the screens show. */
export const makeOnSynced = (qc: QueryClient) => (entry: OutboxEntry, result: unknown) => {
  if (entry.type === TX_CREATE) {
    void qc.invalidateQueries({ queryKey: transactionKeys.all });
    void result;
  }
};
