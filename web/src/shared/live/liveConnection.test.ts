import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/env", () => ({
  env: { apiUrl: "http://localhost:5000/api/v1" },
}));
vi.mock("@/shared/api/client", () => ({ refreshAccessToken: vi.fn() }));

import { hubUrl, secondsLeft } from "./liveConnection";

const token = (exp: number) =>
  `x.${btoa(JSON.stringify({ exp })).replace(/=/g, "")}.y`;

describe("live connection helpers", () => {
  it("puts the hub on the API origin, not under /api/v1", () => {
    expect(hubUrl()).toBe("http://localhost:5000/hubs/live");
  });
  it("reads how long a token has left", () => {
    const now = Date.now() / 1000;
    expect(secondsLeft(token(now + 600))).toBeGreaterThan(590);
    expect(secondsLeft(token(now - 5))).toBeLessThan(0);
  });
  it("treats an unreadable token as expired", () => {
    expect(secondsLeft("nonsense")).toBeLessThan(0);
  });
});
