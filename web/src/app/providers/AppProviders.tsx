import type { PropsWithChildren } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { AppErrorFallback } from '@/shared/ui/ErrorPages';
import { ToastViewport } from '@/shared/ui/toast';
import { AuthBootstrap } from '@/features/auth/AuthBootstrap';
import { QueryProvider } from './QueryProvider';

/** Provider order, outermost first: data cache, then auth (needs the cache), then the app. */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary FallbackComponent={AppErrorFallback}>
      <QueryProvider>
        <AuthBootstrap>{children}</AuthBootstrap>
        <ToastViewport />
      </QueryProvider>
    </ErrorBoundary>
  );
}
