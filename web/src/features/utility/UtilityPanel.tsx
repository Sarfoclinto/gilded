import { useState } from "react";
import { Drawer, Segmented } from "antd";
import { Calculator, X } from "lucide-react";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { CalculatorBody } from "@/features/calculator/CalculatorPage";
import { PayoutPanel } from "@/features/calculator/PayoutPanel";
import { TextField } from "@/shared/ui/TextField";
import { decimalOnly } from "@/shared/lib/numbers";
import { useUtilityPanel } from "./store";

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
  const [tab, setTab] = useState<"calculator" | "notes">("calculator");
  return (
    <div className="space-y-4 p-4">
      <Segmented
        block
        value={tab}
        onChange={(v) => setTab(v as "calculator" | "notes")}
        options={[
          { label: "Calculator", value: "calculator" },
          { label: "Notes", value: "notes" },
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
    </div>
  );
}

export function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      <h2 className={`text-base font-semibold`}>Calculators</h2>
      <button
        type="button"
        aria-label="Close calculators"
        className="grid size-11 place-items-center rounded-lg hover:bg-muted"
        onClick={onClose}
      >
        <X className={`size-5 `} />
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
      aria-label="Open calculators"
      onClick={toggle}
      className={`fixed right-4 z-30 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ${desktop ? "bottom-6" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"}`}
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
      styles={{
        body: { padding: 0, backgroundColor: "var(--background)" },
      }}
    >
      <PanelHeader onClose={() => setOpen(false)} />
      <UtilityContent />
    </Drawer>
  );
}
