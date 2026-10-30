import { describe, expect, it } from "vitest";
import type { AuditEvent } from "./api";
import {
  activeCount,
  changes,
  dayBoundary,
  dayHeading,
  detailLines,
  groupByDay,
  NO_FILTERS,
  rangeStart,
  toCsv,
  toneOf,
  toQuery,
} from "./model";

const ev = (o: Partial<AuditEvent> & { id: string }): AuditEvent => ({
  at: "2026-10-29T12:00:00Z",
  category: "day",
  action: "day.closed",
  entityType: "day",
  entityId: "d",
  summary: "Closed the day",
  ...o,
});
const now = new Date(2026, 9, 29, 15, 0, 0);

describe("audit model", () => {
  it("marks reversals and failures, and good outcomes", () => {
    expect(toneOf("purchase.voided")).toBe("red");
    expect(toneOf("payment.failed")).toBe("red");
    expect(toneOf("transfer.received_with_difference")).toBe("red");
    expect(toneOf("day.signed_off")).toBe("green");
    expect(toneOf("transfer.received")).toBe("green");
    expect(toneOf("day.closed")).toBe("amber");
    expect(toneOf("cash.topup")).toBe("grey");
  });
  it("turns quick ranges and dates into moments in the viewer clock", () => {
    expect(new Date(rangeStart("today", now)!).getHours()).toBe(0);
    expect(new Date(rangeStart("7d", now)!).getDate()).toBe(22);
    expect(rangeStart("", now)).toBeUndefined();
    expect(new Date(dayBoundary("2026-10-29")!).getDate()).toBe(29);
    expect(new Date(dayBoundary("2026-10-29", true)!).getDate()).toBe(30);
    expect(dayBoundary("nonsense")).toBeUndefined();
  });
  it("builds the query: only what is set, custom dates beat quick ranges", () => {
    expect(toQuery(NO_FILTERS, now)).toEqual({
      q: undefined,
      category: undefined,
      actorId: undefined,
      branchId: undefined,
      from: undefined,
      to: undefined,
      minAmount: undefined,
      sort: undefined,
      page: undefined,
      size: undefined,
    });
    const q = toQuery(
      {
        ...NO_FILTERS,
        q: " float ",
        range: "7d",
        from: "2026-10-01",
        sort: "amount",
        page: 3,
        size: 50,
      },
      now,
    );
    expect(q).toMatchObject({ q: "float", sort: "amount", page: 3, size: 50 });
    expect(new Date(q.from!).getMonth()).toBe(9);
    expect(new Date(q.from!).getDate()).toBe(1);
  });
  it("counts narrowing filters but not sorting or paging", () => {
    expect(activeCount({ ...NO_FILTERS, sort: "oldest", page: 4 })).toBe(0);
    expect(
      activeCount({
        ...NO_FILTERS,
        q: "a",
        category: "day",
        from: "2026-10-01",
      }),
    ).toBe(3);
  });
  it("groups by day with friendly headings", () => {
    expect(dayHeading(new Date(2026, 9, 29, 9).toISOString(), now)).toBe(
      "Today",
    );
    expect(dayHeading(new Date(2026, 9, 28, 23).toISOString(), now)).toBe(
      "Yesterday",
    );
    const g = groupByDay(
      [
        ev({ id: "1", at: new Date(2026, 9, 29, 10).toISOString() }),
        ev({ id: "2", at: new Date(2026, 9, 29, 8).toISOString() }),
        ev({ id: "3", at: new Date(2026, 9, 27, 8).toISOString() }),
      ],
      now,
    );
    expect(g.map((x) => [x.heading, x.items.length])).toEqual([
      ["Today", 2],
      ["Tue, 27 Oct", 1],
    ]);
  });
  it("lists details and before/after changes", () => {
    expect(
      detailLines(
        ev({
          id: "1",
          detail: {
            reference: "TX-1",
            businessDate: "2026-10-29",
            note: null,
            before: { a: 1 },
          },
        }),
      ),
    ).toEqual([
      ["Reference", "TX-1"],
      ["Business date", "2026-10-29"],
    ]);
    expect(
      changes(
        ev({
          id: "1",
          detail: {
            before: { name: "Old", code: "K" },
            after: { name: "Kumasi", code: "K", tz: "x" },
          },
        }),
      ),
    ).toEqual([
      { field: "Name", before: "Old", after: "Kumasi" },
      { field: "Tz", before: "—", after: "x" },
    ]);
    expect(changes(ev({ id: "1" }))).toEqual([]);
  });
  it("exports csv with quotes escaped", () => {
    const csv = toCsv([
      ev({
        id: "1",
        summary: 'Said "hi", left',
        actor: { id: "u", displayName: "Ama" },
        amount: "10",
      }),
    ]);
    expect(csv.split("\n")[1]).toContain('"Said ""hi"", left"');
  });
});
