import { MenuIcon, PlusIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { useHasDraft } from "@/features/transactions/draft";
import { Fragment, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/store";
import { useUI } from "@/store/ui";
import { appMenu } from "./menu";
import { filterMenu, flatten } from "./menuFilter";

/**
 * Phone bottom tabs: the few things used all day, one tap away, plus "Menu" for everything else.
 * Tabs come from the same menu data (items flagged `mobileTab`), so permissions apply here too.
 */
export function MobileTabBar() {
  const user = useAuth((s) => s.user);
  const openDrawer = useUI((s) => s.openDrawer);
  const tabs = useMemo(
    () =>
      flatten(filterMenu(appMenu, user))
        .filter((i) => i.mobileTab)
        .slice(0, 4),
    [user],
  );

  const canBuy = useHasPermission(PERMISSIONS.TRANSACTIONS_CREATE);
  const { pathname } = useLocation();
  const hasDraft = useHasDraft();
  const buying = pathname === paths.transactions.create.href;

  const base =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  return (
    <nav
      aria-label="Main"
      className="flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {tabs.map((t, i) => (
        <Fragment key={t.key}>
          {/* The one thing a teller does all day, in the middle of the bar where a thumb rests. */}
          {i === 2 && canBuy ? (
            <NavLink
              to={paths.transactions.create.href}
              aria-label={hasDraft ? "Continue your purchase" : "New purchase"}
              className="relative flex flex-1 flex-col items-center justify-end pb-1 text-[11px] font-semibold text-foreground"
            >
              <span
                className={cn(
                  "-mt-5 grid size-14 place-items-center rounded-full bg-gradient-to-br from-[#C9A84C] to-[#E8C97A] text-[#0D1B2E] shadow-lg ring-4 ring-card",
                  buying && "ring-[#C9A84C]/40",
                )}
              >
                <PlusIcon className="size-7" aria-hidden />
              </span>
              <span>{hasDraft ? "Continue" : "New"}</span>
            </NavLink>
          ) : null}
          <NavLink
            to={t.key}
            end={t.key === "/"}
            className={({ isActive }) =>
              cn(base, isActive ? "text-brand" : "text-muted-foreground")
            }
          >
            {t.icon}
            <span>{t.title}</span>
          </NavLink>
        </Fragment>
      ))}
      <button
        type="button"
        onClick={openDrawer}
        className={cn(base, "text-muted-foreground")}
      >
        <MenuIcon className="size-4" />
        <span>Menu</span>
      </button>
    </nav>
  );
}
