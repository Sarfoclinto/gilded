import { z } from "zod";
import { request } from "@/shared/api/client";
import { createKeys } from "@/shared/api/queryKeys";
import {
  closingPreviewSchema,
  daySchema,
  dayStateSchema,
  movementSchema,
  type CloseDayInput,
  type MovementCommand,
  type OpenDayInput,
} from "./schemas";

export const dayKeys = createKeys("days");

/** Writes use the command id as the Idempotency-Key, so a resend can never double-apply. */
export const daysApi = {
  current: (branchId: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: "/days/current", params: { branchId }, signal },
      dayStateSchema,
    ),
  history: (
    params: {
      branchId: string;
      signoff?: string;
      from?: string;
      to?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ) =>
    request(
      { method: "get", url: "/days", params: { limit: 60, ...params }, signal },
      z.array(daySchema),
    ),
  preview: (dayId: string, signal?: AbortSignal) =>
    request(
      { method: "get", url: `/days/${dayId}/closing-preview`, signal },
      closingPreviewSchema,
    ),
  open: (cmd: OpenDayInput) =>
    request(
      {
        method: "post",
        url: "/days/open",
        data: cmd,
        headers: { "Idempotency-Key": cmd.id },
      },
      daySchema,
    ),
  close: (cmd: CloseDayInput) =>
    request(
      {
        method: "post",
        url: `/days/${cmd.dayId}/close`,
        data: cmd,
        headers: { "Idempotency-Key": cmd.id },
      },
      daySchema,
    ),
  movement: (cmd: MovementCommand) =>
    request(
      {
        method: "post",
        url: `/days/${cmd.dayId}/movements`,
        data: cmd,
        headers: { "Idempotency-Key": cmd.id },
      },
      movementSchema,
    ),
  signoff: (
    dayId: string,
    decision: "approved" | "rejected",
    note: string | null,
  ) =>
    request(
      {
        method: "post",
        url: `/days/${dayId}/signoff`,
        data: { decision, note },
      },
      daySchema,
    ),
};
