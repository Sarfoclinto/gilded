import { useMemo, useState } from "react";
import { Drawer, Menu } from "antd";
import Sider from "antd/es/layout/Sider";
import { Link, useLocation } from "react-router-dom";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { useUI } from "@/store/ui";
import { appMenu } from "./menu";
import { filterMenu, openKeysFor, selectedKey, toAntd } from "./menuFilter";

const SIDEBAR_BG = "#0D1B2E";
const SIDEBAR_WIDTH = 232;

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className="flex items-center justify-center border-b border-white/10 px-5"
      style={{ height: 56, background: "#0A1628" }}
    >
      <Link
        to={paths.home.href}
        className="group flex items-center gap-x-3 no-underline"
      >
        <div
          className="grid size-9 shrink-0 place-items-center rounded-lg text-base font-bold"
          style={{
            background: "linear-gradient(135deg, #C9A84C, #E8C97A)",
            color: "#0D1B2E",
            fontFamily: "'Playfair Display', serif",
          }}
        >
          G
        </div>
        {!collapsed && (
          <div className="flex flex-col leading-none">
            <span
              className="text-sm font-bold uppercase text-white"
              style={{
                fontFamily: "'Playfair Display', serif",
                letterSpacing: "0.2em",
              }}
            >
              Gilded
            </span>
            <span
              className="mt-0.5 text-[8px] font-medium uppercase"
              style={{ color: "#C9A84C", letterSpacing: "0.2em" }}
            >
              Gold buying console
            </span>
          </div>
        )}
      </Link>
    </div>
  );
}

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);
  const items = useMemo(() => filterMenu(appMenu, user), [user]);
  const selected = selectedKey(pathname, items);
  const [openKeys, setOpenKeys] = useState<string[]>(() =>
    openKeysFor(selected, items),
  );

  return (
    <div
      className="m-0 flex h-full flex-col"
      style={{ background: SIDEBAR_BG }}
    >
      <Logo collapsed={collapsed} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <Menu
          theme="dark"
          mode="inline"
          className="app-sider"
          selectedKeys={selected ? [selected] : []}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={(k) => setOpenKeys(k as string[])}
          items={toAntd(items) as never}
          style={{ background: "transparent", border: "none" }}
        />
      </div>
    </div>
  );
}

/** Desktop: collapsible sider. */
export function DesktopSidebar() {
  const collapsed = useUI((s) => s.menuCollapsed);
  const setCollapsed = useUI((s) => s.setCollapsed);
  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      theme="dark"
      width={SIDEBAR_WIDTH}
      collapsedWidth={72}
      style={{
        background: SIDEBAR_BG,
        boxShadow: "4px 0 24px rgba(0,0,0,0.18)",
        position: "sticky",
        top: 0,
        height: "100dvh",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <SidebarContent collapsed={collapsed} />
    </Sider>
  );
}

/** Phone and tablet: the same menu in a drawer, opened from the "Menu" tab. */
export function MenuDrawer() {
  const open = useUI((s) => s.drawerOpen);
  const close = useUI((s) => s.closeDrawer);
  return (
    <Drawer
      open={open}
      onClose={close}
      placement="left"
      size={SIDEBAR_WIDTH}
      closable={false}
      styles={{
        body: { padding: 0, background: SIDEBAR_BG },
        section: { padding: 0 },
      }}
    >
      <SidebarContent collapsed={false} />
    </Drawer>
  );
}
