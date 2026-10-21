import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(makeClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
