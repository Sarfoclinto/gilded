import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Modal, Segmented } from "antd";
import { Copy, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { Kpi } from "@/features/dashboard/charts";
import {
  useDeleteRole,
  useRoles,
  useUpdateUser,
  useUsers,
} from "@/features/users/api";
import type { ManagedUser, Role } from "@/features/users/schemas";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Chip } from "@/shared/ui/Chip";
import { EmptyState } from "@/shared/ui/DataTable";
import { PageHeader } from "@/shared/ui/PageHeader";
import { initials } from "@/shared/lib/dates";
import { AssessmentView } from "../AssessmentView";
import { GROUPS, label, RISK } from "../catalog";
import {
  assess,
  likeness,
  matrix,
  movable,
  summary,
  unknownPerms,
} from "../model";
import { RoleEditor } from "../RoleEditor";

const levelTone = { low: "green", medium: "amber", high: "red" } as const;
const levelText = {
  low: "Low risk",
  medium: "Needs care",
  high: "High access",
} as const;
const field = "min-h-10 rounded-lg border border-border bg-card px-2 text-sm";

function Members({
  role,
  roles,
  users,
}: {
  role: Role;
  roles: Role[];
  users: ManagedUser[];
}) {
  const me = useAuth((s) => s.user?.id);
  const update = useUpdateUser();
  const people = users
    .filter((u) => u.role.key === role.key)
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        a.displayName.localeCompare(b.displayName),
    );
  const candidates = movable(users, role.key, me);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const move = (u: ManagedUser, roleKey: string) => {
    if (!roleKey) return;
    setError(null);
    setBusy(u.id);
    update.mutate(
      { id: u.id, changes: { roleKey } },
      { onError: (e) => setError(e.message), onSettled: () => setBusy(null) },
    );
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          People in this role ({people.filter((p) => p.isActive).length})
        </h3>
        {candidates.length ? (
          <select
            aria-label="Add a person to this role"
            className={field}
            value=""
            disabled={!!busy}
            onChange={(e) => {
              const u = users.find((x) => x.id === e.target.value);
              if (u) move(u, role.key);
            }}
          >
            <option value="">Add a person…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} (now {u.role.name})
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => setError(null)}
        />
      ) : null}
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody holds this role.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {people.map((u) => (
            <li
              key={u.id}
              className={`flex items-center gap-3 px-3 py-2 ${u.isActive ? "" : "opacity-60"}`}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy text-xs font-semibold text-white">
                {initials(u.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {u.displayName}
                  {u.id === me ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      you
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {u.username}
                  {u.isActive ? "" : " · switched off"}
                  {u.overrides.length
                    ? ` · ${u.overrides.length} personal exception${u.overrides.length === 1 ? "" : "s"}`
                    : ""}
                </p>
              </div>
              {u.id !== me ? (
                <select
                  aria-label={`Move ${u.displayName} to another role`}
                  className={field}
                  value=""
                  disabled={busy === u.id}
                  onChange={(e) => move(u, e.target.value)}
                >
                  <option value="">Move to…</option>
                  {roles
                    .filter((r) => r.key !== role.key)
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </select>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Moving someone signs them out, so the new role applies at once. You
        cannot change your own role: ask another director.
      </p>
    </div>
  );
}

function Detail({
  role,
  roles,
  users,
  onEdit,
  onCopy,
  onDelete,
}: {
  role: Role;
  roles: Role[];
  users: ManagedUser[];
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const members = users.filter((u) => u.role.key === role.key);
  const a = assess(role.permissions, members);
  const like = role.isSystem
    ? null
    : likeness(
        role.permissions,
        roles.filter((r) => r.isSystem),
      );
  const extra = unknownPerms(role.permissions);
  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{role.name}</h2>
            {role.isSystem ? (
              <Chip>
                <Lock className="mr-1 inline size-3" />
                Standard
              </Chip>
            ) : (
              <Chip tone="sky">Custom</Chip>
            )}
          </div>
          {role.description ? (
            <p className="text-sm text-muted-foreground">{role.description}</p>
          ) : null}
          {like ? (
            <p className="text-xs text-muted-foreground">
              Like {like.name}
              {like.plus ? `, plus ${like.plus}` : ""}
              {like.minus ? `, without ${like.minus}` : ""}.
            </p>
          ) : null}
          {role.isSystem ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Standard roles are fixed. Make a copy to adjust it for your
              business.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onCopy}>
            <Copy className="mr-1.5 size-4" />
            Make a copy
          </Button>
          {!role.isSystem ? (
            <Button variant="secondary" onClick={onEdit}>
              <Pencil className="mr-1.5 size-4" />
              Change
            </Button>
          ) : null}
          {!role.isSystem ? (
            <Button
              variant="ghost"
              onClick={onDelete}
              disabled={members.length > 0}
              title={
                members.length
                  ? "Move its people to another role first"
                  : undefined
              }
            >
              <Trash2 className="mr-1.5 size-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <AssessmentView a={a} />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">What it allows</h3>
        {GROUPS.map((g) => {
          const on = g.permissions.filter((p) => role.permissions.includes(p));
          if (!on.length) return null;
          return (
            <div key={g.key}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {g.title}
              </p>
              <ul className="space-y-0.5 text-sm">
                {on.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full ${RISK[p] === "high" ? "bg-red-600" : RISK[p] ? "bg-amber-500" : "bg-emerald-600"}`}
                    />
                    {label(p)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {extra.length ? (
          <p className="text-xs text-muted-foreground">
            Also: {extra.join(", ")}
          </p>
        ) : null}
      </div>

      <Members role={role} roles={roles} users={users} />
    </div>
  );
}

function Compare({ roles }: { roles: Role[] }) {
  const m = matrix(roles);
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="sticky left-0 bg-card px-3 py-2 font-medium">
              Permission
            </th>
            {roles.map((r) => (
              <th key={r.key} className="px-3 py-2 text-center font-medium">
                {r.name}
                <div className="text-xs font-normal text-muted-foreground">
                  {r.activeMembers} active
                </div>
              </th>
            ))}
          </tr>
        </thead>
        {m.map((g) => (
          <tbody key={g.title}>
            <tr>
              <td
                colSpan={roles.length + 1}
                className="bg-muted/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {g.title}
              </td>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.permission} className="border-t border-border/60">
                <td className="sticky left-0 bg-card px-3 py-1.5">
                  {r.risk ? (
                    <span
                      className={`mr-2 inline-block size-2 rounded-full ${r.risk === "high" ? "bg-red-600" : "bg-amber-500"}`}
                    />
                  ) : null}
                  {r.label}
                </td>
                {r.has.map((h, i) => (
                  <td key={roles[i]!.key} className="px-3 py-1.5 text-center">
                    {h ? (
                      <span
                        aria-label="allowed"
                        className="font-bold text-emerald-700"
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        aria-label="not allowed"
                        className="text-muted-foreground/40"
                      >
                        –
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export default function RolesPage() {
  const rolesQ = useRoles();
  const usersQ = useUsers();
  const del = useDeleteRole();
  const [sp, setSp] = useSearchParams();
  const [editor, setEditor] = useState<
    { kind: "new"; from: Role | null } | { kind: "edit"; role: Role } | null
  >(null);
  const [removing, setRemoving] = useState<Role | null>(null);
  const roles = rolesQ.data ?? [];
  const users = useMemo(() => usersQ.data ?? [], [usersQ.data]);
  const view = sp.get("view") === "compare" ? "compare" : "roles";
  const current =
    roles.find((r) => r.key === sp.get("role")) ?? roles[0] ?? null;
  const pick = (key: string) => {
    const n = new URLSearchParams(sp);
    n.set("role", key);
    setSp(n, { replace: true });
  };
  const levels = roles.map(
    (r) =>
      assess(
        r.permissions,
        users.filter((u) => u.role.key === r.key),
      ).level,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Roles"
        subtitle="What each kind of person is allowed to do. Give people a role on the Users page, or move them here."
        actions={
          <Button onClick={() => setEditor({ kind: "new", from: null })}>
            <Plus className="mr-1.5 size-4" />
            New role
          </Button>
        }
      />
      {rolesQ.error ? (
        <Alert type="error" showIcon title={errorMessage(rolesQ.error)} />
      ) : null}
      {rolesQ.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Roles"
            value={roles.length}
            sub={
              <span className="text-xs text-muted-foreground">
                {roles.filter((r) => !r.isSystem).length} custom
              </span>
            }
          />
          <Kpi
            label="Active people"
            value={users.filter((u) => u.isActive).length}
          />
          <Kpi
            label="High-access roles"
            value={levels.filter((l) => l === "high").length}
            sub={
              <span className="text-xs text-muted-foreground">
                can manage people, prices or imports
              </span>
            }
          />
          <Kpi
            label="People with exceptions"
            value={
              users.filter((u) => u.isActive && u.overrides.length > 0).length
            }
            sub={
              <span className="text-xs text-muted-foreground">
                personal grants or restrictions
              </span>
            }
          />
        </div>
      ) : null}
      <Segmented
        value={view}
        onChange={(v) => {
          const n = new URLSearchParams(sp);
          if (v === "compare") n.set("view", "compare");
          else n.delete("view");
          setSp(n, { replace: true });
        }}
        options={[
          { label: "Roles", value: "roles" },
          { label: "Compare", value: "compare" },
        ]}
      />

      {rolesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {rolesQ.data && roles.length === 0 ? (
        <EmptyState title="No roles" />
      ) : null}

      {view === "compare" && roles.length ? <Compare roles={roles} /> : null}
      {view === "roles" && current ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {roles.map((r, i) => (
              <li key={r.key} className="min-w-56 shrink-0 lg:min-w-0">
                <button
                  type="button"
                  onClick={() => pick(r.key)}
                  className={`block w-full rounded-xl border p-3 text-left transition-colors ${current.key === r.key ? "border-navy bg-navy/5 ring-1 ring-navy" : "border-border bg-card hover:bg-muted/50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{r.name}</span>
                    <Chip tone={levelTone[levels[i] ?? "low"]}>
                      {levelText[levels[i] ?? "low"]}
                    </Chip>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.activeMembers} active{" "}
                    {r.activeMembers === 1 ? "person" : "people"}
                    {r.isSystem ? " · standard" : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {summary(r.permissions)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <Detail
            role={current}
            roles={roles}
            users={users}
            onEdit={() => setEditor({ kind: "edit", role: current })}
            onCopy={() => setEditor({ kind: "new", from: current })}
            onDelete={() => setRemoving(current)}
          />
        </div>
      ) : null}

      <RoleEditor
        mode={editor}
        onClose={() => setEditor(null)}
        onSaved={(key) => {
          setEditor(null);
          if (key) pick(key);
        }}
      />
      <Modal
        open={!!removing}
        title={removing ? `Delete ${removing.name}?` : ""}
        onCancel={() => setRemoving(null)}
        okText="Delete"
        okButtonProps={{ danger: true, loading: del.isPending }}
        onOk={() =>
          removing &&
          del.mutate(
            { key: removing.key },
            {
              onSuccess: () => {
                setRemoving(null);
                const n = new URLSearchParams(sp);
                n.delete("role");
                setSp(n, { replace: true });
              },
            },
          )
        }
        destroyOnHidden
      >
        <p className="text-sm text-muted-foreground">
          The role is removed for good. Nobody holds it, so no one loses access.
          The audit trail keeps a record of it.
        </p>
        {del.error ? (
          <p className="mt-2 text-sm text-red-600">{del.error.message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
