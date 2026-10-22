import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { Header } from './Header';
import { WarmCache } from './WarmCache';
import { MobileTabBar } from './MobileTabBar';
import { DesktopSidebar, MenuDrawer } from './Sidebar';

/**
 * Desktop (1024px and up): sidebar + header + content.
 * Phone and tablet: header + content + bottom tabs, with the full menu in a drawer.
 */
export default function AppLayout() {
  const desktop = useIsDesktop();
  return (
    <div className="flex h-dvh bg-background">
      <WarmCache />
      {desktop ? <DesktopSidebar /> : <MenuDrawer />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
        {!desktop && <MobileTabBar />}
      </div>
    </div>
  );
}
