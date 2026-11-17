import { lazy, Suspense, useEffect, useState } from "react";
import { Drawer } from "antd";
import {
  Banknote,
  Calculator,
  ClipboardCheck,
  LineChart,
  Sigma,
  UserRoundSearch,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
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
import {
  hasLookup,
  useCustomerLookup,
  useUtilityPanel,
  type UtilityTab,
} from "./store";

// The sheet and the charts are only fetched when their tool is first opened, so they do not weigh on every screen.
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

interface Tool {
  key: UtilityTab;
  label: string;
  title: string;
  hint: string;
  icon: LucideIcon;
}

const TOOLS: Tool[] = [
  {
    key: "calculator",
    label: "Value",
    title: "Value gold",
    hint: "Value gold beside any page. Save it as a purchase when you are ready.",
    icon: Calculator,
  },
  {
    key: "notes",
    label: "Notes",
    title: "Notes to hand out",
    hint: "Type an amount to see which notes to give, from what the drawer holds.",
    icon: Banknote,
  },
  {
    key: "customer",
    label: "Customer",
    title: "Customer history",
    hint: "What the customer you are working on has sold, owes and leaves with us.",
    icon: UserRoundSearch,
  },
  {
    key: "cash",
    label: "Cash",
    title: "Cash in the drawer",
    hint: "The drawer right now, note by note.",
    icon: Wallet,
  },
  {
    key: "closing",
    label: "Closing",
    title: "Closing status",
    hint: "Where today stands before the day is closed.",
    icon: ClipboardCheck,
  },
  {
    key: "market",
    label: "Market",
    title: "Gold market",
    hint: "Our price over time and the world price. For watching only, never for valuing.",
    icon: LineChart,
  },
  {
    key: "workings",
    label: "Sheet",
    title: "Workings",
    hint: "A scratch sheet beside this page. Select a result and tap Copy.",
    icon: Sigma,
  },
];

/** The tools this person has: Cash and Closing need the drawer permission, Sheet needs Workings switched on. */
function useTools() {
  const canSeeCash = useHasPermission(PERMISSIONS.DAYS_READ);
  const workingsOn = useSettings()["workings.enabled"];
  return TOOLS.filter((t) =>
    t.key === "cash" || t.key === "closing"
      ? canSeeCash
      : t.key === "workings"
        ? workingsOn
        : true,
  );
}

/**
 * The tool rail: a column of tools down the left of the panel, in the navy of the main menu, with a gold bar on the one in use.
 * It never scrolls sideways however many tools there are; arrow keys move between them.
 */
function ToolRail({
  tools,
  active,
  onPick,
  onClose,
}: {
  tools: Tool[];
  active: UtilityTab;
  onPick: (t: UtilityTab) => void;
  onClose: () => void;
}) {
  const customer = useCustomerLookup((s) => s.customer);
  const working = hasLookup(customer);
  const move = (e: React.KeyboardEvent, i: number) => {
    const next =
      e.key === "ArrowDown"
        ? i + 1
        : e.key === "ArrowUp"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tools.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const t = tools[(next + tools.length) % tools.length]!;
    onPick(t.key);
    (
      e.currentTarget.parentElement?.querySelector(
        `[data-tool="${t.key}"]`,
      ) as HTMLElement | null
    )?.focus();
  };
  return (
    <nav
      aria-label="Tools"
      className="flex w-[4.25rem] shrink-0 flex-col items-stretch gap-1 overflow-y-auto bg-navy px-1.5 pb-3 pt-2"
    >
      <button
        type="button"
        aria-label="Close tools"
        onClick={onClose}
        className="mx-auto mb-2 grid size-10 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-gold"
      >
        <X className="size-5" aria-hidden />
      </button>
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Tools"
        className="flex flex-col gap-1"
      >
        {tools.map((t, i) => {
          const on = t.key === active;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              data-tool={t.key}
              aria-selected={on}
              aria-controls={`tool-${t.key}`}
              tabIndex={on ? 0 : -1}
              title={t.title}
              onClick={() => onPick(t.key)}
              onKeyDown={(e) => move(e, i)}
              className={`group relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10.5px] font-medium leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold ${on ? "bg-white/10 text-gold" : "text-white/65 hover:bg-white/5 hover:text-white"}`}
            >
              <span
                aria-hidden
                className={`absolute left-[-6px] top-2 bottom-2 w-[3px] rounded-r-full bg-gold transition-opacity ${on ? "opacity-100" : "opacity-0"}`}
              />
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {t.key === "customer" && working ? (
                  <span
                    className="absolute -right-1 -top-1 size-2 rounded-full bg-gold ring-2 ring-navy"
                    aria-label="A customer is being worked on"
                  />
                ) : null}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The panel: the rail on the left and the tool on the right. The same calculators as the pages, working beside whatever page is open.
 * Nothing here saves by itself.
 */
export function UtilityPanelBody({ onClose }: { onClose: () => void }) {
  // The tab lives in the store so the floating button can send the person straight to the customer's history.
  const { tab, setTab } = useUtilityPanel();
  const tools = useTools();
  const active = tools.some((t) => t.key === tab) ? tab : "calculator";
  const tool = tools.find((t) => t.key === active) ?? tools[0]!;
  const [seenSheet, setSeenSheet] = useState(false);
  useEffect(() => {
    if (active === "workings") setSeenSheet(true);
  }, [active]);
  const has = (k: UtilityTab) => tools.some((t) => t.key === k);
  return (
    <div className="flex h-full min-h-0">
      <ToolRail
        tools={tools}
        active={active}
        onPick={setTab}
        onClose={onClose}
      />
      <section
        id={`tool-${active}`}
        role="tabpanel"
        aria-label={tool.title}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="border-b border-border px-4 pb-3 pt-4">
          <h2 className="font-display text-xl font-semibold leading-tight text-navy">
            {tool.title}
          </h2>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {tool.hint}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {/* Calculator and notes stay mounted so switching tools keeps what was typed. */}
          <div hidden={active !== "calculator"}>
            <CalculatorBody
              onSaveAsPurchase={() => useUtilityPanel.getState().setOpen(false)}
            />
          </div>
          <div hidden={active !== "notes"}>
            <NominationsBody />
          </div>
          {/* Mounted only while looked at, so opening the tool asks for fresh figures. */}
          {active === "cash" && has("cash") && <CashBody />}
          {active === "customer" && <CustomerHistory />}
          {active === "closing" && has("closing") && <ClosingStatus />}
          {/* Kept mounted once opened, so an open sheet survives switching tools. */}
          {has("workings") && (active === "workings" || seenSheet) ? (
            <div hidden={active !== "workings"}>
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
          {/* Mounted only while looked at: the world chart is an outside service and should not load in the background. */}
          {active === "market" && (
            <Suspense
              fallback={
                <p className="text-sm text-muted-foreground">
                  Loading the market…
                </p>
              }
            >
              <MarketQuick />
            </Suspense>
          )}
        </div>
      </section>
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
      size="85dvh"
      closable={false}
      title={null}
      styles={{
        body: { padding: 0, overflow: "hidden" },
        content: {
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          overflow: "hidden",
        },
      }}
    >
      <UtilityPanelBody onClose={() => setOpen(false)} />
    </Drawer>
  );
}
