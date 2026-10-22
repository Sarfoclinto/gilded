import { z } from 'zod';
import { request } from '@/shared/api/client';
import { createKeys } from '@/shared/api/queryKeys';
import { transactionSchema, type CreateTransaction } from './schemas';

export const transactionKeys = createKeys('transactions');

export const transactionsApi = {
  list: (branchId: string, signal?: AbortSignal) =>
    request({ method: 'get', url: '/transactions', params: { branchId, limit: 100 }, signal }, z.array(transactionSchema)),
  get: (id: string, signal?: AbortSignal) => request({ method: 'get', url: `/transactions/${id}`, signal }, transactionSchema),
  /** The transaction id doubles as the Idempotency-Key, so a retried send can never create a second one. */
  create: (cmd: CreateTransaction) =>
    request(
      { method: 'post', url: '/transactions', data: cmd, headers: { 'Idempotency-Key': cmd.id } },
      transactionSchema,
    ),
};
