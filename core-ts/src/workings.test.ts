import { describe, expect, it } from "vitest";
import {
  aggregate,
  evaluateSheet,
  formatValue,
  freeLabel,
  parseNote,
  referencesOf,
  refToken,
  upstreamOf,
  type WorkingDoc,
} from "./workings";

const note = (id: string, text: string) => ({ id, x: 0, y: 0, text });
const sheet = (...texts: string[]): WorkingDoc => ({
  notes: texts.map((t, i) => note(`n${i + 1}`, t)),
});
const value = (doc: WorkingDoc, id: string, env = {}) =>
  evaluateSheet(doc, env).get(id);

describe("reading a note", () => {
  it("reads a labelled figure with a unit", () => {
    expect(parseNote("Weight 12.4 g")).toEqual({
      kind: "figure",
      label: "Weight",
      value: "12.4",
      unit: "g",
    });
    expect(parseNote("Price: 1,210 GHS")).toEqual({
      kind: "figure",
      label: "Price",
      value: "1210",
      unit: "GHS",
    });
    expect(parseNote("Weight = 12.4g")).toEqual({
      kind: "figure",
      label: "Weight",
      value: "12.4",
      unit: "g",
    });
    expect(parseNote("Karat 18k")).toEqual({
      kind: "figure",
      label: "Karat",
      value: "18",
      unit: "karat",
    });
    expect(parseNote("Loss -200")).toEqual({
      kind: "figure",
      label: "Loss",
      value: "-200",
      unit: undefined,
    });
  });
  it("reads a bare figure, a plain note and a formula", () => {
    expect(parseNote("1,500")).toEqual({
      kind: "figure",
      label: undefined,
      value: "1500",
      unit: undefined,
    });
    expect(parseNote("rent")).toEqual({ kind: "text", label: "rent" });
    expect(parseNote("")).toEqual({ kind: "text" });
    expect(parseNote("= Weight × Price")).toEqual({
      kind: "formula",
      label: undefined,
      formula: "Weight × Price",
    });
    expect(parseNote("Total = Weight * 2")).toEqual({
      kind: "formula",
      label: "Total",
      formula: "Weight * 2",
    });
  });
});

