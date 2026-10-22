import { Link } from 'react-router-dom';
import paths from '@/config/paths';
import { PERMISSIONS } from '@/config/permissions';
import { Can } from '@/features/auth/useHasPermission';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { useAuth } from '@/features/auth/store';
import { useCurrentPrice } from '@/features/prices/api';

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const branchId = useAuth((s) => s.activeBranchId);
  const price = useCurrentPrice(branchId);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Hello, {user?.displayName}</h1>
      <Card>
        <div className="text-sm text-muted">Price per pound today</div>
        {price.isLoading ? (
          <div className="mt-1 text-sm text-muted">Loading…</div>
        ) : price.data ? (
          <>
            <div className="tnum text-3xl font-bold">GHS {Number(price.data.effectivePrice).toLocaleString('en-GH')}</div>
            <div className="mt-1 text-xs text-muted">
              GoldBod {price.data.basePrice} + margin {price.data.margin}
              {price.data.status === 'provisional' ? ' · waiting for director approval' : ''}
            </div>
          </>
        ) : (
          <div className="mt-1 text-sm text-red-600 dark:text-red-400">Price not available.</div>
        )}
      </Card>
      <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
        <Link to={paths.transactions.create.href} className="block">
          <Button className="w-full">New transaction</Button>
        </Link>
      </Can>
    </div>
  );
}
