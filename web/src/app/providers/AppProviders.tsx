import type { PropsWithChildren } from 'react';
import { ToastViewport } from '@/shared/ui/toast';
import { AuthBootstrap } from '@/features/auth/AuthBootstrap';
import { QueryProvider } from './QueryProvider';

/** Provider order, outermost first: data cache, then auth (needs the cache), then the app. */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryProvider>
      <AuthBootstrap>{children}</AuthBootstrap>
      <ToastViewport />
    </QueryProvider>
  );
}
