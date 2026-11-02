import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PaperSize } from "@/features/receipt/settings";

/**
 * A person's own settings. Kept on this device (a desk has its own printer and its own habits), never sent to the server.
 * They only ever adjust what the company chose; they cannot turn off a company rule.
 */
export interface PersonalSettings {
  /** 'company': follow the company's paper. Otherwise the paper of the printer at this desk. */
  receiptPaper: PaperSize | "company";
  /** After saving a purchase: follow the company's printer setting, always open the receipt, or never. */
  openReceipt: "company" | "always" | "never";
  showQr: boolean;
  /** Top, down and density on the receipt, as on the sticky note. */
  showWeights: boolean;
  /** After saving a purchase: open it (as before), or stay on a fresh New transaction page to keep going. */
  afterSave: "detail" | "new";
  /** The note mix the payout starts with on each new purchase. */
  noteStrategy: "prefer-100s" | "fewest-notes";
  /** Play a short ring when a notification arrives. */
  notifySound: boolean;
  /** How a purchase is entered: the compact form (classic) or big inputs with a big result (focus). */
  purchaseLayout: "classic" | "focus";
  /** On touch screens in the Focus design, type numbers on the on-screen pad instead of the phone's keyboard. */
  keypad: boolean;
}

interface State extends PersonalSettings {
  update: (patch: Partial<PersonalSettings>) => void;
}

export const DEFAULT_PERSONAL: PersonalSettings = {
  receiptPaper: "company",
  openReceipt: "company",
  showQr: true,
  showWeights: true,
  afterSave: "detail",
  noteStrategy: "prefer-100s",
  notifySound: true,
  purchaseLayout: "classic",
  keypad: true,
};

export const usePersonalSettings = create<State>()(
  persist((set) => ({ ...DEFAULT_PERSONAL, update: (patch) => set(patch) }), {
    name: "gold.me.v1",
    partialize: ({ update: _u, ...rest }) => rest,
  }),
);

/** Whether to open the receipt right after a purchase is saved. */
export const opensReceipt = (
  mine: PersonalSettings["openReceipt"],
  companyUsesPrinter: boolean,
) => (mine === "company" ? companyUsesPrinter : mine === "always");
