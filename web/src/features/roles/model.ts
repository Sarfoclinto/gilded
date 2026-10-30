import type { Permission } from "@/config/permissions";
import type { ManagedUser, Role } from "@/features/users/schemas";
import { CONFLICTS, GROUPS, label, NEEDS, RISK, type Risk } from "./catalog";

export type Assessment = {
  risky: { permission: string; risk: Risk }[];
  conflicts: { a: string; b: string; why: string }[];
  missing: { permission: string; needs: string }[];
  /** People holding this role who also have personal grants or denials. */
  withOverrides: number;
  level: "low" | "medium" | "high";
};

/** A plain-words check of a role: what is sensitive, what clashes, what is missing. Pure: takes the permissions, not the role. */
export function assess(
  perms: readonly string[],
  members: ManagedUser[] = [],
): Assessment {
  const has = new Set(perms);
  const risky = perms
    .filter((p) => RISK[p as Permission])
    .map((p) => ({ permission: p, risk: RISK[p as Permission]! }))
    .sort((a, b) =>
      a.risk === b.risk
        ? a.permission.localeCompare(b.permission)
        : a.risk === "high"
          ? -1
          : 1,
    );
  const conflicts = CONFLICTS.filter((c) => has.has(c.a) && has.has(c.b)).map(
    (c) => ({ a: c.a, b: c.b, why: c.why }),
  );
  const missing = perms.flatMap((p) => {
    const n = NEEDS[p as Permission];
    return n && !has.has(n) ? [{ permission: p, needs: n }] : [];
  });
  const withOverrides = members.filter(
    (m) => m.isActive && m.overrides.length > 0,
  ).length;
  const highs = risky.filter((r) => r.risk === "high").length;
  const level =
    highs > 0 || conflicts.length > 1
      ? "high"
      : risky.length > 2 || conflicts.length > 0
        ? "medium"
        : "low";
  return { risky, conflicts, missing, withOverrides, level };
}

/** Plain summary line for a role card. */
export function summary(perms: readonly string[]): string {
  const n = perms.length;
  const g = GROUPS.filter((x) =>
    x.permissions.some((p) => perms.includes(p)),
  ).map((x) => x.title.toLowerCase());
  return `${n} permission${n === 1 ? "" : "s"}${g.length ? ` · ${g.slice(0, 3).join(", ")}${g.length > 3 ? ` and ${g.length - 3} more` : ""}` : ""}`;
}

export function diffPerms(before: readonly string[], after: readonly string[]) {
  const b = new Set(before),
    a = new Set(after);
  return {
    added: after.filter((p) => !b.has(p)).sort(),
    removed: before.filter((p) => !a.has(p)).sort(),
  };
}

/** How a role differs from a reference ("Like Teller, plus 3, without 1"). */
export function likeness(
  perms: readonly string[],
  standard: Role[],
): { name: string; plus: number; minus: number } | null {
  let best: { name: string; plus: number; minus: number } | null = null;
  for (const s of standard) {
    const d = diffPerms(s.permissions, perms);
    const cand = {
      name: s.name,
      plus: d.added.length,
      minus: d.removed.length,
    };
    if (!best || cand.plus + cand.minus < best.plus + best.minus) best = cand;
  }
  return best;
}

/** Rows for the compare view: every permission, with which roles allow it. Groups keep the catalog order. */
export function matrix(roles: Role[]) {
  return GROUPS.map((g) => ({
    title: g.title,
    rows: g.permissions.map((p) => ({
      permission: p as string,
      label: label(p),
      risk: RISK[p],
      has: roles.map((r) => r.permissions.includes(p)),
    })),
  }));
}

/** Permissions a role holds that the catalog does not know (left over from an older version), shown rather than hidden. */
export const unknownPerms = (perms: readonly string[]) =>
  perms.filter(
    (p) => !GROUPS.some((g) => g.permissions.includes(p as Permission)),
  );

export const roleKeyFromName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "role";

/** People who could be moved into a role: active, not already in it, not the person asking (the API refuses changing your own role). */
export const movable = (
  users: ManagedUser[],
  roleKey: string,
  meId?: string | null,
) => users.filter((u) => u.isActive && u.role.key !== roleKey && u.id !== meId);
