import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState, type PropsWithChildren } from "react";
import { isApiError } from "@/shared/api/errors";
import { createCachePersister } from "@/shared/offline/cacheStore";
import { offlineMaxAgeMs, PERSISTED_ROOTS } from "@/shared/offline/policy";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: offlineMaxAgeMs(), // keep days so cached reads still show through a long outage
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
 * What survives a reload (see PERSISTED_ROOTS): today's price, branches, the last known drawer, company settings, and recent
 * transactions and debts, so a teller who reopens the app with no signal still has them. Transactions and debts carry customer names, so they
 * leave the device the same way the customer list does (7 days, company change, "Forget this device"). It stays through sign-out (so a teller can sign back in offline) and is cleared when a different company signs in on the device, or by "Forget this device".
 */
const persister = createCachePersister();

export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(makeClient);
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: offlineMaxAgeMs(),
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
