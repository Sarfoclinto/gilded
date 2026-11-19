import { describe, expect, it } from "vitest";
import type { SheetDetail } from "./api";
import type { Pending } from "./local";
import { activityText, cleanAmount, money, signed, withPending } from "./model";

const me = { id: "u1", displayName: "Ama" };
const entry = (id: string, amount: string, moneyDate: string) => ({
  id,
  sheetId: "s1",
  amount,
  moneyDate,
  note: null,
  dayTotal: false,
  takesBack: null,
  writtenBy: me,
  writtenAt: `${moneyDate}T10:00:00Z`,
  receivedAt: `${moneyDate}T10:00:00Z`,
  afterRemoval: false,
  mine: true,
  takenBack: null,
});
const sheet = (): SheetDetail => ({
  id: "s1",
  groupId: "g",
  name: "Kitchen fees",
  branchId: null,
  branchName: null,
  openingBalance: "100",
  openingDate: null,
  closed: false,
  closedAt: null,
  access: "write",
  createdAt: "",
  last: null,
  balance: "129.5",
  todayIn: "50",
  todayOut: "20.5",
  entries: 2,
  groupName: "Staff",
  myRole: "writer",
  today: "2026-11-18",
  from: "2026-10-18",
  to: "2026-11-19",
  balanceBefore: "100",
  olderEntries: false,
  week: { in: "50", out: "20.5" },
  month: { in: "50", out: "20.5" },
  days: [
    {
      date: "2026-11-18",
      in: "50",
      out: "20.5",
      closing: "129.5",
      entries: [
        entry("e2", "-20.5", "2026-11-18"),
        entry("e1", "50", "2026-11-18"),
      ],
    },
  ],
});
const pending = (
  id: string,
  direction: "in" | "out",
  amount: string,
  moneyDate: string,
  sheetId = "s1",
): Pending => ({
  id,
  sheetId,
  direction,
  amount,
  moneyDate,
  dayTotal: false,
  writtenAt: `${moneyDate}T12:00:00Z`,
  problem: null,
});

describe("money and amounts", () => {
  it("formats cedis and signs", () => {
    expect(money("1240")).toBe("GHS 1,240.00");
    expect(money(-60)).toBe("−GHS 60.00");
    expect(signed("150")).toBe("+150");
    expect(signed("-40.5")).toBe("−40.5");
  });
  it("reads what a person types", () => {
    expect(cleanAmount("1,200")).toBe("1200");
    expect(cleanAmount(" 12.5 ")).toBe("12.5");
    expect(cleanAmount("007")).toBe("7");
    expect(cleanAmount("0")).toBeNull();
    expect(cleanAmount("1.234")).toBeNull();
    expect(cleanAmount("-5")).toBeNull();
    expect(cleanAmount("abc")).toBeNull();
  });
});

describe("withPending (entries not yet sent)", () => {
  it("nothing waiting: the server's view as it is", () => {
    const v = withPending(sheet(), [], me);
    expect(v.balance).toBe("129.5");
    expect(v.waiting).toBe(0);
    expect(v.days[0]!.closing).toBe("129.5");
  });
  it("folds waiting entries into their day and moves the balance", () => {
    const v = withPending(
      sheet(),
      [
        pending("p1", "in", "30", "2026-11-18"),
        pending("p2", "out", "9.5", "2026-11-17"),
        pending("x", "in", "999", "2026-11-18", "other"),
      ],
      me,
    );
    expect(v.waiting).toBe(2);
    expect(v.balance).toBe("150");
    expect(v.days.map((d) => d.date)).toEqual(["2026-11-18", "2026-11-17"]);
    expect(v.days[1]).toMatchObject({ in: "0", out: "9.5", closing: "90.5" });
    expect(v.days[0]).toMatchObject({ in: "80", out: "20.5", closing: "150" });
    expect(v.days[0]!.entries[0]!.pending?.id).toBe("p1");
  });
  it("an entry the server already has is not counted twice", () => {
    expect(
      withPending(sheet(), [pending("e1", "in", "50", "2026-11-18")], me),
    ).toMatchObject({ balance: "129.5", waiting: 0 });
  });
  it("an entry dated before the period on screen moves the balance but shows no day", () => {
    const v = withPending(
      sheet(),
      [pending("old", "in", "10", "2026-01-02")],
      me,
    );
    expect(v.balance).toBe("139.5");
    expect(v.days).toHaveLength(1);
  });
});

describe("a taking back in a day", () => {
  it("the pair stays in the balance but not in the day's in and out", () => {
    const sh = sheet();
    sh.days[0]!.entries.push(
      {
        ...entry("e9", "500", "2026-11-18"),
        takenBack: { by: me, at: "2026-11-18T11:00:00Z", id: "e10" },
      },
      { ...entry("e10", "-500", "2026-11-18"), takesBack: "e9" },
    );
    const v = withPending(sh, [pending("p1", "in", "1", "2026-11-18")], me);
    expect(v.days[0]).toMatchObject({
      in: "51",
      out: "20.5",
      closing: "130.5",
    });
  });
});

describe("activityText", () => {
  it("reads like a sentence", () => {
    const a = (kind: string, detail: Record<string, unknown> = {}) => ({
      kind,
      actor: { displayName: "Mo" },
      subject: { displayName: "Kofi" },
      detail,
    });
    expect(activityText(a("member_added", { role: "writer" }))).toBe(
      "Mo added Kofi, as a writer",
    );
    expect(
      activityText(
        a("entry_taken_back", {
          sheet: "Kitchen fees",
          amount: "50",
          moneyDate: "2026-11-18",
        }),
      ),
    ).toBe('Mo took back Kofi\'s +50 on "Kitchen fees" (2026-11-18)');
    expect(
      activityText({
        ...a("entry_taken_back", { sheet: "K", amount: "5", moneyDate: "d" }),
        subject: { displayName: "Mo" },
      }),
    ).toBe('Mo took back their own +5 on "K" (d)');
    expect(
      activityText({
        ...a("access_changed", { sheet: "Savings", access: "none" }),
        subject: null,
      }),
    ).toBe('Mo set "Savings" to not see for everyone');
    expect(
      activityText(
        a("entry_after_removal", { sheetId: "s9", amount: "10" }),
        (id) => (id === "s9" ? "Kitchen fees" : undefined),
      ),
    ).toContain('+10 on "Kitchen fees"');
  });
});