describe("working out a sheet", () => {
  it("multiplies by pointing at labels, in either case, and keeps the money unit", () => {
    const d = sheet("Weight 12.4 g", "Price 1,210 GHS", "= weight × price");
    expect(value(d, "n3")).toEqual({
      value: "15004",
      unit: "GHS",
      uses: ["n1", "n2"],
    });
    expect(value(d, "n3")!.uses).toEqual(["n1", "n2"]);
  });
  it("keeps a unit through adding and says when units clash", () => {
    expect(value(sheet("a 2 g", "b 3 g", "= a + b"), "n3")!.value).toBe("5");
    expect(value(sheet("a 2 g", "b 3 g", "= a + b"), "n3")!.unit).toBe("g");
    expect(value(sheet("a 2 g", "b 3 GHS", "= a + b"), "n3")!.error).toBe(
      "Cannot add g and GHS.",
    );
  });
  it("is exact with money", () => {
    expect(value(sheet("= 0.1 + 0.2"), "n1")!.value).toBe("0.3");
    expect(value(sheet("= 1,000 / 3"), "n1")!.value).toMatch(/^333\.3333/);
    expect(value(sheet("= round(1000 / 3, 2)"), "n1")!.value).toBe("333.33");
    expect(value(sheet("= 10%  * 500"), "n1")!.value).toBe("50");
  });
  it("chains results by their own labels and reports what they use", () => {
    const d = sheet(
      "Weight 10 g",
      "Price 100",
      "Gross = Weight * Price",
      "Fee 5%",
      "Net = Gross - Gross * Fee",
    );
    const r = evaluateSheet(d);
    expect(r.get("n5")!.value).toBe("950");
    expect([...upstreamOf("n5", r)].sort()).toEqual(["n1", "n2", "n3", "n4"]);
  });
  it("handles functions, brackets around multi-word labels, and precedence", () => {
    const d = sheet(
      "Chain one 2.5 g",
      "Chain two 4 g",
      "= sum([Chain one], [Chain two])",
      "= max(Chain one, Chain two) * 2 + 1",
      "= avg(1, 2, 3)",
      "= 2 ^ 3 * 2",
    );
    expect(value(d, "n3")!.value).toBe("6.5");
    expect(value(d, "n3")!.unit).toBe("g");
    expect(value(d, "n4")!.value).toBe("9");
    expect(value(d, "n5")!.value).toBe("2");
    expect(value(d, "n6")!.value).toBe("16");
  });
  it("offers the gold helpers and the price of the day", () => {
    const d = sheet(
      "Weight 10 g",
      "Karat 18 k",
      "Pure = pure(Weight, Karat)",
      "= purity(18)",
      "Value = Pure * price",
      "= purity(30)",
    );
    const r = evaluateSheet(d, { pricePerGram: "1200" });
    expect(r.get("n3")!.value).toBe("7.5");
    expect(r.get("n3")!.unit).toBe("g");
    expect(r.get("n4")!.value).toBe("0.75");
    expect(r.get("n5")!.value).toBe("9000");
    expect(r.get("n5")!.unit).toBe("GHS");
    expect(r.get("n6")!.error).toBe("Karat must be between 0 and 24.");
    expect(value(sheet("= 2 * price"), "n1")!.error).toBe(
      "There is no price of the day to use.",
    );
  });
  it("explains what is wrong in plain words", () => {
    expect(value(sheet("= Weight * 2"), "n1")!.error).toBe(
      'There is no note called "Weight".',
    );
    expect(value(sheet("Weight", "= Weight * 2"), "n2")!.error).toBe(
      'There is no note called "Weight".',
    );
    expect(
      value(sheet("Weight 1", "Weight 2", "= Weight * 2"), "n3")!.error,
    ).toBe('Two notes are called "Weight". Give one of them another label.');
    expect(value(sheet("= 5 / 0"), "n1")!.error).toBe("Cannot divide by zero.");
    expect(value(sheet("= 2 +"), "n1")!.error).toBe(
      "The formula ends too soon.",
    );
    expect(value(sheet("= (2 + 3"), "n1")!.error).toBe("A ( has no closing ).");
    expect(value(sheet("= foo(2)"), "n1")!.error).toMatch(/not a function/);
    expect(value(sheet("= 2 $ 3"), "n1")!.error).toBe(
      '"$" is not something a formula understands.',
    );
  });
  it("spots a circle and a formula that leans on a broken one", () => {
    const d = sheet("A = B + 1", "B = A + 1", "C = B * 2");
    const r = evaluateSheet(d);
    expect(
      [r.get("n1")!.error, r.get("n2")!.error].some((e) =>
        e?.includes("circle"),
      ),
    ).toBe(true);
    expect(r.get("n3")!.error).toBe('"B" has a problem of its own.');
  });
});

describe("helpers for the screen", () => {
  it("formats with separators, at most four places, and the unit in its place", () => {
    expect(formatValue("15004.5")).toBe("15,004.5");
    expect(formatValue("333.333333", "GHS")).toBe("GHS 333.3333");
    expect(formatValue("-1234567", "g")).toBe("-1,234,567 g");
    expect(formatValue("0.1", "%")).toBe("0.1%");
  });
  it("totals a selection and knows when units are mixed", () => {
    const r = evaluateSheet(sheet("a 2 g", "b 4 g", "note", "= a + b"));
    expect(aggregate([r.get("n1"), r.get("n2"), r.get("n3")])).toEqual({
      count: 2,
      sum: "6",
      avg: "3",
      min: "2",
      max: "4",
      unit: "g",
      mixed: false,
    });
    expect(aggregate([r.get("n1"), r.get("n4"), r.get("n3")])!.unit).toBe("g");
    expect(aggregate([r.get("n3")])).toBeNull();
    const m = evaluateSheet(sheet("a 2 g", "b 4 GHS"));
    expect(aggregate([m.get("n1"), m.get("n2")])!.mixed).toBe(true);
  });
  it("writes a reference and finds a free label", () => {
    expect(refToken("Weight")).toBe("Weight");
    expect(refToken("Total payable")).toBe("Total payable");
    expect(refToken("Chain (big)")).toBe("[Chain (big)]");
    expect(refToken("sum")).toBe("[sum]");
    expect(referencesOf("Weight * [Chain (big)] + sum(a, b)")).toEqual([
      "Weight",
      "Chain (big)",
      "a",
      "b",
    ]);
    expect(freeLabel(sheet("Result = 1", "Result 2 = 2"))).toBe("Result 3");
  });
});
