import { ConfigProvider } from "antd";
import type { PropsWithChildren } from "react";

// Tokens from SchoolMate's theme: deep navy sidebar, gold selection.
const SIDEBAR_BG = "#0D1B2E";

export function AntdConfig({ children }: PropsWithChildren) {
  return (
    <ConfigProvider
      theme={{
        token: {
          fontFamily: "'DM Sans', sans-serif",
          borderRadius: 8,
          colorPrimary: "#1e3a5f",
        },
        components: {
          Menu: {
            darkItemBg: SIDEBAR_BG,
            darkSubMenuItemBg: "rgba(0,0,0,0.15)",
            darkItemSelectedBg: "rgba(201,168,76,0.15)",
            darkItemHoverBg: "rgba(255,255,255,0.06)",
            darkItemHoverColor: "#ffffff",
            darkItemColor: "#ffffff",
            darkItemSelectedColor: "#ffffff",
            darkGroupTitleColor: "rgba(255,255,255,0.3)",
            darkPopupBg: "#122240",
            iconSize: 15,
            iconMarginInlineEnd: 10,
            itemHeight: 44,
            itemMarginBlock: 1,
            itemMarginInline: 8,
            itemBorderRadius: 8,
            fontSize: 13,
          },
          Drawer: {
            // colorBgElevated: SIDEBAR_BG ,
            colorBgElevated: "var(--background)",
          },
          Tooltip: {
            colorBgSpotlight: "#132338",
            colorTextLightSolid: "#ffffff",
            borderRadius: 6,
            fontSize: 12,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
