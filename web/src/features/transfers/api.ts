import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { dayKeys } from "@/features/drawer/api";
import {
  staffSchema,
  transferableItemSchema,
  transferRowSchema,
  transferSchema,
  type CollectorInput,
  type ReceiveLineInput,
  type Transfer,
} from "./schemas";
import type { Lines } from "@gold/core";

export const transferKeys = createKeys("transfers");

export const transfersApi = {
  list: (
    params: { branchId: string; direction?: string; status?: string },
    signal?: AbortSignal,
  ) =>
    request(
      { method: "get", url: "/transfers", params, signal },
      z.array(transferRowSchema),
    ),
  items: (branchId: string, signal?: AbortSignal) =>
    request(
      {
        method: "get",
        url: "/transfers/available-items",
        params: { branchId },
        signal,
      },
      z.array(transferableItemSchema),
    ),
  staff: (signal?: AbortSignal) =>
    request(
      { method: "get", url: "/transfers/staff", signal },
      z.array(staffSchema),
    ),
  get: (id: string, signal?: AbortSignal) =>
    request({ method: "get", url: `/transfers/${id}`, signal }, transferSchema),
  create: (cmd: CreateTransferInput) =>
    request(
      {
        method: "post",
        url: "/transfers",
        data: cmd,
        headers: { "Idempotency-Key": cmd.id },
      },
      transferSchema,
    ),
  edit: (id: string, data: Record<string, unknown>) =>
    request({ method: "patch", url: `/transfers/${id}`, data }, transferSchema),
  release: (id: string, data: { note?: string; lines?: Lines }) =>
    request(
      { method: "post", url: `/transfers/${id}/release`, data },
      transferSchema,
    ),
  pay: (id: string, data: PaymentInput) =>
    request(
      { method: "post", url: `/transfers/${id}/payments`, data },
      transferSchema,
    ),
  receive: (
    id: string,
    data: { note?: string; lines: ReceiveLineInput[] | Lines },
  ) =>
    request(
      { method: "post", url: `/transfers/${id}/receive`, data },
      transferSchema,
    ),
  cancel: (id: string, reason: string) =>
    request(
      { method: "post", url: `/transfers/${id}/cancel`, data: { reason } },
      transferSchema,
    ),
  note: (id: string, text: string) =>
    request(
      { method: "post", url: `/transfers/${id}/notes`, data: { text } },
      transferSchema,
    ),
};

export interface CreateTransferInput {
  id: string;
  kind: "goods" | "cash";
  originBranchId: string;
  destinationBranchId: string;
  purpose: string;
  method: string;
  purposeNote?: string;
  itemIds?: string[];
  collector?: CollectorInput;
}

export interface PaymentInput {
  id: string;
  branchId: string;
  direction: "paid_to_collector" | "received_from_collector";
  amount: string;
  method: "cash" | "mobile_money" | "bank" | "other";
  purpose: string;
  externalRef?: string;
  note?: string;
  lines?: Lines;
}

export function useTransfers(params: {
  branchId: string | null;
  direction?: "all" | "outgoing" | "incoming";
  status?: string;
}) {
  const { branchId, ...rest } = params;
  return useApiQuery({
    queryKey: transferKeys.list({ branchId, ...rest }),
    queryFn: ({ signal }) =>
      transfersApi.list({ branchId: branchId as string, ...rest }, signal),
    enabled: !!branchId,
    staleTime: 0,
  });
}

export function useTransfer(id: string | undefined) {
  return useApiQuery({
    queryKey: transferKeys.detail(id ?? ""),
    queryFn: ({ signal }) => transfersApi.get(id as string, signal),
    enabled: !!id,
    staleTime: 0,
  });
}

export function useTransferableItems(branchId: string | null, enabled = true) {
  return useApiQuery({
    queryKey: transferKeys.custom("items", { branchId }),
    queryFn: ({ signal }) => transfersApi.items(branchId as string, signal),
    enabled: !!branchId && enabled,
    staleTime: 0,
  });
}

export function useStaff(enabled = true) {
  return useApiQuery({
    queryKey: transferKeys.custom("staff"),
    queryFn: ({ signal }) => transfersApi.staff(signal),
    enabled,
    staleTime: 60_000,
  });
}

/** Money and gold move with transfers, so the drawer and day figures are re-read too. */
const after = [transferKeys.all, dayKeys.all];

export function useCreateTransfer() {
  return useApiMutation<Transfer, CreateTransferInput>({
    mutationFn: (cmd) => transfersApi.create(cmd),
    invalidates: after,
    successMessage: "Draft saved",
  });
}
export function useEditTransfer() {
  return useApiMutation<
    Transfer,
    { id: string; data: Record<string, unknown> }
  >({
    mutationFn: ({ id, data }) => transfersApi.edit(id, data),
    invalidates: after,
    successMessage: "Saved",
  });
}
export function useReleaseTransfer() {
  return useApiMutation<Transfer, { id: string; note?: string; lines?: Lines }>(
    {
      mutationFn: ({ id, ...data }) => transfersApi.release(id, data),
      invalidates: after,
      successMessage: "Handed to the collector",
    },
  );
}
export function usePayTransfer() {
  return useApiMutation<Transfer, { id: string; data: PaymentInput }>({
    mutationFn: ({ id, data }) => transfersApi.pay(id, data),
    invalidates: after,
    successMessage: "Recorded",
  });
}
export function useReceiveTransfer() {
  return useApiMutation<
    Transfer,
    { id: string; note?: string; lines: ReceiveLineInput[] | Lines }
  >({
    mutationFn: ({ id, ...data }) => transfersApi.receive(id, data),
    invalidates: after,
    successMessage: (t) =>
      t.status === "received"
        ? "Received. Everything matched."
        : "Received. The differences were sent for review.",
  });
}
export function useCancelTransfer() {
  return useApiMutation<Transfer, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => transfersApi.cancel(id, reason),
    invalidates: after,
    successMessage: "Cancelled",
  });
}
export function useAddTransferNote() {
  return useApiMutation<Transfer, { id: string; text: string }>({
    mutationFn: ({ id, text }) => transfersApi.note(id, text),
    invalidates: after,
    successMessage: "Note added",
  });
}
