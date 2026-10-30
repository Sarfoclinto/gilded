import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Modal, Segmented } from "antd";
import { SearchIcon } from "lucide-react";
import { Kpi } from "@/features/dashboard/charts";
import { initials } from "@/shared/lib/dates";
import { Chip } from "@/shared/ui/Chip";
import { EmptyState } from "@/shared/ui/DataTable";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useUpdateUser, useUsers } from "../api";
import { PasswordShownModal } from "../PasswordShownModal";
import { ResetPasswordModal } from "../ResetPasswordModal";
import {
  branchesText,
  filterUsers,
  NO_FILTERS,
  roleCounts,
  seenText,
  sortUsers,
  summarize,
  type UserFilters,
} from "../model";
import type { ManagedUser } from "../schemas";
import { UserModal } from "../UserModal";

export default function UsersPage() {
  const me = useAuth((s) => s.user?.id);
  const branchNames = useBranchNames();
  const list = useUsers();
  const update = useUpdateUser();
  const [sp, setSp] = useSearchParams();
  const f: UserFilters = {
    q: sp.get("q") ?? "",
    role: sp.get("role") ?? "",
    status: (sp.get("status") as UserFilters["status"]) || "all",
    branch: sp.get("branch") ?? "",
  };
  const set = (patch: Partial<UserFilters>) => {
    const n = { ...f, ...patch };
    const next = new URLSearchParams();
    (Object.keys(NO_FILTERS) as (keyof UserFilters)[]).forEach((k) => {
      if (n[k] && n[k] !== NO_FILTERS[k]) next.set(k, n[k]);
    });
    setSp(next, { replace: true });
  };
  const all = list.data ?? [];
  const stats = summarize(all);
  const roles = roleCounts(all);
  const rows = sortUsers(filterUsers(all, f));
  const [editing, setEditing] = useState<{ user: ManagedUser | null } | null>(
    null,
  );
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [shown, setShown] = useState<{ who: string; password: string } | null>(
    null,
  );
  const [toggle, setToggle] = useState<ManagedUser | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Users"
        subtitle="Who can sign in, what they can do and where. People are switched off, never deleted, so everything they did stays on record."
        actions={
          <Button onClick={() => setEditing({ user: null })}>Add a user</Button>
        }
      />
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      {list.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Active people"
            value={stats.active}
            sub={
              <span className="text-xs text-muted-foreground">
                {stats.off} switched off
              </span>
            }
          />
          <Kpi
            label="New password pending"
            value={stats.pending}
            sub={
              <span className="text-xs text-muted-foreground">
                must change at next sign-in
              </span>
            }
          />
          <Kpi label="Never signed in" value={stats.neverSignedIn} />
          <Kpi
            label="Roles in use"
            value={roles.length}
            sub={
              <span className="text-xs text-muted-foreground">
                {roles
                  .map(
                    (r) =>
                      `${r.count} ${r.name.toLowerCase()}${r.count === 1 ? "" : "s"}`,
                  )
                  .join(" · ")}
              </span>
            }
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Search name, username or phone"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </div>
        <select
          aria-label="Role"
          className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"
          value={f.role}
          onChange={(e) => set({ role: e.target.value })}
        >
          <option value="">Every role</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Branch"
          className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"
          value={f.branch}
          onChange={(e) => set({ branch: e.target.value })}
        >
          <option value="">Every branch</option>
          {Object.entries(branchNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="max-w-full overflow-x-auto">
          <Segmented
            value={f.status}
            onChange={(v) =>
              set({ status: String(v) as UserFilters["status"] })
            }
            options={[
              { label: "All", value: "all" },
              { label: "Active", value: "active" },
              { label: "Switched off", value: "off" },
              { label: "Password pending", value: "pending" },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 && !list.isLoading ? (
        <EmptyState
          title={(list.data ?? []).length ? "Nobody matches" : "No users yet"}
          hint={
            (list.data ?? []).length
              ? "Try another search or filter."
              : "Add the first person who will sign in."
          }
          action={
            (list.data ?? []).length ? (
              <Button
                variant="secondary"
                onClick={() => setSp(new URLSearchParams(), { replace: true })}
              >
                Show everyone
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((u) => (
            <li
              key={u.id}
              className={`rounded-xl border border-border bg-card ${u.isActive ? "" : "opacity-70"}`}
            >
              <div className="flex items-start gap-3 p-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-navy text-sm font-semibold text-white">
                  {initials(u.displayName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {u.displayName}
                    {u.id === me ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        you
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.username}
                    {u.phone ? ` · ${u.phone}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip tone="sky">{u.role.name}</Chip>
                    {u.overrides.length ? (
                      <Chip tone="amber">+{u.overrides.length} extra</Chip>
                    ) : null}
                    {u.isActive ? null : <Chip>Switched off</Chip>}
                    {u.isActive && u.mustChangePassword ? (
                      <Chip tone="amber">New password pending</Chip>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {branchesText(u, branchNames)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {seenText(u.lastLoginAt)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-border px-3 py-2">
                <Button
                  variant="secondary"
                  onClick={() => setEditing({ user: u })}
                >
                  Edit
                </Button>
                {u.id !== me ? (
                  <Button variant="secondary" onClick={() => setResetting(u)}>
                    Reset password
                  </Button>
                ) : null}
                {u.id !== me ? (
                  <Button variant="ghost" onClick={() => setToggle(u)}>
                    {u.isActive ? "Switch off" : "Switch on"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <UserModal
        open={!!editing}
        user={editing?.user ?? null}
        isSelf={editing?.user?.id === me}
        onClose={() => setEditing(null)}
        onCreated={(u, password) => {
          setEditing(null);
          setShown({ who: u.displayName, password });
        }}
      />
      <ResetPasswordModal
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(u, password) => {
          setResetting(null);
          setShown({ who: u.displayName, password });
        }}
      />
      <PasswordShownModal
        who={shown?.who ?? ""}
        password={shown?.password ?? null}
        onClose={() => setShown(null)}
      />

      <Modal
        open={!!toggle}
        title={
          toggle
            ? `${toggle.isActive ? "Switch off" : "Switch on"} ${toggle.displayName}?`
            : ""
        }
        onCancel={() => setToggle(null)}
        okText={toggle?.isActive ? "Switch off" : "Switch on"}
        okButtonProps={{
          danger: !!toggle?.isActive,
          loading: update.isPending,
        }}
        onOk={() =>
          toggle &&
          update.mutate(
            { id: toggle.id, changes: { isActive: !toggle.isActive } },
            { onSuccess: () => setToggle(null) },
          )
        }
        destroyOnHidden
      >
        <p className="text-sm text-muted-foreground">
          {toggle?.isActive
            ? "They are signed out at once and cannot sign in again until switched on. Their past work stays on record."
            : "They can sign in again with their current password."}
        </p>
        {update.error ? (
          <p className="mt-2 text-sm text-red-600">{update.error.message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
