import { branches } from "@/features/branches/api";
import { useAuth } from "@/features/auth/store";
import { SelectInput } from "@/shared/ui/SelectField";

export function BranchSwitcher() {
  const user = useAuth((s) => s.user);
  const activeBranchId = useAuth((s) => s.activeBranchId);
  const setActiveBranch = useAuth((s) => s.setActiveBranch);
  const { data } = branches.useList();

  const mine = (data ?? []).filter((b) => user?.branchIds.includes(b.id));
  if (mine.length === 0) return null;
  if (mine.length === 1)
    return (
      <span className="rounded-full border border-border bg-background px-3 py-2 text-sm font-medium">
        {mine[0]!.name}
      </span>
    );

  return (
    <SelectInput
      aria-label="Branch"
      value={activeBranchId ?? ""}
      onChange={(e) => setActiveBranch(e.target.value)}
      className="min-h-10 w-auto min-w-28 rounded-full font-medium"
    >
      {mine.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </SelectInput>
  );
}
