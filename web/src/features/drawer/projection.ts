import type {
  CreateTransaction,
  PayTransaction,
} from "@/features/transactions/schemas";
import type { Lines } from "@gold/core";
import type {
  CloseDayInput,
  DayState,
  ExchangeCommand,
  MovementCommand,
  OpenDayInput,
} from "./schemas";

/**
 * The drawer calculation now lives in @gold/core (core-ts/src/drawer.ts) so the screens and the branch hub use one copy of the rules.
 * This file keeps the names the screens already import, and the typed shape of what the outbox holds.
 */
import { projectDrawer as project, type DrawerView } from "@gold/core";
export { compareCount, limitsFromBalance, type DrawerView } from "@gold/core";

export type Pending =
  | { id: string; type: "drawer.movement"; payload: MovementCommand }
  | { id: string; type: "drawer.exchange"; payload: ExchangeCommand }
  | {
      id: string;
      type: "transaction.create";
      payload: Pick<CreateTransaction, "branchId"> & {
        payout: { lines: Lines };
      };
    }
  /** Cash handed over for a purchase saved in two-step mode. The server counts it under the purchase's id. */
  | {
      id: string;
      type: "transaction.pay";
      payload: Pick<PayTransaction, "transactionId" | "branchId" | "lines">;
    }
  /** A day opened or closed on this device with no connection. */
  | {
      id: string;
      type: "day.open";
      payload: Pick<
        OpenDayInput,
        "id" | "branchId" | "businessDate" | "lines" | "afterClose"
      >;
    }
  | {
      id: string;
      type: "day.close";
      payload: Pick<CloseDayInput, "dayId" | "branchId" | "declared">;
    };

/** Business date in the device's local time, "YYYY-MM-DD". */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** What this device shows: the last answer from the server plus everything still waiting in the outbox. */
export const projectDrawer = (
  state: DayState | null,
  pending: Pending[],
  branchId: string,
  twoStep = false,
): DrawerView => project(state, pending, branchId, twoStep);
