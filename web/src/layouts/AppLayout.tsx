import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { Splitter } from "antd";
import {
  PanelHeader,
  UtilityButton,
  UtilityContent,
  UtilitySheet,
} from "@/features/utility/UtilityPanel";
import { useUtilityPanel } from "@/features/utility/store";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { LiveProvider } from "@/shared/live/LiveProvider";
import { Header } from "./Header";
import { WarmCache } from "./WarmCache";
import { MobileTabBar } from "./MobileTabBar";
import { DesktopSidebar, MenuDrawer } from "./Sidebar";

/**
 * Desktop (1024px and up): sidebar + header + content.
 * Phone and tablet: header + content + bottom tabs, with the full menu in a drawer.
 */
export default function AppLayout() {
  const desktop = useIsDesktop();
  const { open, setOpen } = useUtilityPanel();
  const main = (
    <main className="h-full min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <Suspense
        fallback={
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        }
      >
        <Outlet />
      </Suspense>
    </main>
  );
  return (
    <LiveProvider>
      <div className="flex h-dvh bg-background">
        <WarmCache />
        {desktop ? <DesktopSidebar /> : <MenuDrawer />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          {desktop && open ? (
            // Desktop: the page and the calculators side by side; drag the bar to resize, or close the panel.
            <Splitter className="min-h-0 flex-1">
              <Splitter.Panel min={360}>{main}</Splitter.Panel>
              <Splitter.Panel defaultSize={380} min={300} max="50%">
                <div className="h-full overflow-y-auto border-l border-border bg-card">
                  <PanelHeader onClose={() => setOpen(false)} />
                  <UtilityContent />
                </div>
              </Splitter.Panel>
            </Splitter>
          ) : (
            main
          )}
          {!desktop && <MobileTabBar />}
          <UtilityButton />
          {!desktop && <UtilitySheet />}
        </div>
      </div>
    </LiveProvider>
  );
}
