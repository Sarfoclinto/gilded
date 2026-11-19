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
import { useMenuFlags } from "@/features/groupSheets/GroupSheetsSync";

/** One-word names for the bar, so every label fits on one line. The full names stay in the side menu. */
const SHORT: Record<string, string> = {
  [paths.calculator.href]: "Calculator",
  [paths.transactions.list.href]: "History",
  [paths.drawer.home.href]: "Drawer",
};

/**
 * Phone bottom tabs: the few things used all day, one tap away, plus "Menu" for everything else.
 * Tabs come from the same menu data (items flagged `mobileTab`), so permissions apply here too.
 * Six equal slots, the purchase button in the middle where a thumb rests; the open tab gets a gold pill behind its icon.
 */
export function MobileTabBar() {
  const user = useAuth((s) => s.user);
  const openDrawer = useUI((s) => s.openDrawer);
  const flags = useMenuFlags();
  const tabs = useMemo(
    () =>
      flatten(filterMenu(appMenu, user, flags))
        .filter((i) => i.mobileTab)
        .slice(0, 4),
    [user, flags.groupSheets],
  );

  const canBuy = useHasPermission(PERMISSIONS.TRANSACTIONS_CREATE);
  const { pathname } = useLocation();
  const hasDraft = useHasDraft();
  const buying = pathname === paths.transactions.create.href;

  // Every slot is the same width, however many tabs this person may see, and nothing wraps.
  const slot =
    "group relative flex min-h-[3.75rem] min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 px-0.5 pt-1.5 text-[11px] font-medium leading-none";
  const pill = (on: boolean) =>
    cn(
      "grid h-8 w-14 place-items-center rounded-full transition-colors [&_svg]:size-[22px]",
      on
        ? "bg-brand/15 text-brand"
        : "text-muted-foreground group-active:bg-muted",
    );
  return (
    <nav
      aria-label="Main"
      className="flex items-stretch border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(13,27,46,0.06)] backdrop-blur lg:hidden"
    >
      {tabs.map((t, i) => (
        <Fragment key={t.key}>
          {/* The one thing a teller does all day, in the middle of the bar. */}
          {i === 2 && canBuy ? (
            <NavLink
              to={paths.transactions.create.href}
              aria-label={hasDraft ? "Continue your purchase" : "New purchase"}
              className={cn(
                slot,
                "justify-end pb-1.5 font-semibold text-foreground",
              )}
            >
              <span
                className={cn(
                  "-mt-6 grid size-14 place-items-center rounded-full bg-gradient-to-br from-[#C9A84C] to-[#E8C97A] text-[#0D1B2E] shadow-lg ring-4 ring-card",
                  buying && "ring-[#C9A84C]/40",
                )}
              >
                <PlusIcon className="size-7" aria-hidden />
              </span>
              <span className="truncate">{hasDraft ? "Continue" : "New"}</span>
            </NavLink>
          ) : null}
          <NavLink
            to={t.key}
            end={t.key === "/"}
            className={({ isActive }) =>
              cn(slot, isActive ? "text-brand" : "text-muted-foreground")
            }
          >
            {({ isActive }) => (
              <>
                <span className={pill(isActive)}>{t.icon}</span>
                <span
                  className={cn(
                    "max-w-full truncate",
                    isActive && "font-semibold",
                  )}
                >
                  {SHORT[t.key] ?? t.title}
                </span>
              </>
            )}
          </NavLink>
        </Fragment>
      ))}
      <button
        type="button"
        onClick={openDrawer}
        className={cn(slot, "text-muted-foreground")}
      >
        <span className={pill(false)}>
          <MenuIcon />
        </span>
        <span>Menu</span>
      </button>
    </nav>
  );
}
