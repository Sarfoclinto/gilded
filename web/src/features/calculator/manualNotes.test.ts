import { describe, expect, it } from "vitest";
import { checkManual, setCount } from "./manualNotes";

const stock = { "200": 100, "100": 50, "50": 20, "20": 10 };

describe("checkManual", () => {
  it("accepts notes that add up exactly and are in the drawer", () => {
    const c = checkManual({ "100": 100, "50": 100 }, 15000, {
      "100": 200,
      "50": 200,
    });
    expect(c).toMatchObject({ total: 15000, remaining: 0, valid: true });
  });
  it("turns a bundle of 200s into 100s and 50s", () => {
    const c = checkManual({ "200": 50, "100": 100 }, 20000, stock);
    expect(c.valid).toBe(false); // 10000 + 10000 = 20000 but only 50 hundreds in the drawer
    expect(c.overStock).toEqual({ "100": 50 });
    // half the bundle stays as 200s, the rest becomes 100s and 50s
    expect(
      checkManual({ "200": 50, "100": 50, "50": 100 }, 20000, {
        ...stock,
        "50": 200,
      }),
    ).toMatchObject({ remaining: 0, valid: true });
  });
  it("reports what is still to give or given too much", () => {
    expect(checkManual({ "100": 10 }, 1500, stock).remaining).toBe(500);
    expect(checkManual({ "100": 20 }, 1500, stock).remaining).toBe(-500);
  });
  it("refuses a note that is not in the drawer", () => {
    const c = checkManual({ "10": 5 }, 50, stock);
    expect(c.overStock).toEqual({ "10": 5 });
    expect(c.valid).toBe(false);
  });
  it("does not limit counts when the drawer is unknown (no open day)", () => {
    expect(checkManual({ "50": 3 }, 150, { "50": null }).valid).toBe(true);
  });
  it("never accepts nothing", () => {
    expect(checkManual({}, 0, stock).valid).toBe(false);
  });
});

describe("setCount", () => {
  it("sets, clamps and removes", () => {
    expect(setCount({}, 100, 3)).toEqual({ "100": 3 });
    expect(setCount({ "100": 3 }, 100, 0)).toEqual({});
    expect(setCount({}, 50, -4)).toEqual({});
  });
});

describe("checkManual with a money cap (note rule off)", () => {
  const unlimited = { "100": null, "50": null, "20": null } as const;
  it("accepts any notes that add up, up to what the drawer holds", () => {
    expect(checkManual({ "20": 5 }, 100, unlimited, 200).valid).toBe(true);
  });
  it("refuses more money than the drawer holds", () => {
    const c = checkManual({ "100": 3 }, 300, unlimited, 200);
    expect(c.overTotal).toBe(true);
    expect(c.valid).toBe(false);
  });
});
