import type { ManagedUser } from "./schemas";

export type UserFilters = {
  q: string;
  role: string;
  status: "all" | "active" | "off" | "pending";
  branch: string;
};
export const NO_FILTERS: UserFilters = {
  q: "",
  role: "",
  status: "all",
  branch: "",
};

export const seesEveryBranch = (u: ManagedUser) =>
  u.permissions.includes("branches:all");

/** "Takoradi, Kumasi", or "All branches" for people who see every one. */
export function branchesText(
  u: ManagedUser,
  names: Record<string, string>,
): string {
  if (seesEveryBranch(u)) return "All branches";
  const list = u.branchIds.map((b) => names[b]).filter(Boolean);
  return list.length ? list.join(", ") : "No branch";
}

export function filterUsers(
  users: ManagedUser[],
  f: UserFilters,
): ManagedUser[] {
  const q = f.q.trim().toLowerCase();
  return users.filter((u) => {
    if (
      q &&
      ![u.displayName, u.username, u.phone ?? "", u.email ?? ""].some((s) =>
        s.toLowerCase().includes(q),
      )
    )
      return false;
    if (f.role && u.role.key !== f.role) return false;
    if (f.status === "active" && !u.isActive) return false;
    if (f.status === "off" && u.isActive) return false;
    if (f.status === "pending" && !(u.isActive && u.mustChangePassword))
      return false;
    if (f.branch && !seesEveryBranch(u) && !u.branchIds.includes(f.branch))
      return false;
    return true;
  });
}

export function summarize(users: ManagedUser[]) {
  const active = users.filter((u) => u.isActive);
  return {
    total: users.length,
    active: active.length,
    off: users.length - active.length,
    pending: active.filter((u) => u.mustChangePassword).length,
    neverSignedIn: active.filter((u) => !u.lastLoginAt).length,
  };
}

/** Roles that exist among the users, with how many people have each (active only), most people first. */
export function roleCounts(users: ManagedUser[]) {
  const m = new Map<string, { key: string; name: string; count: number }>();
  for (const u of users.filter((x) => x.isActive)) {
    const r = m.get(u.role.key) ?? {
      key: u.role.key,
      name: u.role.name,
      count: 0,
    };
    r.count += 1;
    m.set(u.role.key, r);
  }
  return [...m.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

/** Active people first, then by name. */
export const sortUsers = (users: ManagedUser[]) =>
  [...users].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      a.displayName.localeCompare(b.displayName),
  );

/** "Seen 2 hours ago" / "Never signed in", in the same plain words as the rest of the app. */
export function seenText(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "Never signed in";
  const mins = Math.max(
    0,
    Math.round((now.getTime() - new Date(iso).getTime()) / 60_000),
  );
  if (mins < 2) return "Seen just now";
  if (mins < 60) return `Seen ${mins} minutes ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `Seen ${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return d < 30
    ? `Seen ${d} day${d === 1 ? "" : "s"} ago`
    : `Seen ${new Date(iso).toLocaleDateString("en-GH", { day: "2-digit", month: "short", year: "numeric" })}`;
}
