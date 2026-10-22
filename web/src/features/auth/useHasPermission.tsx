import type { PropsWithChildren, ReactNode } from 'react';
import type { Permission } from '@/config/permissions';
import { hasAccess, type Access } from './access';
import { useAuth } from './store';

/** True when the signed-in user may do this. Use for buttons and menu items. */
export function useHasPermission(permission: Permission): boolean {
  return useAuth((s) => hasAccess(s.user, { permission }));
}

/** <Can permission="transactions:create"><Button/></Can> renders its children only when allowed. */
export function Can({ children, fallback = null, ...access }: PropsWithChildren<Access & { fallback?: ReactNode }>) {
  const user = useAuth((s) => s.user);
  return hasAccess(user, access) ? <>{children}</> : <>{fallback}</>;
}
