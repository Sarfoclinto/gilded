import { hasAccess } from '@/features/auth/access';
import type { User } from '@/features/auth/schemas';
import type { AppMenuItem } from './menu';

/**
 * Pure and easy to test.
 * 1. No permission/roles on an item: always shown.
 * 2. Otherwise shown only if the user passes hasAccess().
 * 3. Parents are filtered by their children; a parent with none left is dropped (a heading with nothing under it is noise).
 */
export function filterMenu(items: AppMenuItem[], user: User | null): AppMenuItem[] {
  const out: AppMenuItem[] = [];
  for (const item of items) {
    if ((item.permission || item.roles) && !hasAccess(user, { permission: item.permission, roles: item.roles })) continue;
    if (item.children) {
      const children = filterMenu(item.children, user);
      if (children.length === 0) continue;
      out.push({ ...item, children });
    } else {
      out.push(item);
    }
  }
  return out;
}

export function flatten(items: AppMenuItem[]): AppMenuItem[] {
  return items.flatMap((i) => (i.children ? [i, ...flatten(i.children)] : [i]));
}

/** Which menu key is "current" for a path: the longest key that is a prefix, so /transactions/abc highlights Transactions. */
export function selectedKey(pathname: string, items: AppMenuItem[]): string | undefined {
  const keys = flatten(items)
    .map((i) => i.key)
    .filter((k) => k.startsWith('/'));
  return keys
    .filter((k) => (k === '/' ? pathname === '/' : pathname === k || pathname.startsWith(`${k}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

/** Keys of submenus that contain the selected item, so the right section is open. */
export function openKeysFor(selected: string | undefined, items: AppMenuItem[]): string[] {
  if (!selected) return [];
  const walk = (list: AppMenuItem[], trail: string[]): string[] | null => {
    for (const i of list) {
      if (i.key === selected) return trail;
      if (i.children) {
        const hit = walk(i.children, i.type === 'group' ? trail : [...trail, i.key]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(items, []) ?? [];
}

/** AntD's Menu takes plain items; strip our extra fields. */
export function toAntd(items: AppMenuItem[]): unknown[] {
  return items.map((i) => ({
    key: i.key,
    label: i.label,
    icon: i.icon,
    type: i.type,
    children: i.children ? toAntd(i.children) : undefined,
  }));
}
