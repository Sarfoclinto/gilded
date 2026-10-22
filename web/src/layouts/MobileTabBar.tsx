import { MenuIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/store';
import { useUI } from '@/store/ui';
import { appMenu } from './menu';
import { filterMenu, flatten } from './menuFilter';

/**
 * Phone bottom tabs: the few things used all day, one tap away, plus "Menu" for everything else.
 * Tabs come from the same menu data (items flagged `mobileTab`), so permissions apply here too.
 */
export function MobileTabBar() {
  const user = useAuth((s) => s.user);
  const openDrawer = useUI((s) => s.openDrawer);
  const tabs = useMemo(() => flatten(filterMenu(appMenu, user)).filter((i) => i.mobileTab).slice(0, 4), [user]);

  const base = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium';
  return (
    <nav aria-label="Main" className="flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      {tabs.map((t) => (
        <NavLink key={t.key} to={t.key} end={t.key === '/'} className={({ isActive }) => cn(base, isActive ? 'text-brand' : 'text-muted-foreground')}>
          {t.icon}
          <span>{t.title}</span>
        </NavLink>
      ))}
      <button type="button" onClick={openDrawer} className={cn(base, 'text-muted-foreground')}>
        <MenuIcon className="size-4" />
        <span>Menu</span>
      </button>
    </nav>
  );
}
