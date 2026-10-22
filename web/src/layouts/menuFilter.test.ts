import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/config/permissions';
import type { User } from '@/features/auth/schemas';
import { appRoutes } from '@/app/router/routes';
import { appMenu } from './menu';
import { filterMenu, flatten, openKeysFor, selectedKey } from './menuFilter';

const user = (permissions: string[], role: User['role'] = 'teller'): User => ({
  id: 'u',
  username: 'u',
  displayName: 'U',
  role,
  permissions,
  branchIds: [],
});

const keysOf = (u: User | null) => flatten(filterMenu(appMenu, u)).map((i) => i.key);

describe('menu filtering', () => {
  it('shows everything the user may use', () => {
    const k = keysOf(user([PERMISSIONS.CALCULATOR_USE, PERMISSIONS.TRANSACTIONS_READ, PERMISSIONS.TRANSACTIONS_CREATE]));
    expect(k).toEqual(expect.arrayContaining(['/', '/calculator', 'transactions', '/transactions', '/transactions/new']));
  });

  it('hides items without permission and drops empty parents', () => {
    const k = keysOf(user([PERMISSIONS.CALCULATOR_USE]));
    expect(k).toContain('/calculator');
    expect(k).not.toContain('transactions');
    expect(k).not.toContain('/transactions');
  });

  it('keeps a parent when only some children are allowed', () => {
    const k = keysOf(user([PERMISSIONS.TRANSACTIONS_READ]));
    expect(k).toContain('transactions');
    expect(k).toContain('/transactions');
    expect(k).not.toContain('/transactions/new');
  });

  it('shows the Cash section only to people who may read the drawer', () => {
    expect(keysOf(user([PERMISSIONS.DAYS_READ]))).toEqual(expect.arrayContaining(['group-cash', '/drawer', '/drawer/history']));
    expect(keysOf(user([PERMISSIONS.CALCULATOR_USE]))).not.toContain('/drawer');
  });

  it('shows nothing guarded to a signed-out user', () => {
    expect(keysOf(null)).not.toContain('/calculator');
  });
});

describe('selection helpers', () => {
  it('highlights the section for a detail page', () => {
    expect(selectedKey('/transactions/abc-123', appMenu)).toBe('/transactions');
    expect(selectedKey('/transactions/new', appMenu)).toBe('/transactions/new');
    expect(selectedKey('/', appMenu)).toBe('/');
    expect(selectedKey('/drawer/close', appMenu)).toBe('/drawer');
  });
  it('opens the submenu that holds the selected item', () => {
    expect(openKeysFor('/transactions/new', appMenu)).toEqual(['transactions']);
    expect(openKeysFor('/calculator', appMenu)).toEqual([]);
  });
});

describe('menu and routes agree', () => {
  // The route table is the real gatekeeper. If a menu link shows a permission the route does not require
  // (or the reverse), people either see links that lead to "No access" or can reach pages that are not in the menu.
  it('every menu link with a permission matches its route rule', () => {
    const rules = new Map(appRoutes.map((r) => [r.path, r.access?.permission]));
    for (const item of flatten(appMenu).filter((i) => i.key.startsWith('/'))) {
      expect(rules.has(item.key), `no route for menu link ${item.key}`).toBe(true);
      expect(item.permission, `permission mismatch for ${item.key}`).toBe(rules.get(item.key));
    }
  });
});
