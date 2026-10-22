import { Link } from 'react-router-dom';
import paths from '@/config/paths';
import { PERMISSIONS } from '@/config/permissions';
import { Can } from '@/features/auth/useHasPermission';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { useAuth } from '@/features/auth/store';
import { useCurrentPrice } from '@/features/prices/api';
import { useActiveDrawer } from '@/features/drawer/hooks';
import { cedis } from '@/features/calculator/format';
import { lineTotal } from '@gold/core';

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const branchId = useAuth((s) => s.activeBranchId);
  const price = useCurrentPrice(branchId);
  const { view: drawer } = useActiveDrawer();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Hello, {user?.displayName}</h1>
      <Card>
        <div className="text-sm text-muted-foreground">Price per pound today</div>
        {price.isLoading ? (
          <div className="mt-1 text-sm text-muted-foreground">Loading…</div>
        ) : price.data ? (
          <>
            <div className="tnum text-3xl font-bold">GHS {Number(price.data.effectivePrice).toLocaleString('en-GH')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              GoldBod {price.data.basePrice} + margin {price.data.margin}
              {price.data.status === 'provisional' ? ' · waiting for director approval' : ''}
            </div>
          </>
        ) : (
          <div className="mt-1 text-sm text-red-600 dark:text-red-400">Price not available.</div>
        )}
      </Card>
      <Can permission={PERMISSIONS.DAYS_READ}>
        <Link to={paths.drawer.home.href} className="block">
          <Card>
            <div className="text-sm text-muted-foreground">Cash drawer</div>
            {drawer.status === 'open' && drawer.balance ? (
              <div className="tnum text-3xl font-bold">{cedis(lineTotal(drawer.balance))}</div>
            ) : (
              <div className="text-lg font-semibold">
                {drawer.status === 'closed' ? 'Closed for today' : drawer.status === 'none' ? 'Day not opened yet' : 'Not loaded yet'}
              </div>
            )}
            {drawer.pendingCount > 0 ? <div className="mt-1 text-xs text-amber-700">{drawer.pendingCount} not sent yet</div> : null}
          </Card>
        </Link>
      </Can>
      <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
        <Link to={paths.transactions.create.href} className="block">
          <Button className="w-full">New transaction</Button>
        </Link>
      </Can>
    </div>
  );
}
