import { useMemo, useState } from "react";
import { Alert, Modal } from "antd";
import { AlertTriangle } from "lucide-react";
import type { Permission } from "@/config/permissions";
import { useCreateRole, useUpdateRole } from "@/features/users/api";
import type { Role } from "@/features/users/schemas";
import { Button } from "@/shared/ui/Button";
import { TextField } from "@/shared/ui/TextField";
import { GROUPS, label, NEEDS, RISK } from "./catalog";
import { assess, diffPerms, unknownPerms } from "./model";
import { AssessmentView } from "./AssessmentView";

type Mode = { kind: "new"; from: Role | null } | { kind: "edit"; role: Role };

function Editor({
  mode,
  onClose,
  onSaved,
}: {
  mode: Mode;
  onClose: () => void;
  onSaved: (key: string | null) => void;
}) {
  const base = mode.kind === "edit" ? mode.role : mode.from;
  const create = useCreateRole();
  const update = useUpdateRole();
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(
    mode.kind === "edit" ? mode.role.name : base ? `${base.name} copy` : "",
  );
  const [description, setDescription] = useState(base?.description ?? "");
  const [perms, setPerms] = useState<string[]>(base?.permissions ?? []);
  const [find, setFind] = useState("");
  const has = new Set(perms);
  const a = useMemo(() => assess(perms), [perms]);
  const change =
    mode.kind === "edit" ? diffPerms(mode.role.permissions, perms) : null;
  const pending = create.isPending || update.isPending;
  const error = (create.error ?? update.error)?.message;
  const nameOk = name.trim().length >= 2 && name.trim().length <= 40;
  const dirty =
    mode.kind === "new" ||
    name.trim() !== mode.role.name ||
    (description ?? "") !== (mode.role.description ?? "") ||
    change!.added.length + change!.removed.length > 0;
  const toggle = (p: string) =>
    setPerms((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
    );
  const match = (p: string) =>
    !find.trim() ||
    `${label(p)} ${p}`.toLowerCase().includes(find.trim().toLowerCase());

  function save() {
    if (!nameOk || perms.length === 0 || pending) return;
    if (mode.kind === "new")
      create.mutate(
        {
          id,
          name: name.trim(),
          description: description.trim() || null,
          permissions: perms,
        },
        { onSuccess: (r) => onSaved(r.key) },
      );
    else
      update.mutate(
        {
          key: mode.role.key,
          changes: {
            name: name.trim(),
            description: description.trim() || null,
            permissions: perms,
          },
        },
        { onSuccess: (r) => onSaved(r.key) },
      );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Role name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Shift lead"
        />
        <TextField
          label="What this role is for (optional)"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <input
        className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-ring"
        placeholder="Find a permission"
        value={find}
        onChange={(e) => setFind(e.target.value)}
      />
      <div className="max-h-[32vh] space-y-4 overflow-y-auto pr-1">
        {GROUPS.map((g) => {
          const shown = g.permissions.filter(match);
          if (!shown.length) return null;
          const all = g.permissions.every((p) => has.has(p));
          return (
            <section key={g.key}>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{g.title}</h3>
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() =>
                    setPerms((cur) =>
                      all
                        ? cur.filter(
                            (p) => !g.permissions.includes(p as Permission),
                          )
                        : [...new Set([...cur, ...g.permissions])],
                    )
                  }
                >
                  {all ? "Clear all" : "Select all"}
                </button>
              </div>
              <ul className="space-y-1">
                {shown.map((p) => {
                  const need = NEEDS[p];
                  return (
                    <li key={p}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
                          checked={has.has(p)}
                          onChange={() => toggle(p)}
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          {label(p)}
                          {RISK[p] ? (
                            <span
                              className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK[p] === "high" ? "bg-red-500/15 text-red-700" : "bg-amber-500/20 text-amber-800"}`}
                            >
                              {RISK[p] === "high" ? "sensitive" : "care"}
                            </span>
                          ) : null}
                          {need && has.has(p) && !has.has(need) ? (
                            <span className="block text-xs text-amber-800">
                              Works best with “{label(need)}”.
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {unknownPerms(perms).length ? (
          <p className="text-xs text-muted-foreground">
            Also holds {unknownPerms(perms).join(", ")}, which this version no
            longer lists. Saving keeps it.
          </p>
        ) : null}
      </div>

      <AssessmentView
        a={a}
        onAdd={(p) => setPerms((cur) => [...new Set([...cur, p])])}
        compact
      />

      {change && (change.added.length > 0 || change.removed.length > 0) ? (
        <Alert
          type="warning"
          showIcon
          icon={<AlertTriangle className="size-4" />}
          title={`Saving signs out ${mode.kind === "edit" ? mode.role.activeMembers : 0} ${mode.kind === "edit" && mode.role.activeMembers === 1 ? "person" : "people"} who hold this role, so the change applies at once.`}
          description={
            <span className="text-xs">
              {change.added.length
                ? `Adds: ${change.added.map(label).join("; ")}. `
                : ""}
              {change.removed.length
                ? `Removes: ${change.removed.map(label).join("; ")}.`
                : ""}
            </span>
          }
        />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={save}
          loading={pending}
          disabled={!nameOk || perms.length === 0 || !dirty}
        >
          {mode.kind === "new" ? "Create role" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

export function RoleEditor({
  mode,
  onClose,
  onSaved,
}: {
  mode: Mode | null;
  onClose: () => void;
  onSaved: (key: string | null) => void;
}) {
  return (
    <Modal
      open={!!mode}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={680}
      title={
        mode?.kind === "edit"
          ? `Change ${mode.role.name}`
          : mode?.from
            ? `New role, copied from ${mode.from.name}`
            : "New role"
      }
    >
      {mode ? <Editor mode={mode} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}
