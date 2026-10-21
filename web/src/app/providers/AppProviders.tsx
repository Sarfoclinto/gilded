import type { PropsWithChildren } from 'react';
import { ToastViewport } from '@/shared/ui/toast';
import { QueryProvider } from './QueryProvider';

/** Provider order: outermost first. Auth and Router are added in the next commit. */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryProvider>
      {children}
      <ToastViewport />
    </QueryProvider>
  );
}
