import { DEFAULT_SETTINGS, useSettings } from "@/features/settings/api";
import { usePersonalSettings } from "@/features/settings/personal";

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

/** Used until the company has written its own. */
export const FALLBACK_NAME = "Gold Buyers";

/** What the receipt shows: the company's details and paper, with this desk's own choices on top. */
export function useReceiptSettings(): ReceiptSettings {
  const company = useSettings();
  const mine = usePersonalSettings();
  return buildReceiptSettings(company, mine);
}

export function buildReceiptSettings(
  company: typeof DEFAULT_SETTINGS,
  mine: Pick<
    ReturnType<typeof usePersonalSettings.getState>,
    "receiptPaper" | "showQr" | "showWeights"
  >,
): ReceiptSettings {
  return {
    paper:
      mine.receiptPaper === "company"
        ? company["receipt.paper"]
        : mine.receiptPaper,
    showQr: mine.showQr,
    showWeights: mine.showWeights,
    businessName: company["receipt.businessName"].trim() || FALLBACK_NAME,
    tagline: company["receipt.tagline"].trim() || "Gold purchase receipt",
    address: company["receipt.address"].trim(),
    phone: company["receipt.phone"].trim(),
    footer:
      company["receipt.footer"].trim() ||
      "Keep this receipt. Thank you for trading with us.",
  };
}
