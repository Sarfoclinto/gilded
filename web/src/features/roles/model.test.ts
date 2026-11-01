import { describe, expect, it } from "vitest";
import type { ManagedUser, Role } from "@/features/users/schemas";
import {
  assess,
  diffPerms,
  likeness,
  matrix,
  movable,
  roleKeyFromName,
  summary,
  unknownPerms,
} from "./model";

const role = (key: string, permissions: string[]): Role => ({
  key,
  name: key[0]!.toUpperCase() + key.slice(1),
  isSystem: true,
  permissions,
  activeMembers: 0,
  members: [],
});
const user = (id: string, o: Partial<ManagedUser> = {}): ManagedUser => ({
  id,
  username: id,
  displayName: id,
  role: { key: "teller", name: "Teller" },
  branchIds: [],
  isActive: true,
  mustChangePassword: false,
  createdAt: "",
  overrides: [],
  permissions: [],
  ...o,
});

describe("role assessment", () => {
  it("a plain teller is low risk with nothing missing", () => {
    const a = assess([
      "calculator:use",
      "transactions:read",
      "transactions:create",
      "days:read",
      "days:manage",
    ]);
    expect(a.level).toBe("low");
    expect(a.risky).toEqual([]);
    expect(a.missing).toEqual([]);
  });
  it("flags sensitive permissions, high first", () => {
    const a = assess(["days:signoff", "users:manage", "days:read"]);
    expect(a.risky.map((r) => r.permission)).toEqual([
      "users:manage",
      "days:signoff",
    ]);
    expect(a.level).toBe("high");
  });
  it("flags duties that clash", () => {
    const a = assess([
      "transactions:create",
      "transactions:read",
      "days:signoff",
      "days:read",
    ]);
    expect(a.conflicts).toHaveLength(1);
    expect(a.conflicts[0]!.why).toMatch(/signs off/);
    expect(a.level).toBe("medium");
  });
  it("flags missing basics", () => {
    expect(assess(["transactions:create"]).missing).toEqual([
      { permission: "transactions:create", needs: "transactions:read" },
    ]);
    expect(assess(["days:manage", "days:read"]).missing).toEqual([]);
  });
  it("counts members with personal exceptions, ignoring switched-off people", () => {
    const o = [{ permission: "x:y", effect: "allow" as const }];
    expect(
      assess(
        [],
        [
          user("a", { overrides: o }),
          user("b", { overrides: o, isActive: false }),
          user("c"),
        ],
      ).withOverrides,
    ).toBe(1);
  });
});

describe("role helpers", () => {
  it("diffs permissions and finds the closest standard role", () => {
    expect(diffPerms(["a:b", "c:d"], ["c:d", "e:f"])).toEqual({
      added: ["e:f"],
      removed: ["a:b"],
    });
    const std = [
      role("teller", ["days:read", "days:manage"]),
      role("manager", [
        "days:read",
        "days:manage",
        "reports:read",
        "days:signoff",
      ]),
    ];
    expect(
      likeness(["days:read", "days:manage", "customers:read"], std),
    ).toEqual({ name: "Teller", plus: 1, minus: 0 });
  });
  it("summarises and builds the compare matrix", () => {
    expect(summary(["days:read"])).toBe("1 permission · cash and days");
    const m = matrix([role("a", ["days:read"]), role("b", [])]);
    const cash = m.find((g) => g.title === "Cash and days")!;
    expect(cash.rows[0]!.has).toEqual([true, false]);
    expect(m.flatMap((g) => g.rows)).toHaveLength(25);
  });
  it("names keys like the server and spots unknown permissions", () => {
    expect(roleKeyFromName(" Shift Lead! ")).toBe("shift-lead");
    expect(unknownPerms(["days:read", "old:thing"])).toEqual(["old:thing"]);
  });
  it("lists who can be moved into a role", () => {
    const us = [
      user("me"),
      user("a"),
      user("b", { isActive: false }),
      user("c", { role: { key: "manager", name: "Manager" } }),
    ];
    expect(movable(us, "manager", "me").map((u) => u.id)).toEqual(["a"]);
  });
});
