import { describe, expect, it } from "vitest";
import {
  draftKey,
  DRAFT_MAX_AGE_MS,
  isMeaningful,
  usableDraft,
  type PurchaseDraft,
} from "./draft";

const blank = (): PurchaseDraft => ({
  txId: "t",
  newCustomerId: "c",
  customer: { id: null, name: "", phone: "" },
  rep: null,
  town: null,
  items: [
    {
      id: "i",
      label: "lump",
      top: "",
      down: "",
      price: "11244",
      priceTouched: false,
    },
  ],
  parts: [],
  savedAt: new Date("2026-11-02T10:00:00Z").toISOString(),
});
const NOW = Date.parse("2026-11-02T11:00:00Z");

describe("purchase drafts", () => {
  it("an untouched form (even with today's price filled in) is not a draft", () => {
    expect(isMeaningful(blank())).toBe(false);
    expect(usableDraft(blank(), NOW)).toBeNull();
  });
  it("a name, a weight, a town or a split makes it worth keeping", () => {
    expect(
      isMeaningful({
        ...blank(),
        customer: { id: null, name: "Kofi", phone: "" },
      }),
    ).toBe(true);
    expect(
      isMeaningful({
        ...blank(),
        items: [{ ...blank().items[0]!, top: "61.5" }],
      }),
    ).toBe(true);
    expect(
      isMeaningful({ ...blank(), town: { id: "x", name: "Obuasi" } }),
    ).toBe(true);
  });
  it("is offered while fresh and dropped after the working day", () => {
    const d = { ...blank(), customer: { id: null, name: "Kofi", phone: "" } };
    expect(usableDraft(d, NOW)).toBe(d);
    expect(
      usableDraft(d, Date.parse(d.savedAt) + DRAFT_MAX_AGE_MS + 1),
    ).toBeNull();
    expect(usableDraft({ ...d, savedAt: "garbage" }, NOW)).toBeNull();
  });
  it("is kept per person and branch", () => {
    expect(draftKey("u1", "b1")).toBe("u1:b1");
    expect(draftKey(null, "b1")).toBeNull();
  });
});
