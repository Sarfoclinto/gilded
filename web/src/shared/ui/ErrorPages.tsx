import { Link, useSearchParams } from 'react-router-dom';
import type { FallbackProps } from 'react-error-boundary';
import paths from '@/config/paths';
import { Button } from './Button';

function Page({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-[50vh] place-items-center p-6" role="alert">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="mt-2 space-y-3 text-sm text-muted-foreground">{children}</div>
        <Link to={paths.home.href} className="mt-4 inline-block text-sm font-medium text-brand underline">
          Go to Home
        </Link>
      </div>
    </div>
  );
}

export const NotFoundPage = () => <Page title="Page not found" />;

export function UnauthorizedPage() {
  const [params] = useSearchParams();
  return (
    <Page title="No access">
      <p>Your role does not allow this page. Ask a manager if you need it.</p>
      {params.get('reason') ? <p className="text-xs">({params.get('reason')})</p> : null}
    </Page>
  );
}

/** Last line of defence: a render error shows this instead of a blank screen. */
export function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="grid min-h-full place-items-center p-6" role="alert">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">The page hit an unexpected error. Your saved work is safe.</p>
        {import.meta.env.DEV ? <pre className="mt-3 overflow-auto text-left text-xs">{String((error as Error)?.message)}</pre> : null}
        <Button className="mt-4" onClick={resetErrorBoundary}>
          Try again
        </Button>
      </div>
    </div>
  );
}
