import { z } from 'zod';
import { request } from '@/shared/api/client';
import { createKeys } from '@/shared/api/queryKeys';
import { daySchema, dayStateSchema, movementSchema, type CloseDay, type MovementCommand, type OpenDay } from './schemas';

export const dayKeys = createKeys('days');

/** Writes use the command id as the Idempotency-Key, like transactions, so a resend can never double-apply. */
export const daysApi = {
  current: (branchId: string, signal?: AbortSignal) =>
    request({ method: 'get', url: '/days/current', params: { branchId }, signal }, dayStateSchema),
  history: (branchId: string, signal?: AbortSignal) =>
    request({ method: 'get', url: '/days', params: { branchId, limit: 60 }, signal }, z.array(daySchema)),
  open: (cmd: OpenDay) => request({ method: 'post', url: '/days/open', data: cmd, headers: { 'Idempotency-Key': cmd.id } }, daySchema),
  close: (cmd: CloseDay) =>
    request({ method: 'post', url: `/days/${cmd.dayId}/close`, data: cmd, headers: { 'Idempotency-Key': cmd.id } }, daySchema),
  movement: (cmd: MovementCommand) =>
    request({ method: 'post', url: `/days/${cmd.dayId}/movements`, data: cmd, headers: { 'Idempotency-Key': cmd.id } }, movementSchema),
  signOff: (dayId: string) => request({ method: 'post', url: `/days/${dayId}/signoff` }, daySchema),
};
