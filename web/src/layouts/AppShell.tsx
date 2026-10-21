import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { hasAccess } from '@/features/auth/access';
import { useLogout } from '@/features/auth/hooks';
import { useAuth } from '@/features/auth/store';
import { appRoutes } from '@/app/router/routes';
import { ConnectionBadge } from '@/shared/ui/ConnectionBadge';
import { BranchSwitcher } from './BranchSwitcher';

/**
 * Phone first: top bar plus a bottom tab bar. From md up the tabs become a left rail.
 * Padding respects the iPhone notch and home indicator.
 */
export default function AppShell() {
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  const items = appRoutes.filter((r) => r.nav && hasAccess(user, r.access));

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium md:flex-none md:justify-start ${
      isActive ? 'bg-brand/15 text-brand' : 'text-muted hover:bg-line/40'
    }`;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav
        aria-label="Main"
        className="order-2 flex gap-1 border-t border-line bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:order-1 md:w-52 md:flex-col md:border-r md:border-t-0"
      >
        <div className="hidden px-3 py-2 text-base font-bold md:block">Gold Valuation</div>
        {items.map((r) => (
          <NavLink key={r.path} to={r.path} end={r.path === '/'} className={link}>
            {r.nav!.label}
          </NavLink>
        ))}
      </nav>

      <div className="order-1 flex min-h-0 flex-1 flex-col md:order-2">
        <header className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <BranchSwitcher />
          <div className="flex items-center gap-2">
            <ConnectionBadge />
            <button
              onClick={() => logout.mutate()}
              className="min-h-10 rounded-lg px-3 text-sm text-muted hover:bg-line/40"
              aria-label={`Sign out ${user?.displayName ?? ''}`}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
