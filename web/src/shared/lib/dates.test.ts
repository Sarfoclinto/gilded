import { describe, expect, it } from "vitest";
import { ago, initials } from "./dates";

const now = new Date(2026, 9, 29, 15, 0);
describe("ago", () => {
  it("speaks in days, weeks and months", () => {
    expect(ago(new Date(2026, 9, 29, 6, 0).toISOString(), now)).toBe("Today");
    expect(ago(new Date(2026, 9, 28, 23, 59).toISOString(), now)).toBe(
      "Yesterday",
    );
    expect(ago(new Date(2026, 9, 24).toISOString(), now)).toBe("5 days ago");
    expect(ago(new Date(2026, 9, 1).toISOString(), now)).toBe("4 weeks ago");
    expect(ago(new Date(2026, 4, 20).toISOString(), now)).toBe("5 months ago");
    expect(ago(new Date(2024, 4, 20).toISOString(), now)).toBe(
      "Over a year ago",
    );
  });
});
describe("initials", () => {
  it("takes the first and last name", () => {
    expect(initials("Kofi Boateng")).toBe("KB");
    expect(initials("  ama  ")).toBe("A");
    expect(initials("Kwame Nkrumah Jr")).toBe("KJ");
    expect(initials("")).toBe("?");
  });
});
