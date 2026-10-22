import { branches } from '@/features/branches/api';
import { useAuth } from '@/features/auth/store';

export function BranchSwitcher() {
  const user = useAuth((s) => s.user);
  const activeBranchId = useAuth((s) => s.activeBranchId);
  const setActiveBranch = useAuth((s) => s.setActiveBranch);
  const { data } = branches.useList();

  const mine = (data ?? []).filter((b) => user?.branchIds.includes(b.id));
  if (mine.length === 0) return null;
  if (mine.length === 1) return <span className="text-sm font-medium">{mine[0]!.name}</span>;

  return (
    <select
      aria-label="Branch"
      value={activeBranchId ?? ''}
      onChange={(e) => setActiveBranch(e.target.value)}
      className="min-h-10 rounded-lg border border-border bg-card px-2 text-sm font-medium"
    >
      {mine.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
