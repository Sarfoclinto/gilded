import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState, type PropsWithChildren } from "react";
import { isApiError } from "@/shared/api/errors";
import { OFFLINE_MAX_AGE_MS, PERSISTED_ROOTS } from "@/shared/offline/policy";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: OFFLINE_MAX_AGE_MS, // keep days so cached reads still show through a long outage
        // Serve cached data offline instead of pausing and showing a spinner forever.
        networkMode: "offlineFirst",
        refetchOnWindowFocus: false, // avoids surprise refetches (and lag) when switching apps on a phone
        refetchOnReconnect: true,
        retry: (failureCount, error) =>
          failureCount < 2 && isApiError(error) && error.retryable,
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}

/**
 * Only reference data and the drawer snapshot survive a reload (today's price, branches, the last known drawer), so a teller who reloads or reopens
 * the app with no signal still has the price to work with. Customer data is NOT written here; the offline
 * outbox holds that. It stays through sign-out (so a teller can sign back in offline) and is cleared when a different company signs in on the device, or by "Forget this device".
 */
const persister = createSyncStoragePersister({
  storage: typeof window === "undefined" ? undefined : window.localStorage,
  key: "gold.rq.v1",
  throttleTime: 250, // write soon: a phone can be locked or killed right after a change
});

export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(makeClient);
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: OFFLINE_MAX_AGE_MS,
        buster: "v1",
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            q.state.status === "success" &&
            PERSISTED_ROOTS.has(String(q.queryKey[0])),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
