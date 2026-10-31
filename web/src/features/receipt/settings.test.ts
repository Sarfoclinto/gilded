import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/settings/api";
import { DEFAULT_PERSONAL } from "@/features/settings/personal";
import { buildReceiptSettings, FALLBACK_NAME } from "./settings";

describe("receipt settings", () => {
  it("uses the company paper unless the desk chose its own", () => {
    expect(
      buildReceiptSettings(
        { ...DEFAULT_SETTINGS, "receipt.paper": "a4" },
        DEFAULT_PERSONAL,
      ).paper,
    ).toBe("a4");
    expect(
      buildReceiptSettings(
        { ...DEFAULT_SETTINGS, "receipt.paper": "a4" },
        { ...DEFAULT_PERSONAL, receiptPaper: "58" },
      ).paper,
    ).toBe("58");
  });
  it("fills in a name and footer until the company writes its own", () => {
    const r = buildReceiptSettings(DEFAULT_SETTINGS, DEFAULT_PERSONAL);
    expect(r.businessName).toBe(FALLBACK_NAME);
    expect(r.footer).toMatch(/Thank you/);
    expect(
      buildReceiptSettings(
        { ...DEFAULT_SETTINGS, "receipt.businessName": "  Golden Fleece " },
        DEFAULT_PERSONAL,
      ).businessName,
    ).toBe("Golden Fleece");
  });
});
