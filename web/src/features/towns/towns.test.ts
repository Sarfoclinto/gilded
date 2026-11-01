import { describe, expect, it } from "vitest";
import { allTowns, searchTowns, tidyTown, townKey } from "./towns";

const list = [
  { id: "1", name: "Obuasi", uses: 9 },
  { id: "2", name: "Wassa Akropong", uses: 4 },
  { id: "3", name: "Dunkwa on Offin", uses: 2 },
];

describe("towns", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(townKey(" O-buasi ")).toBe(townKey("obuasi"));
    expect(townKey("Wassa  Akropong")).toBe("wassaakropong");
  });
  it("tidies a typed name", () => {
    expect(tidyTown("  Wassa   Akropong ")).toBe("Wassa Akropong");
  });
  it("finds by start first, then anywhere, keeping most used first", () => {
    expect(searchTowns(list, "ob").map((t) => t.name)).toEqual(["Obuasi"]);
    expect(searchTowns(list, "akro").map((t) => t.name)).toEqual([
      "Wassa Akropong",
    ]);
    expect(searchTowns(list, "o").map((t) => t.name)).toEqual([
      "Obuasi",
      "Wassa Akropong",
      "Dunkwa on Offin",
    ]);
    expect(searchTowns(list, "").length).toBe(3);
    expect(searchTowns(list, "zzz")).toEqual([]);
  });
  it("does not list a town added here twice once the server has it", () => {
    const merged = allTowns(list, [
      { id: "x", name: "obuasi" },
      { id: "y", name: "Prestea" },
    ]);
    expect(merged.map((t) => t.name)).toEqual([
      "Obuasi",
      "Wassa Akropong",
      "Dunkwa on Offin",
      "Prestea",
    ]);
  });
});
