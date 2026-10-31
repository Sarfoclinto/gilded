import { describe, expect, it } from "vitest";
import { checkExchange } from "./exchange";

const drawer = { "200": 10, "100": 5, "50": 40 };

describe("checkExchange", () => {
  it("accepts one 200 for two 100s", () => {
    expect(checkExchange({ "200": 1 }, { "100": 2 }, drawer)).toMatchObject({
      gaveTotal: 200,
      tookTotal: 200,
      remaining: 0,
      valid: true,
    });
  });
  it("must be worth exactly the same", () => {
    expect(checkExchange({ "200": 1 }, { "100": 1 }, drawer)).toMatchObject({
      remaining: 100,
      valid: false,
    });
    expect(checkExchange({ "200": 1 }, { "100": 3 }, drawer)).toMatchObject({
      remaining: -100,
      valid: false,
    });
  });
  it("needs different notes on each side", () => {
    expect(
      checkExchange({ "100": 2 }, { "100": 1, "50": 2 }, drawer),
    ).toMatchObject({ overlap: [100], valid: false });
  });
  it("cannot hand out notes the drawer does not hold", () => {
    const c = checkExchange({ "200": 1 }, { "100": 2 }, { "100": 1 });
    expect(c.short).toEqual({ "100": 1 });
    expect(c.valid).toBe(false);
  });
  it("does not limit by the drawer when it is not known", () => {
    expect(checkExchange({ "200": 1 }, { "100": 2 }, null).valid).toBe(true);
  });
  it("needs something on both sides", () => {
    expect(checkExchange({}, {}, drawer).valid).toBe(false);
    expect(checkExchange({ "200": 1 }, {}, drawer).valid).toBe(false);
  });
});
