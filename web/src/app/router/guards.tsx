import type { PropsWithChildren } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import paths from '@/config/paths';
import { hasAccess, type Access } from '@/features/auth/access';
import { useAuth } from '@/features/auth/store';
import { useMySecurity } from '@/features/users/api';

/** Layout route: everything beneath it needs a signed-in user. */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const security = useMySecurity(status === 'authenticated');
  if (status !== 'authenticated') {
    return <Navigate to={paths.auth.login.href} replace state={{ from: location.pathname + location.search }} />;
  }
  // A password set by an administrator is temporary: nothing else opens until the person has chosen their own.
  if (security.data?.mustChangePassword && location.pathname !== paths.changePassword.href) {
    return <Navigate to={paths.changePassword.href} replace />;
  }
  return <Outlet />;
}

/** Wraps a route element with a role/permission rule. Signed in but not allowed goes to a clear "No access" page. */
export function RequireAccess({ access, children }: PropsWithChildren<{ access: Access }>) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!hasAccess(user, access)) {
    return <Navigate to={paths.unauthorized.redirect(location.pathname)} replace />;
  }
  return children;
}