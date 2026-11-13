import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectDrawer, type Pending } from "@/features/drawer/projection";
import type { DayState } from "@/features/drawer/schemas";
import { gate, orderWaiting, takenMessage, usePeers } from "./hubShare";
import { confirmable } from "./hubSync";
import { pickBase } from "@/features/drawer/hooks";
import { useHubState } from "@/shared/platform/platform";

const submit = vi.fn();
const setWindow = (hub: boolean) => {
  (globalThis as { window?: unknown }).window = hub
    ? { gilded: { hub: { share: { submit } } } }
    : undefined;
};
const connected = () =>
  useHubState.setState({
    hub: {
      role: "member",
      member: { hubName: "H", address: "x", state: "connected", lastOk: null },
      selfId: "me",
    },
  });
const cmd = {
  id: "c1",
  type: "transaction.create",
  payload: { branchId: "b", payout: { lines: { "100": 2 } } },
};

beforeEach(() => {
  submit.mockReset();
  usePeers.getState().reset();
  useHubState.setState({ hub: { role: "off" } });
});
afterEach(() => setWindow(false));

describe("gate (reserving notes with the hub before saving)", () => {
  it("does nothing without a hub: the computer works alone as before", async () => {
    setWindow(true);
    expect(await gate(cmd, "u", "t")).toEqual({ status: "solo" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("in a browser (no desktop app) it is always solo", async () => {
    setWindow(false);
    connected();
    expect(await gate(cmd, "u", "t")).toEqual({ status: "solo" });
  });

  it("a member that already knows the hub is away does not wait for it", async () => {
    setWindow(true);
    useHubState.setState({
      hub: {
        role: "member",
        member: {
          hubName: "H",
          address: "x",
          state: "unreachable",
          lastOk: null,
        },
      },
    });
    expect(await gate(cmd, "u", "t")).toEqual({ status: "solo" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("asks the hub strictly and returns its number when the notes are reserved", async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({
      ok: true,
      data: { seq: 7, covered: true, short: {}, duplicate: false },
    });
    expect(await gate(cmd, "u", "t")).toEqual({ status: "shared", seq: 7 });
    expect(submit.mock.calls[0]![0]).toMatchObject({
      command: cmd,
      userId: "u",
      strict: true,
    });
  });

  it("refuses when another computer took the notes, and says which", async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({
      ok: true,
      data: {
        seq: 0,
        covered: false,
        short: { "100": 1 },
        duplicate: false,
        taken: true,
      },
    });
    const g = await gate(cmd, "u", "t");
    expect(g).toEqual({ status: "taken", short: { "100": 1 } });
    expect(takenMessage({ "100": 1, "50": 2 })).toBe(
      "Another computer just used some of those notes (short by 1 × GHS 100, 2 × GHS 50). Choose the notes again.",
    );
  });

  it("an unreachable or failing hub never blocks a save", async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({ ok: false, unreachable: true, message: "x" });
    expect(await gate(cmd, "u", "t")).toEqual({ status: "solo" });
    submit.mockRejectedValue(new Error("ipc"));
    expect(await gate(cmd, "u", "t")).toEqual({ status: "solo" });
  });

  it("things that do not move notes are not sent to the hub", async () => {
    setWindow(true);
    connected();
    expect(
      await gate({ id: "x", type: "something.else", payload: {} }, "u", "t"),
    ).toEqual({ status: "solo" });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("peers", () => {
  it("keeps each command once and remembers the highest number seen", () => {
    const add = usePeers.getState().add;
    add([
      { seq: 1, deviceId: "a", command: { id: "x", type: "t", payload: {} } },
    ]);
    add([
      { seq: 1, deviceId: "a", command: { id: "x", type: "t", payload: {} } },
      { seq: 2, deviceId: "b", command: { id: "y", type: "t", payload: {} } },
    ]);
    expect(usePeers.getState().entries.map((e) => e.command.id)).toEqual([
      "x",
      "y",
    ]);
    expect(usePeers.getState().lastSeq).toBe(2);
  });

  it("a colleague's saved payout comes off this computer's drawer, so the same notes are not offered twice", () => {
    const state = {
      day: {
        id: "d1",
        status: "open",
        businessDate: "2026-11-05",
        opening: { lines: { "100": 5 } },
        closing: null,
      },
      balance: { "100": 5 },
      appliedIds: [],
      carryOver: null,
    } as unknown as DayState;
    const mine: Pending = {
      id: "t1",
      type: "transaction.create",
      payload: { branchId: "b", payout: { lines: { "100": 2 } } },
    };
    const theirs: Pending = {
      id: "t2",
      type: "transaction.create",
      payload: { branchId: "b", payout: { lines: { "100": 2 } } },
    };
    expect(projectDrawer(state, [mine, theirs], "b").balance).toEqual({
      "100": 1,
    });
    // once the server has applied the colleague's command, it stops counting twice
    expect(
      projectDrawer(
        { ...state, balance: { "100": 3 }, appliedIds: ["t2"] },
        [mine, theirs],
        "b",
      ).balance,
    ).toEqual({ "100": 1 });
  });
});

describe("opening and closing the day through the hub (B53)", () => {
  const open = {
    id: "tue",
    type: "day.open",
    payload: {
      id: "tue",
      branchId: "b",
      businessDate: "2026-11-10",
      lines: { "100": 5 },
    },
  };

  it("an opening is reserved with the hub like notes are", async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({
      ok: true,
      data: { seq: 3, covered: true, short: {}, duplicate: false },
    });
    expect(await gate(open, "u", "t")).toEqual({ status: "shared", seq: 3 });
    expect(submit.mock.calls[0]![0]).toMatchObject({ strict: true });
  });

  it("a second opening, or a closing of a day already closed, is refused with words that say what happened", async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({
      ok: true,
      data: {
        seq: 0,
        covered: false,
        short: {},
        duplicate: false,
        taken: true,
        reason: "day-open",
      },
    });
    expect(await gate(open, "u", "t")).toEqual({
      status: "taken",
      short: {},
      reason: "day-open",
    });
    expect(takenMessage({}, "day-open")).toContain(
      "just opened on another computer",
    );
    expect(takenMessage({}, "day-not-open")).toContain(
      "just closed on another computer",
    );
  });

  it("with the hub away the opening is saved alone, as before", async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({ ok: false, unreachable: true, message: "x" });
    expect(await gate(open, "u", "t")).toEqual({ status: "solo" });
  });
});

describe("one order for everything waiting", () => {
  const own = (id: string, createdAt: number, seq?: number) => ({
    id,
    createdAt,
    ...(seq ? { shared: { seq } } : {}),
  });
  const peer = (id: string, seq: number) => ({ seq, command: { id } });

  it("follows the hub's numbers, whoever made the entry, then this computer's entries the hub has not seen", () => {
    const r = orderWaiting(
      [own("mine-late", 50), own("mine-2", 10, 2), own("mine-5", 20, 5)],
      [peer("theirs-1", 1), peer("theirs-4", 4), peer("theirs-3", 3)],
    );
    expect(r.map((x) => x.id)).toEqual([
      "theirs-1",
      "mine-2",
      "theirs-3",
      "theirs-4",
      "mine-5",
      "mine-late",
    ]);
  });

  it("does not take this computer's own entry twice when the hub lists it too", () => {
    expect(
      orderWaiting([own("a", 1, 1)], [peer("a", 1), peer("b", 2)]).map(
        (x) => x.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("a colleague's opening comes before the purchases made after it", () => {
    const state = {
      day: {
        id: "mon",
        status: "closed",
        businessDate: "2026-11-09",
        opening: { lines: {} },
        closing: { cash: { counted: { "100": 5 } } },
      },
      balance: null,
      appliedIds: ["mon"],
      carryOver: { "100": 5 },
    } as unknown as DayState;
    const theirOpen = {
      seq: 1,
      command: {
        id: "tue",
        type: "day.open",
        payload: {
          id: "tue",
          branchId: "b",
          businessDate: "2026-11-10",
          lines: { "100": 5 },
        },
      },
    };
    const myBuy = {
      id: "t1",
      type: "transaction.create",
      payload: { branchId: "b", payout: { lines: { "100": 2 } } },
      createdAt: 5,
      shared: { seq: 2 },
    };
    const all = orderWaiting<{ id: string }>(
      [myBuy],
      [theirOpen],
    ) as unknown as Pending[];
    expect(projectDrawer(state, all, "b")).toMatchObject({
      status: "open",
      dayId: "tue",
      balance: { "100": 3 },
    });
  });
});

describe("the hub picture replaces the last one", () => {
  it("entries the server has confirmed drop out", () => {
    usePeers.getState().replace(
      [
        { seq: 1, deviceId: "a", command: { id: "x", type: "t", payload: {} } },
        { seq: 2, deviceId: "a", command: { id: "y", type: "t", payload: {} } },
      ],
      { state: {}, asOf: "1" },
    );
    usePeers
      .getState()
      .replace(
        [
          {
            seq: 2,
            deviceId: "a",
            command: { id: "y", type: "t", payload: {} },
          },
        ],
        { state: {}, asOf: "2" },
      );
    expect(usePeers.getState()).toMatchObject({
      lastSeq: 2,
      snapshot: { asOf: "2" },
    });
    expect(usePeers.getState().entries.map((e) => e.command.id)).toEqual(["y"]);
  });
});

describe("telling the hub what the server has", () => {
  it("only entries sent before the server answer was fetched are in it", () => {
    expect(confirmable({ a: 100, b: 200, c: 300 }, 250)).toEqual(["a", "b"]);
    expect(confirmable({}, 250)).toEqual([]);
  });
});

describe("which server answer to count from", () => {
  const st = (asOf: string, branchId = "b"): DayState => ({
    day: {
      id: "d",
      branchId,
      businessDate: "2026-11-09",
      status: "open",
      opening: { lines: {}, source: "counted" },
      openedAt: asOf,
      openedBy: { id: "u", displayName: "U" },
      closing: null,
      flags: [],
    },
    balance: {},
    movements: [],
    appliedIds: [],
    carryOver: null,
    asOf,
  });

  it("takes the hub's when it is newer and for this branch; otherwise this computer's own", () => {
    const mine = st("2026-11-09T08:00:00Z");
    expect(
      pickBase(
        mine,
        { state: st("2026-11-09T09:00:00Z"), asOf: "2026-11-09T09:00:00Z" },
        "b",
      )?.asOf,
    ).toBe("2026-11-09T09:00:00Z");
    expect(
      pickBase(
        mine,
        { state: st("2026-11-09T07:00:00Z"), asOf: "2026-11-09T07:00:00Z" },
        "b",
      ),
    ).toBe(mine);
    expect(
      pickBase(
        mine,
        {
          state: st("2026-11-09T09:00:00Z", "other"),
          asOf: "2026-11-09T09:00:00Z",
        },
        "b",
      ),
    ).toBe(mine);
    expect(
      pickBase(
        mine,
        { state: { nonsense: true }, asOf: "2026-11-09T09:00:00Z" },
        "b",
      ),
    ).toBe(mine);
    expect(
      pickBase(
        null,
        { state: st("2026-11-09T09:00:00Z"), asOf: "2026-11-09T09:00:00Z" },
        "b",
      )?.asOf,
    ).toBe("2026-11-09T09:00:00Z");
    expect(pickBase(mine, null, "b")).toBe(mine);
  });
});
