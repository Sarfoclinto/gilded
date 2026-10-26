import { z } from "zod";
import { request } from "@/shared/api/client";
import { useApiMutation, useApiQuery } from "@/shared/api/hooks";
import { createKeys } from "@/shared/api/queryKeys";
import {
  caseDetailSchema,
  caseSchema,
  positionRowSchema,
  timelineSchema,
  type CaseDetail,
} from "./schemas";

export const reviewKeys = createKeys("review");

export const reviewApi = {
  cases: (
    params: { status?: string; branchId?: string },
    signal?: AbortSignal,
  ) =>
    request(
      { method: "get", url: "/discrepancies", params, signal },
      z.array(caseSchema),
    ),
  case: (id: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: `/discrepancies/${id}`, signal },
      caseDetailSchema,
    ),
  act: (id: string, data: CaseAction) =>
    request(
      { method: "post", url: `/discrepancies/${id}/actions`, data },
      caseDetailSchema,
    ),
  timeline: (
    branchId: string,
    params: { from?: string; to?: string; asset?: string; before?: number },
    signal?: AbortSignal,
  ) =>
    request(
      { method: "get", url: `/branches/${branchId}/timeline`, params, signal },
      timelineSchema,
    ),
  position: (signal?: AbortSignal) =>
    request(
      { method: "get", url: "/branches/position", signal },
      z.array(positionRowSchema),
    ),
};

export type CaseAction =
  | { action: "take" }
  | { action: "note"; note: string }
  | { action: "resolve"; resolutionType: string; summary: string }
  | { action: "reopen"; note: string };

export const useCases = (params: { status: string; branchId?: string }) =>
  useApiQuery({
    queryKey: reviewKeys.list(params),
    queryFn: ({ signal }) => reviewApi.cases(params, signal),
    staleTime: 0,
  });

export const useCase = (id: string | null) =>
  useApiQuery({
    queryKey: reviewKeys.detail(id ?? ""),
    queryFn: ({ signal }) => reviewApi.case(id as string, signal),
    enabled: !!id,
    staleTime: 0,
  });

export function useCaseAction() {
  return useApiMutation<CaseDetail, { id: string; data: CaseAction }>({
    mutationFn: ({ id, data }) => reviewApi.act(id, data),
    invalidates: [reviewKeys.all],
    successMessage: "Saved",
  });
}

export const usePosition = () =>
  useApiQuery({
    queryKey: reviewKeys.custom("position", {}),
    queryFn: ({ signal }) => reviewApi.position(signal),
    staleTime: 0,
  });
