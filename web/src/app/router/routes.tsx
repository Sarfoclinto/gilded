import { lazy, type ReactNode } from 'react';
import type { Access } from '@/features/auth/access';
import { RequireAccess } from './guards';

/**
 * The route table is data. Each entry may carry an `access` rule; the table renders the guard for you,
 * so adding a page never means remembering to wrap it. `nav` puts it in the menu (shown only if allowed).
 */
export interface AppRoute {
  path: string;
  element: ReactNode;
  access?: Access;
  nav?: { label: string; short?: string };
}

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));

export const appRoutes: AppRoute[] = [
  { path: '/', element: <DashboardPage />, nav: { label: 'Home' } },
];

export const guarded = (r: AppRoute) => (r.access ? <RequireAccess access={r.access}>{r.element}</RequireAccess> : r.element);
