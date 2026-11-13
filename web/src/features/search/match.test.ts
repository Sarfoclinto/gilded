import { describe, expect, it } from "vitest";
import {
  asAmount,
  asPhone,
  hasWords,
  highlight,
  phoneKey,
  rank,
  tidy,
  wordsOf,
} from "./match";

describe("reading what was typed", () => {
  it("tidies spaces, capitals and accents", () => {
    expect(tidy("  AMA   Sérwaa ")).toBe("ama serwaa");
    expect(wordsOf("Serwaa  ama")).toEqual(["serwaa", "ama"]);
  });

  it("a phone number is its last nine digits, whatever the format", () => {
    for (const p of [
      "0244 123 456",
      "+233244123456",
      "244-123-456",
      "(024) 412 3456",
    ])
      expect(phoneKey(p)).toBe("244123456");
    expect(asPhone("0244 12")).toBe("24412");
    expect(asPhone("+233 244")).toBe("244");
    expect(asPhone("ama 0244")).toBeNull();
    expect(asPhone("024")).toBeNull();
  });

  it("a number can be an amount", () => {
    expect(asAmount("8605")).toBe(8605);
    expect(asAmount("8,605.50")).toBe(8605.5);
    expect(asAmount("8")).toBeNull();
    expect(asAmount("tkw-0003")).toBeNull();
  });

  it("every word must be found, in any order", () => {
    expect(hasWords("Ama Serwaa 0244123456", ["serwaa", "ama"])).toBe(true);
    expect(hasWords("Ama Serwaa", ["ama", "kofi"])).toBe(false);
    expect(hasWords("Ama", [])).toBe(false);
  });
});

describe("showing the match", () => {
  const marked = (text: string, q: string) =>
    highlight(text, q)
      .filter((p) => p.hit)
      .map((p) => p.text);

  it("marks each word where it sits", () => {
    expect(marked("Ama Serwaa", "serw am")).toEqual(["Am", "Serw"]);
    expect(highlight("Kofi", "ama")).toEqual([{ text: "Kofi", hit: false }]);
  });

  it("marks a phone number inside its formatting", () => {
    expect(marked("0244 123 456", "+233 244 123")).toEqual(["244 123"]);
    expect(marked("0244123456", "0244123456")).toEqual(["0244123456"]);
  });

  it("never returns pieces that do not add up to the text", () => {
    for (const [t, q] of [
      ["TKW-20261112-0003", "0003"],
      ["Áma Sérwaa", "ama"],
      ["", "x"],
      ["Ama", ""],
    ] as const) {
      expect(
        highlight(t, q)
          .map((p) => p.text)
          .join(""),
      ).toBe(t);
    }
  });
});

describe("ranking", () => {
  it("exact, then starts with, then a word starts with, then found somewhere", () => {
    expect(rank("Close the day", "close the day")).toBe(100);
    expect(rank("Close the day", "close")).toBe(90);
    expect(rank("Cash drawer", "drawer")).toBe(80);
    expect(rank("Debts and loans", "oans deb")).toBe(70);
    expect(rank("Customers", "transfer")).toBe(0);
  });
});
