import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BuildingIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ImagesIcon,
  KeyRoundIcon,
  LogOutIcon,
  SettingsIcon,
} from "lucide-react";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useHasPermission } from "@/features/auth/useHasPermission";
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
import { QuickCameraButton } from "@/features/personal/QuickCamera";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { useSettings } from "@/features/settings/api";
import { useOutbox } from "@/shared/offline/OutboxProvider";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { ConnectionBadge } from "@/shared/ui/ConnectionBadge";
import { Avatar } from "@/features/photos/Avatar";
import { BranchSwitcher } from "./BranchSwitcher";
import { HubPill } from "./HubPill";
import { NewPurchaseButton } from "./NewPurchaseButton";
import { SearchButton } from "@/features/search/SearchButton";
import { appMenu } from "./menu";
import { crumbsFor, filterMenu } from "./menuFilter";

/**
 * One slim bar. Desktop: where you are (section > page) on the left, then branch, connection, notifications and the account.
 * Phone: the brand mark and the branch on the left, the same controls on the right. Name and role live in the account menu.
 */
export function Header() {
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  const canCompanySettings = useHasPermission(PERMISSIONS.SETTINGS_MANAGE);
  const { waiting } = useOutbox();
  const myPicturesOn = useSettings()["personalPictures.enabled"];
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
            className="grid size-8 shrink-0 place-items-center"
          >
            <img
              src="/logo-mark.svg"
              alt=""
              className="size-8 object-contain"
            />
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
        <SearchButton wide={desktop} />
        {desktop ? <NewPurchaseButton /> : null}
        {desktop ? <BranchSwitcher /> : null}
        <HubPill />
        <ConnectionBadge />
        {desktop ? <QuickCameraButton variant="header" /> : null}
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="flex h-10 items-center gap-2 rounded-full border border-border bg-background pl-1 pr-2 md:pr-3"
            >
              <Avatar userId={user?.id} name={user?.displayName} />
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
              <Link to={paths.settings.me.href}>
                <SettingsIcon className="size-4" /> My settings
              </Link>
            </DropdownMenuItem>
            {canCompanySettings ? (
              <DropdownMenuItem asChild>
                <Link to={paths.settings.company.href}>
                  <BuildingIcon className="size-4" /> Company settings
                </Link>
              </DropdownMenuItem>
            ) : null}
            {myPicturesOn ? (
              <DropdownMenuItem asChild>
                <Link to={paths.myPictures.href}>
                  <ImagesIcon className="size-4" /> My pictures
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link to={paths.changePassword.href}>
                <KeyRoundIcon className="size-4" /> Change my password
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                // Unsent purchases stay on this device and go out the next time this person signs in here.
                if (
                  waiting.length > 0 &&
                  !window.confirm(
                    `${waiting.length} saved ${waiting.length === 1 ? "entry has" : "entries have"} not reached the server yet. They stay on this device and are sent when you sign in here again, on a connection. Sign out anyway?`,
                  )
                )
                  return;
                logout.mutate();
              }}
            >
              <LogOutIcon className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
