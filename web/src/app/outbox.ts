import type { QueryClient } from "@tanstack/react-query";
import { transactionKeys, transactionsApi } from "@/features/transactions/api";
import { dayKeys, daysApi } from "@/features/drawer/api";
import {
  OUTBOX,
  type ExchangeCommand,
  type MovementCommand,
} from "@/features/drawer/schemas";
import { debtKeys, collateralKeys } from "@/features/debts/api";
import { paymentKeys } from "@/features/payments/api";
import type { CreateTransaction } from "@/features/transactions/schemas";
import type { Handler } from "@/shared/offline/outbox";
import type { OutboxEntry } from "@/shared/offline/outboxStore";

/** What each queued command does when it is finally sent. Only commands that never need an answer to continue are queued. */
export const TX_CREATE = "transaction.create";

export const outboxHandlers: Record<string, Handler> = {
  [TX_CREATE]: ((payload: CreateTransaction) =>
    transactionsApi.create(payload)) as Handler,
  [OUTBOX.MOVEMENT]: ((payload: MovementCommand) =>
    daysApi.movement(payload)) as Handler,
  [OUTBOX.EXCHANGE]: ((payload: ExchangeCommand) =>
    daysApi.exchange(payload)) as Handler,
};

/** After the server confirms a command, refresh what the screens show. */
export const makeOnSynced = (qc: QueryClient) => (entry: OutboxEntry) => {
  if (entry.type === TX_CREATE) {
    // A purchase can move the drawer, open debts, settle one, release held gold and create mobile money parts.
    for (const key of [
      transactionKeys.all,
      dayKeys.all,
      debtKeys.all,
      collateralKeys.all,
      paymentKeys.all,
    ])
      void qc.invalidateQueries({ queryKey: key });
  } else if (entry.type === OUTBOX.MOVEMENT || entry.type === OUTBOX.EXCHANGE) {
    void qc.invalidateQueries({ queryKey: dayKeys.all });
  }
};
