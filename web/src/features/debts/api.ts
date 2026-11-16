import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { dayKeys } from "@/features/drawer/api";
import {
  collateralSchema,
  debtSchema,
  customerDebtsSchema,
  type Debt,
  type LoanInput,
  type RepaymentInput,
} from "./schemas";

export const debtKeys = createKeys("debts");
export const collateralKeys = createKeys("collateral");

export const debtsApi = {
  list: (
    params: {
      branchId: string;
      direction?: string;
      openOnly?: boolean;
      customerId?: string;
    },
    signal?: AbortSignal,
  ) =>
    request(
      { method: "get", url: "/debts", params, signal },
      z.array(debtSchema),
    ),
  ofCustomer: (customerId: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: `/customers/${customerId}/debts`, signal },
      customerDebtsSchema,
    ),
  loan: (cmd: LoanInput) =>
    request(
      {
        method: "post",
        url: "/debts/loans",
        data: cmd,
        headers: { "Idempotency-Key": cmd.id },
      },
      debtSchema,
    ),
  repay: (debtId: string, cmd: RepaymentInput) =>
    request(
      {
        method: "post",
        url: `/debts/${debtId}/repayments`,
        data: cmd,
        headers: { "Idempotency-Key": cmd.id },
      },
      debtSchema,
    ),
  collateral: (
    params: { branchId: string; status?: string },
    signal?: AbortSignal,
  ) =>
    request(
      { method: "get", url: "/collateral", params, signal },
      z.array(collateralSchema),
    ),
  returnCollateral: (id: string, note: string | null) =>
    request(
      { method: "post", url: `/collateral/${id}/return`, data: { note } },
      collateralSchema,
    ),
};

/** Open amounts one customer owes across every branch the person can see (not just the active one). */
export function useCustomerDebts(customerId: string | null | undefined) {
  return useApiQuery({
    queryKey: debtKeys.custom("of-customer", { customerId }),
    queryFn: ({ signal }) => debtsApi.ofCustomer(customerId as string, signal),
    enabled: !!customerId,
    staleTime: 0,
  });
}

export function useDebts(
  params: {
    branchId: string | null;
    direction?: "receivable" | "payable";
    openOnly?: boolean;
    customerId?: string | null;
  },
  enabled = true,
) {
  const { branchId, customerId, ...rest } = params;
  return useApiQuery({
    queryKey: debtKeys.list({ branchId, customerId, ...rest }),
    queryFn: ({ signal }) =>
      debtsApi.list(
        {
          branchId: branchId as string,
          ...rest,
          ...(customerId ? { customerId } : {}),
        },
        signal,
      ),
    enabled: !!branchId && enabled,
    staleTime: 0,
  });
}

export function useCollateral(
  params: {
    branchId: string | null;
    status?: "held" | "converted" | "returned";
  },
  enabled = true,
) {
  return useApiQuery({
    queryKey: collateralKeys.list({ ...params }),
    queryFn: ({ signal }) =>
      debtsApi.collateral(
        {
          branchId: params.branchId as string,
          ...(params.status ? { status: params.status } : {}),
        },
        signal,
      ),
    enabled: !!params.branchId && enabled,
    staleTime: 0,
  });
}

/** Cash moves in these, so the drawer and the lists must be re-read after any of them. */
const afterMoney = [debtKeys.all, collateralKeys.all, dayKeys.all];

export function useIssueLoan() {
  return useApiMutation<Debt, LoanInput>({
    mutationFn: (cmd) => debtsApi.loan(cmd),
    invalidates: afterMoney,
    successMessage: "Loan recorded",
  });
}

export function useRepay() {
  return useApiMutation<Debt, { debtId: string; cmd: RepaymentInput }>({
    mutationFn: ({ debtId, cmd }) => debtsApi.repay(debtId, cmd),
    invalidates: afterMoney,
    successMessage: (d) =>
      d.status === "open"
        ? "Payment recorded"
        : "Fully paid. This debt is closed.",
  });
}

export function useReturnCollateral() {
  return useApiMutation<unknown, { id: string; note: string | null }>({
    mutationFn: ({ id, note }) => debtsApi.returnCollateral(id, note),
    invalidates: afterMoney,
    successMessage: "Gold handed back",
  });
}
