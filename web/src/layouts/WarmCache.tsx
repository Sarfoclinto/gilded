import { useAuth } from '@/features/auth/store';
import { useActiveDrawer } from '@/features/drawer/hooks';
import { useCurrentPrice } from '@/features/prices/api';

/**
 * Loads what a teller needs to keep working if the connection drops: today's price and the drawer.
 * Both are kept on the device (see QueryProvider), so this runs on every screen, not only the ones that show them.
 */
export function WarmCache() {
  const branchId = useAuth((s) => s.activeBranchId);
  useCurrentPrice(branchId);
  useActiveDrawer();
  return null;
}
