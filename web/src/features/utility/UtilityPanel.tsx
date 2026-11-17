import { lazy, Suspense, useEffect, useState } from "react";
import { Drawer, Segmented } from "antd";
import { Calculator, X } from "lucide-react";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { CalculatorBody } from "@/features/calculator/CalculatorPage";
import { CashBody } from "@/features/cash/CashBody";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { PERMISSIONS } from "@/config/permissions";
import { useSettings } from "@/features/settings/api";
import { PayoutPanel } from "@/features/calculator/PayoutPanel";
import { TextField } from "@/shared/ui/TextField";
import { decimalOnly } from "@/shared/lib/numbers";
import { ClosingStatus } from "./ClosingStatus";

import { CustomerHistory } from "./CustomerHistory";
import { useUtilityPanel, type UtilityTab } from "./store";

// The charts are only fetched when the Market tab is first opened, so they do not weigh on every screen.
// the sheet is only loaded when the tab is first opened
const WorkingsQuick = lazy(() =>
  import("@/features/workings/WorkingsQuick").then((m) => ({
    default: m.WorkingsQuick,
  })),
);
const MarketQuick = lazy(() =>
  import("@/features/market/MarketQuick").then((m) => ({
    default: m.MarketQuick,
  })),
);

/** Nominations: type an amount, see the notes to hand out. Uses the open drawer's notes when there is one. */
function NominationsBody() {
  const [amount, setAmount] = useState("");
  const n = Number(amount);
  return (
    <div className="space-y-4">
      <TextField
        label="Amount (GHS)"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(decimalOnly(e.target.value))}
      />
      {n > 0 ? (
        <PayoutPanel amount={n} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Enter an amount to see the notes.
        </p>
      )}
    </div>
  );
}

/** The panel content: the same calculators as the pages, working beside whatever page is open. Nothing here saves by itself. */
export function UtilityContent() {
  // The tab lives in the store so the button can send the person straight to the customer's history.
  const { tab, setTab } = useUtilityPanel();
  const canSeeCash = useHasPermission(PERMISSIONS.DAYS_READ);
  const workingsOn = useSettings()["workings.enabled"];
  const [seenSheet, setSeenSheet] = useState(false);
  useEffect(() => {
    if (tab === "workings") setSeenSheet(true);
  }, [tab]);
  return (
    <div className="space-y-4 p-4">
      {/* Six tabs in a narrow panel: each takes the room its word needs (not equal widths), in smaller type, so no name is cut off. */}
      <Segmented
        className="w-full [&_.ant-segmented-group]:justify-between [&_.ant-segmented-item-label]:!px-2 [&_.ant-segmented-item-label]:!text-xs"
        value={
          (tab === "cash" || tab === "closing") && !canSeeCash
            ? "calculator"
            : tab
        }
        onChange={(v) => setTab(v as UtilityTab)}
        options={[
          { label: "Calculator", value: "calculator" },
          { label: "Notes", value: "notes" },
          { label: "Customer", value: "customer" },
          ...(canSeeCash
            ? [
                { label: "Cash", value: "cash" },
                { label: "Closing", value: "closing" },
              ]
            : []),
          { label: "Market", value: "market" },
          ...(workingsOn ? [{ label: "Sheet", value: "workings" }] : []),
        ]}
      />
      {/* Both stay mounted so switching tabs keeps what was typed. */}
      <div hidden={tab !== "calculator"}>
        <CalculatorBody
          onSaveAsPurchase={() => useUtilityPanel.getState().setOpen(false)}
        />
      </div>
      <div hidden={tab !== "notes"}>
        <NominationsBody />
      </div>
      {/* Mounted only while looked at, so opening the tab asks for fresh figures. */}
      {tab === "cash" && canSeeCash && <CashBody />}
      {tab === "customer" && <CustomerHistory />}
      {tab === "closing" && canSeeCash && <ClosingStatus />}
      {/* Mounted only while looked at: the world chart is an outside service and should not load in the background. */}
      {/* Kept mounted once opened, so an open sheet survives switching tabs. */}
      {workingsOn && (tab === "workings" || seenSheet) ? (
        <div hidden={tab !== "workings"}>
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">
                Loading your sheets…
              </p>
            }
          >
            <WorkingsQuick />
          </Suspense>
        </div>
      ) : null}
      {tab === "market" && (
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">Loading the market…</p>
          }
        >
          <MarketQuick />
        </Suspense>
      )}
    </div>
  );
}

export function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      <h2 className="text-base font-semibold">Tools</h2>
      <button
        type="button"
        aria-label="Close tools"
        className="grid size-11 place-items-center rounded-lg hover:bg-muted"
        onClick={onClose}
      >
        <X className="size-5" />
      </button>
    </div>
  );
}

/** Floating button that opens the panel (a bottom sheet on phones and tablets). */
export function UtilityButton() {
  const desktop = useIsDesktop();
  const { open, toggle } = useUtilityPanel();
  if (open && desktop) return null;
  return (
    <button
      type="button"
      aria-label="Open tools"
      onClick={toggle}
      className={`fixed right-4 z-30 print:hidden grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ${desktop ? "bottom-6" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"}`}
    >
      <Calculator className="size-5" />
    </button>
  );
}

/** Phone and tablet: a bottom sheet. */
export function UtilitySheet() {
  const { open, setOpen } = useUtilityPanel();
  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom"
      size="82dvh"
      closable={false}
      title={null}
      styles={{ body: { padding: 0 } }}
    >
      <PanelHeader onClose={() => setOpen(false)} />
      <UtilityContent />
    </Drawer>
  );
}
