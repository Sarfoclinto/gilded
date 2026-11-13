import type { QueryClient } from "@tanstack/react-query";
import { transactionKeys, transactionsApi } from "@/features/transactions/api";
import { dayKeys, daysApi } from "@/features/drawer/api";
import {
  OUTBOX,
  type CloseDayInput,
  type ExchangeCommand,
  type MovementCommand,
  type OpenDayInput,
} from "@/features/drawer/schemas";
import { debtKeys, collateralKeys } from "@/features/debts/api";
import { paymentKeys } from "@/features/payments/api";
import type {
  CreateTransaction,
  PayTransaction,
} from "@/features/transactions/schemas";
import { reviewNotice, viaSync, viaSyncOnly } from "@/features/sync/send";
import { syncKeys } from "@/features/sync/api";
import { toast } from "@/shared/ui/toast";
import { noteSynced } from "@/shared/offline/hubSync";
import type { Handler } from "@/shared/offline/outbox";
import type { OutboxEntry } from "@/shared/offline/outboxStore";

/** What each queued command does when it is finally sent. Only commands that never need an answer to continue are queued. */
export const TX_CREATE = "transaction.create";

export const outboxHandlers: Record<string, Handler> = {
  [TX_CREATE]: viaSync(((payload: CreateTransaction) =>
    transactionsApi.create(payload)) as Handler),
  [OUTBOX.MOVEMENT]: viaSync(((payload: MovementCommand) =>
    daysApi.movement(payload)) as Handler),
  [OUTBOX.EXCHANGE]: viaSync(((payload: ExchangeCommand) =>
    daysApi.exchange(payload)) as Handler),
  [OUTBOX.PAY]: viaSync(((payload: PayTransaction) =>
    transactionsApi.pay(payload)) as Handler),
  // A day opened or closed with no connection: the count is a fact, so it goes through sync, where it is never refused for a missing reason.
  [OUTBOX.DAY_OPEN]: viaSyncOnly(((payload: OpenDayInput) =>
    daysApi.open(payload)) as Handler),
  [OUTBOX.DAY_CLOSE]: viaSyncOnly(((payload: CloseDayInput) =>
    daysApi.close(payload)) as Handler),
};

/** After the server confirms a command, refresh what the screens show. */
export const makeOnSynced =
  (qc: QueryClient) => (entry: OutboxEntry, result?: unknown) => {
    const notice = reviewNotice(result);
    // The server has it (unless it was only kept for review): the branch hub may stop counting it once it has a server answer that includes it.
    if (!notice) noteSynced(entry.id);
    if (notice) {
      toast.error(notice);
      void qc.invalidateQueries({ queryKey: syncKeys.all });
    }
    if (entry.type === TX_CREATE || entry.type === OUTBOX.PAY) {
      // A purchase can move the drawer, open debts, settle one, release held gold and create mobile money parts.
      for (const key of [
        transactionKeys.all,
        dayKeys.all,
        debtKeys.all,
        collateralKeys.all,
        paymentKeys.all,
      ])
        void qc.invalidateQueries({ queryKey: key });
    } else if (
      entry.type === OUTBOX.MOVEMENT ||
      entry.type === OUTBOX.EXCHANGE ||
      entry.type === OUTBOX.DAY_OPEN ||
      entry.type === OUTBOX.DAY_CLOSE
    ) {
      void qc.invalidateQueries({ queryKey: dayKeys.all });
    }
  };
