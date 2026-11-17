import { Suspense, useCallback, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { QuickCameraButton } from "@/features/personal/QuickCamera";
import { LockScreen } from "@/features/lock/LockScreen";
import { useIdleLock } from "@/features/lock/useIdleLock";
import {
  UtilityButton,
  UtilityPanelBody,
  UtilitySheet,
} from "@/features/utility/UtilityPanel";
import { useUtilityPanel } from "@/features/utility/store";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { LiveProvider } from "@/shared/live/LiveProvider";
import { Header } from "./Header";
import { useNewPurchaseShortcut } from "./NewPurchaseButton";
import { ClockWarning } from "./ClockWarning";
import { UpdateBanner } from "./UpdateBanner";
import { WarmCache } from "./WarmCache";
import { DeviceRegistration } from "./DeviceRegistration";
import { HubSync } from "./HubSync";
import { SearchPalette } from "@/features/search/SearchPalette";
import { SearchHotkeys } from "@/features/search/SearchButton";
import { MobileTabBar } from "./MobileTabBar";
import { DesktopSidebar, MenuDrawer } from "./Sidebar";

/**
 * Desktop (1024px and up): sidebar + header + content.
 * Phone and tablet: header + content + bottom tabs, with the full menu in a drawer.
 */
export default function AppLayout() {
  const desktop = useIsDesktop();
  const { open, setOpen } = useUtilityPanel();
  useNewPurchaseShortcut();
  const locked = useIdleLock();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(440);
  const maxWidth = () =>
    Math.max(360, Math.floor((rowRef.current?.clientWidth ?? 1000) / 2));
  // Dragging the bar between the page and the calculators.
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    const move = (ev: PointerEvent) => {
      const right = row.getBoundingClientRect().right;
      setWidth(
        Math.min(
          Math.max(360, right - ev.clientX),
          Math.max(360, Math.floor(row.clientWidth / 2)),
        ),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  const main = (
    <main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-20">
      <Suspense
        fallback={
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        }
      >
        <ClockWarning />
        <Outlet />
      </Suspense>
    </main>
  );
  return (
    <LiveProvider>
      <div className="flex h-dvh bg-background">
        <WarmCache />
        <DeviceRegistration />
        <HubSync />
        <SearchHotkeys />
        <SearchPalette />
        {desktop ? <DesktopSidebar /> : <MenuDrawer />}
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <Header />
          {/* The page stays in the same place in the tree whether or not the calculators are open. If it moved (as it did when a Splitter
            wrapped it), React would rebuild the page and a half-filled form would lose everything typed. */}
          <div ref={rowRef} className="flex min-h-0 flex-1">
            {main}
            {desktop && open ? (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Drag to resize the calculators"
                  tabIndex={0}
                  onPointerDown={startResize}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft")
                      setWidth((w) => Math.min(maxWidth(), w + 24));
                    if (e.key === "ArrowRight")
                      setWidth((w) => Math.max(360, w - 24));
                  }}
                  className="w-1.5 shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 focus-visible:bg-primary/60"
                />
                <aside
                  style={{ width }}
                  aria-label="Tools"
                  className="h-full shrink-0 overflow-hidden border-l border-border bg-card"
                >
                  <UtilityPanelBody onClose={() => setOpen(false)} />
                </aside>
              </>
            ) : null}
          </div>
          {!desktop && <MobileTabBar />}
          <UtilityButton />
          {!desktop && <QuickCameraButton variant="fab" />}
          {!desktop && <UtilitySheet />}
          {locked ? <LockScreen /> : null}
        </div>
      </div>
    </LiveProvider>
  );
}
