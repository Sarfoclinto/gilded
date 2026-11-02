import { describe, expect, it } from "vitest";
import {
  blocksSchema,
  cleanBlocks,
  isBlank,
  newBlock,
  parseInline,
  readMinutes,
  toggleMark,
  type Block,
} from "./blocks";

describe("inline formatting", () => {
  it("reads bold and italic", () => {
    expect(parseInline("Never share **one** customer’s *details*.")).toEqual([
      { text: "Never share ", bold: false, italic: false },
      { text: "one", bold: true, italic: false },
      { text: " customer’s ", bold: false, italic: false },
      { text: "details", bold: false, italic: true },
      { text: ".", bold: false, italic: false },
    ]);
  });
  it("shows a stray mark as typed instead of swallowing the sentence", () => {
    expect(parseInline("5 * 3 is fifteen")).toEqual([
      { text: "5 * 3 is fifteen", bold: false, italic: false },
    ]);
    expect(parseInline("**open")).toEqual([
      { text: "**open", bold: false, italic: false },
    ]);
  });
  it("never produces anything but text (no markup is interpreted)", () => {
    expect(parseInline("<script>alert(1)</script>")[0]!.text).toBe(
      "<script>alert(1)</script>",
    );
  });
});

describe("the bold and italic buttons", () => {
  it("wraps the selection and unwraps it again", () => {
    const a = toggleMark("Never share details", 6, 11, "**");
    expect(a.text).toBe("Never **share** details");
    expect(a.text.slice(a.start, a.end)).toBe("share");
    const b = toggleMark(a.text, a.start, a.end, "**");
    expect(b.text).toBe("Never share details");
  });
  it("does nothing with nothing selected", () => {
    expect(toggleMark("abc", 1, 1, "*").text).toBe("abc");
  });
});

describe("blocks", () => {
  it("skips a block it does not know instead of failing", () => {
    const r = blocksSchema.parse([
      { type: "heading", text: "A" },
      { type: "hologram" },
      { type: "divider" },
    ]);
    expect(r).toHaveLength(2);
  });
  it("drops blank blocks and trims when saving", () => {
    const blocks: Block[] = [
      { type: "heading", text: "  Privacy " },
      newBlock("text"),
      { type: "list", style: "donts", items: ["Show a screen", "  "] },
      newBlock("divider"),
      newBlock("image"),
    ];
    const out = cleanBlocks(blocks);
    expect(out).toEqual([
      { type: "heading", text: "Privacy" },
      { type: "list", style: "donts", items: ["Show a screen"] },
      { type: "divider" },
    ]);
    expect(isBlank(newBlock("flow"))).toBe(true);
  });
  it("estimates a reading time of at least a minute", () => {
    expect(readMinutes([{ type: "text", text: "short" }])).toBe(1);
    expect(
      readMinutes([{ type: "text", text: Array(600).fill("word").join(" ") }]),
    ).toBe(3);
  });
});

import { fitWithin } from "./image";
describe("picture sizing", () => {
  it("shrinks the longest side to the limit and keeps the shape", () => {
    expect(fitWithin(3200, 1600)).toEqual({ w: 1600, h: 800 });
    expect(fitWithin(800, 3200)).toEqual({ w: 400, h: 1600 });
  });
  it("never scales a small picture up", () => {
    expect(fitWithin(500, 300)).toEqual({ w: 500, h: 300 });
  });
});
