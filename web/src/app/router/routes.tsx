import { lazy, type ReactNode } from 'react';
import paths from '@/config/paths';
import { PERMISSIONS } from '@/config/permissions';
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
  nav?: { label: string };
}

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const CalculatorPage = lazy(() => import('@/features/calculator/CalculatorPage'));

export const appRoutes: AppRoute[] = [
  { path: paths.home.href, element: <DashboardPage />, nav: { label: paths.home.label } },
  {
    path: paths.calculator.href,
    element: <CalculatorPage />,
    access: { permission: PERMISSIONS.CALCULATOR_USE },
    nav: { label: paths.calculator.label },
  },
];

export const guarded = (r: AppRoute) => (r.access ? <RequireAccess access={r.access}>{r.element}</RequireAccess> : r.element);
