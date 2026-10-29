import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  LogOutIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { useLogout } from "@/features/auth/hooks";
import { useAuth } from "@/features/auth/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { ConnectionBadge } from "@/shared/ui/ConnectionBadge";
import { BranchSwitcher } from "./BranchSwitcher";
import { appMenu } from "./menu";
import { crumbsFor, filterMenu } from "./menuFilter";

const initials = (name?: string) =>
  (name ?? "?")
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/**
 * One slim bar. Desktop: where you are (section > page) on the left, then branch, connection, notifications and the account.
 * Phone: the brand mark and the branch on the left, the same controls on the right. Name and role live in the account menu.
 */
export function Header() {
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  const desktop = useIsDesktop();
  const { pathname } = useLocation();
  const crumbs = useMemo(
    () => crumbsFor(pathname, filterMenu(appMenu, user)),
    [pathname, user],
  );

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 pt-[env(safe-area-inset-top)] md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {!desktop ? (
          <Link
            to={paths.home.href}
            aria-label="Home"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#C9A84C] to-[#E8C97A] font-display text-sm font-bold text-[#0D1B2E]"
          >
            G
          </Link>
        ) : null}
        {desktop && crumbs.length > 0 ? (
          <nav
            aria-label="Where you are"
            className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
          >
            {crumbs.map((c, i) => (
              <Fragment key={`${c}-${i}`}>
                {i > 0 ? (
                  <ChevronRightIcon className="size-3.5 shrink-0" />
                ) : null}
                <span
                  className={
                    i === crumbs.length - 1
                      ? "truncate font-semibold text-foreground"
                      : "truncate"
                  }
                >
                  {c}
                </span>
              </Fragment>
            ))}
          </nav>
        ) : null}
        {!desktop ? <BranchSwitcher /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {desktop ? <BranchSwitcher /> : null}
        <ConnectionBadge />
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="flex h-10 items-center gap-2 rounded-full border border-border bg-background pl-1 pr-2 md:pr-3"
            >
              <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#C9A84C] to-[#E8C97A] text-xs font-bold text-[#0D1B2E]">
                {initials(user?.displayName)}
              </span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block max-w-32 truncate text-sm font-semibold">
                  {user?.displayName}
                </span>
                <span className="block text-[11px] capitalize text-muted-foreground">
                  {user?.role}
                </span>
              </span>
              <ChevronDownIcon className="hidden size-3.5 text-muted-foreground md:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuLabel>
              <div className="font-semibold">{user?.displayName}</div>
              <div className="text-xs font-normal capitalize text-muted-foreground">
                {user?.role}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to={paths.changePassword.href}>
                <KeyRoundIcon className="size-4" /> Change my password
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => logout.mutate()}>
              <LogOutIcon className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
