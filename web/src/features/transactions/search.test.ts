import { describe, expect, it } from "vitest";
import {
  appliedFilters,
  filtersFromParams,
  hiddenFilterCount,
  pageText,
  paramsFromFilters,
  queryFromFilters,
} from "./search";

const parse = (s: string) => filtersFromParams(new URLSearchParams(s));
const today = new Date(2026, 9, 29); // 29 Oct 2026 (local)

describe("transaction filters in the address", () => {
  it("has sensible defaults and keeps the address clean", () => {
    const f = parse("");
    expect(f).toMatchObject({
      range: "30d",
      sort: "newest",
      page: 1,
      size: 25,
      q: "",
    });
    expect(paramsFromFilters(f).toString()).toBe("");
  });

  it("round-trips what differs from the defaults", () => {
    const f = parse(
      "q=kofi&range=custom&from=2026-10-01&to=2026-10-15&status=void&flagged=1&min=100&max=900&sort=amount_desc&size=50&page=3",
    );
    expect(parse(paramsFromFilters(f).toString())).toEqual(f);
  });

  it("ignores junk", () => {
    const f = parse(
      "range=forever&sort=sideways&page=-4&size=7&status=gone&min=abc&from=yesterday",
    );
    expect(f).toMatchObject({
      range: "30d",
      sort: "newest",
      page: 1,
      size: 25,
      status: "",
      min: "",
      from: "",
    });
  });

  it("turns ranges into dates", () => {
    expect(queryFromFilters(parse("range=today"), "b1", today)).toMatchObject({
      from: "2026-10-29",
      to: "2026-10-29",
    });
    expect(queryFromFilters(parse("range=7d"), "b1", today)).toMatchObject({
      from: "2026-10-23",
      to: "2026-10-29",
    });
    expect(queryFromFilters(parse(""), "b1", today)).toMatchObject({
      from: "2026-09-30",
      to: "2026-10-29",
    });
    const all = queryFromFilters(parse("range=all"), "b1", today);
    expect(all).not.toHaveProperty("from");
  });

  it("pages by offset and sends the rest", () => {
    const q = queryFromFilters(
      parse(
        "page=3&size=50&q=ama&status=paid&flagged=1&min=10&max=20&sort=oldest",
      ),
      "b1",
      today,
    );
    expect(q).toMatchObject({
      branchId: "b1",
      limit: 50,
      offset: 100,
      q: "ama",
      status: "paid",
      flagged: true,
      minAmount: "10",
      maxAmount: "20",
      sort: "oldest",
    });
  });

  it("lists applied filters as chips and says how to clear each", () => {
    const f = parse("q=kofi&range=7d&status=void&min=100");
    expect(appliedFilters(f).map((a) => a.key)).toEqual([
      "q",
      "range",
      "status",
      "amount",
    ]);
    expect(appliedFilters(parse(""))).toEqual([]);
    expect(hiddenFilterCount(f)).toBe(2);
  });

  it("describes the page", () => {
    expect(pageText(1, 25, 0)).toBe("No purchases");
    expect(pageText(2, 25, 60)).toBe("26–50 of 60");
    expect(pageText(3, 25, 60)).toBe("51–60 of 60");
  });
});
