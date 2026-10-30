import { describe, expect, it } from "vitest";
import {
  filterCases,
  NO_CASE_FILTERS,
  netSentence,
  openFor,
  pairUp,
  stillToHandOver,
  summarizeCases,
} from "./model";
import type { Case, PositionRow } from "./schemas";

const row = (
  s: string,
  r: string,
  cash: string,
  goods = "0",
  mm = "0",
  failed = "0",
): PositionRow => ({
  senderBranchId: s,
  senderName: s.toUpperCase(),
  receiverBranchId: r,
  receiverName: r.toUpperCase(),
  cashSent: cash,
  goodsValueSent: goods,
  mobileMoneyPaidOnBehalf: mm,
  mobileMoneyFailedCoveredByCash: failed,
});
const money = (n: number) => `GHS ${n}`;

describe("between branches", () => {
  it("pairs both directions and finds who has handed over more", () => {
    const p = pairUp([
      row("a", "b", "1000", "4000"),
      row("b", "a", "500", "0", "200", "100"),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]!.aToB!.total).toBe(5000);
    expect(p[0]!.bToA!.total).toBe(700);
    expect(p[0]!.net).toBe(4300);
    expect(netSentence(p[0]!, money)).toBe(
      "A has handed over GHS 4300 more than B",
    );
    expect(stillToHandOver(p[0]!)).toBe(100);
  });
  it("handles one direction only, from either side, and an even pair", () => {
    const p = pairUp([row("b", "a", "300")]);
    expect(p[0]!.net).toBe(-300);
    expect(netSentence(p[0]!, money)).toBe(
      "B has handed over GHS 300 more than A",
    );
    expect(
      netSentence(pairUp([row("a", "b", "5"), row("b", "a", "5")])[0]!, money),
    ).toBe("About even");
  });
  it("lists the biggest gap first", () => {
    expect(
      pairUp([row("a", "b", "10"), row("c", "d", "900")]).map((x) => x.key),
    ).toEqual(["c|d", "a|b"]);
  });
});

const now = new Date("2026-10-29T12:00:00Z");
const c = (o: Partial<Case> & { id: string }): Case => ({
  branchId: "b1",
  branchName: "Takoradi",
  kind: "closing_variance",
  status: "open",
  openedAt: "2026-10-28T12:00:00Z",
  asset: "cash",
  difference: "-100",
  ...o,
});
describe("cases", () => {
  const cases = [
    c({ id: "1", difference: "-100" }),
    c({
      id: "2",
      status: "under_review",
      difference: "50",
      openedAt: "2026-10-20T12:00:00Z",
      branchId: "b2",
      branchName: "Kumasi",
    }),
    c({ id: "3", status: "resolved" }),
    c({
      id: "4",
      asset: "goods_top",
      difference: "-0.5",
      openedAt: "2026-10-27T12:00:00Z",
    }),
  ];
  it("summarises what is waiting", () => {
    expect(summarizeCases(cases, now)).toEqual({
      live: 3,
      untouched: 2,
      beingLookedAt: 1,
      netCash: -50,
      oldestDays: 9,
    });
    expect(summarizeCases([], now).oldestDays).toBeNull();
  });
  it("searches, filters and sorts", () => {
    expect(
      filterCases(cases, { ...NO_CASE_FILTERS, q: "kumasi" }).map((x) => x.id),
    ).toEqual(["2"]);
    expect(
      filterCases(cases, { ...NO_CASE_FILTERS, branch: "b1" }).map((x) => x.id),
    ).toEqual(["1", "3", "4"]);
    expect(
      filterCases(cases, { ...NO_CASE_FILTERS, sort: "oldest" }).map(
        (x) => x.id,
      )[0],
    ).toBe("2");
    expect(
      filterCases(cases, { ...NO_CASE_FILTERS, sort: "biggest" }).map(
        (x) => x.id,
      )[0],
    ).toBe("4");
  });
  it("says how long a case has waited", () => {
    expect(openFor("2026-10-29T08:00:00Z", now)).toBe("Opened today");
    expect(openFor("2026-10-27T12:00:00Z", now)).toBe("2 days open");
  });
});
