import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { ApiError, errorMessage } from './errors';
import { isOnline } from '@/shared/offline/connectivity';
import { toast } from '@/shared/ui/toast';

/** Reads: same as useQuery, typed with ApiError. Cached data stays usable when offline. */
export function useApiQuery<TData>(
  options: Omit<UseQueryOptions<TData, ApiError, TData, QueryKey>, 'queryKey' | 'queryFn'> & {
    queryKey: QueryKey;
    queryFn: () => Promise<TData>;
  },
) {
  return useQuery<TData, ApiError, TData, QueryKey>(options);
}

interface ApiMutationOptions<TData, TVars> extends Omit<UseMutationOptions<TData, ApiError, TVars>, 'onError'> {
  /** Query keys to invalidate after success. */
  invalidates?: QueryKey[];
  /** Toast text on success. Omit for none. */
  successMessage?: string | ((data: TData, vars: TVars) => string);
  /**
   * Writes need a connection until the offline command queue exists (the transactions slice).
   * Set false only for mutations that are safe to attempt anyway.
   */
  requiresOnline?: boolean;
  /** Skip the default error toast, for forms that show field errors inline. */
  silent?: boolean;
  onError?: (error: ApiError, vars: TVars) => void;
}

/**
 * Writes: wraps useMutation with the behaviour every screen would otherwise repeat.
 * Online check, error toast, success toast, and cache invalidation.
 */
export function useApiMutation<TData, TVars = void>(opts: ApiMutationOptions<TData, TVars>) {
  const qc = useQueryClient();
  const { invalidates, successMessage, requiresOnline = true, silent, onError, onSuccess, mutationFn, ...rest } = opts;

  return useMutation<TData, ApiError, TVars>({
    ...rest,
    mutationFn: async (vars, mctx) => {
      if (requiresOnline && !isOnline()) throw new ApiError({ kind: 'offline', message: 'Offline' });
      if (!mutationFn) throw new Error('mutationFn is required');
      return mutationFn(vars, mctx);
    },
    onSuccess: async (data, vars, onMutateResult, mctx) => {
      if (invalidates) await Promise.all(invalidates.map((queryKey) => qc.invalidateQueries({ queryKey })));
      if (successMessage) toast.success(typeof successMessage === 'function' ? successMessage(data, vars) : successMessage);
      await onSuccess?.(data, vars, onMutateResult, mctx);
    },
    onError: (error, vars) => {
      if (!silent) toast.error(errorMessage(error));
      onError?.(error, vars);
    },
  });
}
