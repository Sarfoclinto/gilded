import type { Permission } from '@/config/permissions';
import type { Role, User } from './schemas';

/** Declarative access rule attached to a route or a UI element. All given conditions must hold. */
export interface Access {
  roles?: Role[];
  permission?: Permission;
}

export function hasAccess(user: User | null, access?: Access): boolean {
  if (!access) return !!user;
  if (!user) return false;
  if (access.roles && !access.roles.includes(user.role)) return false;
  if (access.permission && !user.permissions.includes(access.permission)) return false;
  return true;
}
