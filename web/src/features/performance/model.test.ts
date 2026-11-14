import { describe, expect, it } from "vitest";
import type { Performance } from "./api";
import {
  bucketTitle,
  changeOf,
  colorOf,
  compactNumber,
  dashedAt,
  isWeekend,
  linesOf,
  niceTop,
  readout,
  sumOf,
  tickEvery,
  tickLabel,
} from "./model";

const fig = (paid: number, count = 1, pounds = 1) => ({
  paid: String(paid),
  count,
  pounds: String(pounds),
  top: String(pounds * 7.77),
});
const perf: Performance = {
  asOf: "2026-11-14T10:00:00Z",
  days: 7,
  grain: "day",
  from: "2026-11-08",
  to: "2026-11-14",
  buckets: [
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
  ],
  branches: [
    {
      branchId: "k",
      name: "Kumasi",
      code: "KSI",
      points: [0, 100, 200, 0, 50, 0, 300].map((p, i) => ({
        date: `2026-11-0${8 + i}`.replace("-010", "-10"),
        ...fig(p, p ? 1 : 0, p / 100),
      })),
      total: fig(650, 4, 6.5),
      previous: fig(500, 3, 5),
      best: { date: "2026-11-14", paid: "300" },
    },
    {
      branchId: "t",
      name: "Tarkwa",
      code: "TKW",
      points: [10, 0, 0, 0, 0, 0, 0].map((p) => ({
        date: "x",
        ...fig(p, p ? 1 : 0, p / 100),
      })),
      total: fig(10, 1, 0.1),
      previous: fig(0, 0, 0),
      best: { date: "2026-11-08", paid: "10" },
    },
  ],
};

describe("branch performance model (B58)", () => {
  it("builds one line per branch, in the server order, with the metric asked for", () => {
    const paid = linesOf(perf, "paid");
    expect(paid.map((l) => l.branch.code)).toEqual(["KSI", "TKW"]);
    expect(paid[0]!.values).toEqual([0, 100, 200, 0, 50, 0, 300]);
    expect(paid[0]!.total).toBe(650);
    expect(paid[0]!.change).toEqual({ pct: 30, dir: "up" });
    expect(linesOf(perf, "count")[0]!.values).toEqual([0, 1, 1, 0, 1, 0, 1]);
    expect(linesOf(perf, "pounds")[0]!.total).toBe(6.5);
  });
  it("keeps a branch colour by its position, and dashes from the ninth on", () => {
    expect(colorOf(0)).toBe("#2a78d6");
    expect(colorOf(8)).toBe(colorOf(0));
    expect(dashedAt(7)).toBe(false);
    expect(dashedAt(8)).toBe(true);
  });
  it("says how a period compares with the one before", () => {
    expect(changeOf(650, 500)).toEqual({ pct: 30, dir: "up" });
    expect(changeOf(400, 500)).toEqual({ pct: -20, dir: "down" });
    expect(changeOf(10, 0)).toEqual({ pct: null, dir: "up" });
    expect(changeOf(0, 0)).toEqual({ pct: null, dir: "flat" });
  });
  it("sums the shown lines and reads a date biggest first", () => {
    const lines = linesOf(perf, "paid");
    expect(sumOf(lines, 7)).toEqual([10, 100, 200, 0, 50, 0, 300]);
    expect(readout(lines, 0).map((r) => [r.line.branch.code, r.value])).toEqual(
      [
        ["TKW", 10],
        ["KSI", 0],
      ],
    );
  });
  it("labels dates with the weekday, weeks by their Monday, months by name", () => {
    expect(tickLabel("2026-11-14", "day")).toBe("Sat 14");
    expect(tickLabel("2026-11-09", "week")).toBe("9 Nov");
    expect(tickLabel("2026-11-01", "month")).toBe("Nov");
    expect(tickLabel("2026-01-01", "month", true)).toBe("Jan 26");
    expect(bucketTitle("2026-11-14", "day")).toBe("Saturday 14 Nov 2026");
    expect(bucketTitle("2026-11-09", "week")).toBe("Week of Mon 9 Nov");
    expect(bucketTitle("2026-11-01", "month")).toBe("November 2026");
    expect(isWeekend("2026-11-14")).toBe(true);
    expect(isWeekend("2026-11-13")).toBe(false);
  });
  it("picks a round axis top and readable figures", () => {
    expect(niceTop(0)).toBe(1);
    expect(niceTop(870)).toBe(1000);
    expect(niceTop(2300)).toBe(2500);
    expect(niceTop(13)).toBe(15);
    expect(niceTop(120000)).toBe(150000);
    expect(compactNumber(1234)).toBe("1.2k");
    expect(compactNumber(2_500_000)).toBe("2.5M");
    expect(compactNumber(12)).toBe("12");
    expect(tickEvery(30, 600, 58)).toBe(3);
    expect(tickEvery(7, 300, 58)).toBe(2);
  });
});
