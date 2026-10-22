import type { PropsWithChildren } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { AppErrorFallback } from '@/shared/ui/ErrorPages';
import { ToastViewport } from '@/shared/ui/toast';
import { AuthBootstrap } from '@/features/auth/AuthBootstrap';
import { OutboxProvider } from '@/shared/offline/OutboxProvider';
import { QueryProvider } from './QueryProvider';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { makeOnSynced, outboxHandlers } from '../outbox';

/** Provider order, outermost first: data cache, then auth (needs the cache), then the app. */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary FallbackComponent={AppErrorFallback}>
      <QueryProvider>
        <AuthBootstrap>
          <WithOutbox>{children}</WithOutbox>
        </AuthBootstrap>
        <ToastViewport />
      </QueryProvider>
    </ErrorBoundary>
  );
}

/** Needs the query client, so it sits inside QueryProvider. */
function WithOutbox({ children }: PropsWithChildren) {
  const qc = useQueryClient();
  const onSynced = useMemo(() => makeOnSynced(qc), [qc]);
  return (
    <OutboxProvider handlers={outboxHandlers} onSynced={onSynced}>
      {children}
    </OutboxProvider>
  );
}
