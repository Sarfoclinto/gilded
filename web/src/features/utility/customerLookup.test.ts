import { describe, expect, it } from "vitest";
import { planLookup, sumWeights } from "./customerLookup";
import { hasLookup, useCustomerLookup, useUtilityPanel } from "./store";

describe("planLookup", () => {
  it("nothing typed: nothing to look up", () => {
    expect(planLookup(null)).toEqual({ mode: "none" });
    expect(planLookup({ id: null, name: " ", phone: "" })).toEqual({
      mode: "none",
    });
    expect(planLookup({ id: null, name: "A", phone: "024" })).toEqual({
      mode: "none",
    });
  });
  it("a picked customer is looked up by id", () => {
    expect(planLookup({ id: "c1", name: "Kofi", phone: "" })).toEqual({
      mode: "picked",
      customerId: "c1",
      label: "Kofi",
    });
  });
  it("a typed phone wins over a typed name; a short phone does not count", () => {
    expect(
      planLookup({ id: null, name: "Kofi", phone: "024 123 4567" }),
    ).toEqual({ mode: "typed", q: "024 123 4567", label: "024 123 4567" });
    expect(planLookup({ id: null, name: "Kofi", phone: "024" })).toEqual({
      mode: "typed",
      q: "Kofi",
      label: "Kofi",
    });
  });
});

describe("sumWeights", () => {
  it("adds weights", () =>
    expect(sumWeights(["10.5", "2.25", "x"])).toBe("12.75"));
});

describe("the panel button", () => {
  it("opens on the customer tab only when a customer is being worked on", () => {
    useCustomerLookup.getState().set(null);
    useUtilityPanel.setState({ open: false, tab: "cash" });
    useUtilityPanel.getState().toggle();
    expect(useUtilityPanel.getState()).toMatchObject({
      open: true,
      tab: "cash",
    });
    useUtilityPanel.setState({ open: false });
    useCustomerLookup.getState().set({ id: null, name: "Kofi", phone: "" });
    expect(hasLookup(useCustomerLookup.getState().customer)).toBe(true);
    useUtilityPanel.getState().toggle();
    expect(useUtilityPanel.getState()).toMatchObject({
      open: true,
      tab: "customer",
    });
  });
});
