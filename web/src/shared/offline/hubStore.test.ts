import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/errors";
import {
  flushShortNotices,
  noticeFrom,
  useShortNotices,
  type ShortNotice,
} from "./hubShort";

const n = (id: string): ShortNotice => ({
  commandId: id,
  branchId: "b1",
  short: { "100": 7 },
  capturedAt: "2026-11-12T10:00:00.000Z",
});

beforeEach(() => useShortNotices.setState({ pending: [] }));

describe("noticeFrom", () => {
  const entry = {
    id: "c1",
    payload: { branchId: "b1" },
    createdAt: Date.UTC(2026, 10, 12, 10),
  };
  it("makes a notice when the hub recorded the entry but the drawer was short", () => {
    expect(
      noticeFrom(entry, { covered: false, short: { "100": 7, "50": 0 } }),
    ).toEqual({
      commandId: "c1",
      branchId: "b1",
      short: { "100": 7 },
      capturedAt: "2026-11-12T10:00:00.000Z",
    });
  });
  it("makes none when the drawer covered it, when it was only refused (nothing recorded), or there is nothing to say", () => {
    expect(noticeFrom(entry, { covered: true, short: {} })).toBeNull();
    expect(
      noticeFrom(entry, { covered: false, taken: true, short: { "100": 1 } }),
    ).toBeNull();
    expect(noticeFrom(entry, { covered: false, short: {} })).toBeNull();
  });
  it("needs to know the branch", () => {
    expect(
      noticeFrom(
        { ...entry, payload: {} },
        { covered: false, short: { "100": 1 } },
      ),
    ).toBeNull();
  });
});

describe("the waiting list", () => {
  it("holds one notice per entry", () => {
    useShortNotices.getState().add(n("a"));
    useShortNotices.getState().add(n("a"));
    expect(useShortNotices.getState().pending).toHaveLength(1);
  });

  it("sends them all and clears them", async () => {
    useShortNotices.getState().add(n("a"));
    useShortNotices.getState().add(n("b"));
    const send = vi.fn().mockResolvedValue(undefined);
    await flushShortNotices(send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(useShortNotices.getState().pending).toEqual([]);
  });

  it("keeps everything when there is no connection, and sends later", async () => {
    useShortNotices.getState().add(n("a"));
    useShortNotices.getState().add(n("b"));
    const down = vi
      .fn()
      .mockRejectedValue(
        new ApiError({ kind: "network", message: "No response from server" }),
      );
    await flushShortNotices(down);
    expect(down).toHaveBeenCalledTimes(1);
    expect(useShortNotices.getState().pending).toHaveLength(2);
    const up = vi.fn().mockResolvedValue(undefined);
    await flushShortNotices(up);
    expect(useShortNotices.getState().pending).toEqual([]);
  });

  it("drops a notice the server will never accept, without blocking the next", async () => {
    useShortNotices.getState().add(n("bad"));
    useShortNotices.getState().add(n("good"));
    const send = vi.fn(async (x: ShortNotice) => {
      if (x.commandId === "bad")
        throw new ApiError({ kind: "http", status: 403, message: "no" });
    });
    await flushShortNotices(send);
    expect(useShortNotices.getState().pending).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps notices when signed out (401) or the server is failing (500)", async () => {
    useShortNotices.getState().add(n("a"));
    await flushShortNotices(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError({ kind: "http", status: 401, message: "x" }),
        ),
    );
    await flushShortNotices(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError({ kind: "http", status: 500, message: "x" }),
        ),
    );
    expect(useShortNotices.getState().pending).toHaveLength(1);
  });
});
