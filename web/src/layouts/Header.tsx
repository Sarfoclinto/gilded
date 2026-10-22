import { LogOutIcon, UserIcon } from 'lucide-react';
import { useLogout } from '@/features/auth/hooks';
import { useAuth } from '@/features/auth/store';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConnectionBadge } from '@/shared/ui/ConnectionBadge';
import { BranchSwitcher } from './BranchSwitcher';

export function Header() {
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <BranchSwitcher />
      <div className="flex items-center gap-2">
        <ConnectionBadge />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Account" className="grid size-10 place-items-center rounded-full border border-border bg-background">
              <UserIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel>
              <div className="font-semibold">{user?.displayName}</div>
              <div className="text-xs font-normal capitalize text-muted-foreground">{user?.role}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout.mutate()}>
              <LogOutIcon className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
