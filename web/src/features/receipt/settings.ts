import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PaperSize = "80" | "58" | "a4";

/** `page` is '' for rolls: browsers cannot size a page by its content, so the printer's own roll size applies (a desktop shell can pass the exact size when it prints). */
export const PAPER: Record<
  PaperSize,
  { label: string; widthMm: number | null; page: string }
> = {
  "80": { label: "Receipt roll, 80 mm", widthMm: 80, page: "" },
  "58": { label: "Receipt roll, 58 mm", widthMm: 58, page: "" },
  a4: { label: "A4 sheet", widthMm: null, page: "A4" },
};

export interface ReceiptSettings {
  paper: PaperSize;
  showQr: boolean;
  /** Show top, down and density per item (the long form the team writes on the sticky note). */
  showWeights: boolean;
  businessName: string;
  tagline: string;
  address: string;
  phone: string;
  footer: string;
}

interface ReceiptSettingsState extends ReceiptSettings {
  update: (patch: Partial<ReceiptSettings>) => void;
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  paper: "80",
  showQr: true,
  showWeights: true,
  businessName: "Gilded Gold Buyers",
  tagline: "Gold purchase receipt",
  address: "",
  phone: "",
  footer: "Keep this receipt. Thank you for trading with us.",
};

/**
 * Kept on this device until the company settings page exists; then these become company-wide values set by an admin
 * and this store only remembers the paper size of the printer at this desk.
 */
export const useReceiptSettings = create<ReceiptSettingsState>()(
  persist(
    (set) => ({ ...DEFAULT_RECEIPT_SETTINGS, update: (patch) => set(patch) }),
    { name: "gold.receipt.v1", partialize: ({ update: _u, ...rest }) => rest },
  ),
);
