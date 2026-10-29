import { describe, expect, it } from "vitest";
import {
  filtersFromParams,
  pageText,
  paramsFromFilters,
  queryFromFilters,
} from "./search";

describe("customer filters in the address", () => {
  it("has sensible defaults", () => {
    expect(filtersFromParams(new URLSearchParams())).toEqual({
      q: "",
      filter: "all",
      sort: "name",
      page: 1,
      size: 20,
    });
  });
  it("round trips, writing only what differs from the defaults", () => {
    const f = {
      q: "kofi",
      filter: "owes_us" as const,
      sort: "paid" as const,
      page: 3,
      size: 50,
    };
    const sp = paramsFromFilters(f);
    expect(sp.toString()).toBe(
      "q=kofi&filter=owes_us&sort=paid&size=50&page=3",
    );
    expect(filtersFromParams(sp)).toEqual(f);
    expect(
      paramsFromFilters(filtersFromParams(new URLSearchParams())).toString(),
    ).toBe("");
  });
  it("ignores junk in the address", () => {
    expect(
      filtersFromParams(
        new URLSearchParams("filter=hax&sort=%27%3B&page=-4&size=7"),
      ),
    ).toMatchObject({ filter: "all", sort: "name", page: 1, size: 20 });
    expect(
      filtersFromParams(new URLSearchParams(`q=${"x".repeat(200)}`)).q,
    ).toHaveLength(60);
  });
  it("asks the server with an offset", () => {
    expect(
      queryFromFilters({
        q: "",
        filter: "active",
        sort: "recent",
        page: 3,
        size: 20,
      }),
    ).toEqual({ sort: "recent", filter: "active", limit: 20, offset: 40 });
  });
  it("says where the page is", () => {
    expect(pageText(2, 20, 45)).toBe("21–40 of 45");
    expect(pageText(1, 20, 0)).toBe("No customers");
  });
});
