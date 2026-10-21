import type { PropsWithChildren } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { hasAccess, type Access } from '@/features/auth/access';
import { useAuth } from '@/features/auth/store';

/** Layout route: everything beneath it needs a signed-in user. */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** Wraps a route element with a role/permission rule. Signed-in but not allowed shows a clear message, not a redirect loop. */
export function RequireAccess({ access, children }: PropsWithChildren<{ access: Access }>) {
  const user = useAuth((s) => s.user);
  if (!hasAccess(user, access)) {
    return (
      <div className="p-6" role="alert">
        <h2 className="text-lg font-semibold">No access</h2>
        <p className="text-sm text-muted">Your role does not allow this page. Ask a manager if you need it.</p>
      </div>
    );
  }
  return children;
}
