import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { useState, type PropsWithChildren } from 'react';
import { isApiError } from '@/shared/api/errors';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 24 * 60 * 60 * 1000, // keep a day so cached reads still show when the connection drops
        // Serve cached data offline instead of pausing and showing a spinner forever.
        networkMode: 'offlineFirst',
        refetchOnWindowFocus: false, // avoids surprise refetches (and lag) when switching apps on a phone
        refetchOnReconnect: true,
        retry: (failureCount, error) => failureCount < 2 && isApiError(error) && error.retryable,
      },
      mutations: { networkMode: 'always', retry: false },
    },
  });
}

/**
 * Only reference data survives a reload (today's price, branches), so a teller who reloads or reopens
 * the app with no signal still has the price to work with. Customer data is NOT written here; the offline
 * outbox holds that. The cache is cleared on sign-out (see useLogout / AuthBootstrap).
 */
const PERSISTED_ROOTS = new Set(['prices', 'branches']);

const persister = createSyncStoragePersister({
  storage: typeof window === 'undefined' ? undefined : window.localStorage,
  key: 'gold.rq.v1',
});

export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(makeClient);
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        buster: 'v1',
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === 'success' && PERSISTED_ROOTS.has(String(q.queryKey[0])),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
