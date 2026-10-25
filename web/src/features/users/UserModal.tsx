import { useMemo, useState } from "react";
import { Alert, Modal, Segmented } from "antd";
import { allPermissions, permissionLabels } from "@/config/permissionLables";
import type { Permission } from "@/config/permissions";
import { useBranchNames } from "@/features/branches/api";
import { Button } from "@/shared/ui/Button";
import { SelectField } from "@/shared/ui/SelectField";
import { TextField } from "@/shared/ui/TextField";
import { useCreateUser, useRoles, useUpdateUser } from "./api";
import {
  diffUser,
  formFromUser,
  temporaryPassword,
  type UserForm,
} from "./diff";
import type { ManagedUser, Override } from "./schemas";

const empty: UserForm = {
  displayName: "",
  email: "",
  phone: "",
  roleKey: "",
  branchIds: [],
  overrides: [],
};

type Choice = "role" | "allow" | "deny";

function Form({
  user,
  isSelf,
  onDone,
  onCreated,
}: {
  user: ManagedUser | null;
  isSelf: boolean;
  onDone: () => void;
  onCreated: (u: ManagedUser, password: string) => void;
}) {
  const roles = useRoles().data ?? [];
  const branchNames = useBranchNames();
  const create = useCreateUser();
  const update = useUpdateUser();
  const [commandId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<UserForm>(user ? formFromUser(user) : empty);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(() => temporaryPassword());
  const [showAccess, setShowAccess] = useState(false);

  const role = roles.find((r) => r.key === form.roleKey);
  const seesAll = role?.permissions.includes("branches:all") ?? false;
  const lockedAccess = isSelf;
  const set = (patch: Partial<UserForm>) =>
    setForm((f) => ({ ...f, ...patch }));
  const pending = create.isPending || update.isPending;
  const error = (create.error ?? update.error)?.message;

  const overrideOf = (p: string): Choice =>
    form.overrides.find((o) => o.permission === p)?.effect ?? "role";
  const setOverride = (p: string, c: Choice) =>
    set({
      overrides: [
        ...form.overrides.filter((o) => o.permission !== p),
        ...(c === "role" ? [] : [{ permission: p, effect: c } as Override]),
      ],
    });

  const changes = useMemo(
    () => (user ? diffUser(user, form) : null),
    [user, form],
  );
  const ready =
    form.displayName.trim().length >= 2 &&
    (user
      ? Object.keys(changes ?? {}).length > 0
      : /^[a-z0-9][a-z0-9._-]{2,39}$/i.test(username.trim()) &&
        form.roleKey !== "" &&
        password.length >= 10 &&
        (seesAll || form.branchIds.length > 0));

  function submit() {
    if (!ready || pending) return;
    if (user && changes)
      update.mutate({ id: user.id, changes }, { onSuccess: onDone });
    else
      create.mutate(
        {
          id: commandId,
          username: username.trim().toLowerCase(),
          displayName: form.displayName.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          password,
          roleKey: form.roleKey,
          branchIds: seesAll ? [] : form.branchIds,
          overrides: form.overrides,
        },
        { onSuccess: (u) => onCreated(u, password) },
      );
  }

  const accessChanged =
    !!changes &&
    ("roleKey" in changes || "branchIds" in changes || "overrides" in changes);

  return (
    <div className="space-y-4">
      {user ? (
        <p className="text-sm text-muted-foreground">
          Username <strong className="text-foreground">{user.username}</strong>
        </p>
      ) : (
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          hint="3 to 40 letters, digits, dots, dashes. It cannot be changed later."
        />
      )}
      <TextField
        label="Full name"
        value={form.displayName}
        onChange={(e) => set({ displayName: e.target.value })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Email (optional)"
          type="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
        />
        <TextField
          label="Phone (optional)"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </div>

      {lockedAccess ? (
        <Alert
          type="info"
          showIcon
          title="This is you. Another director has to change your own role, branches or access."
        />
      ) : null}

      <SelectField
        label="Role"
        value={form.roleKey}
        disabled={lockedAccess}
        onChange={(e) => set({ roleKey: e.target.value })}
      >
        <option value="">Choose a role…</option>
        {roles.map((r) => (
          <option key={r.key} value={r.key}>
            {r.name}
          </option>
        ))}
      </SelectField>

      <div>
        <p className="mb-1 text-sm font-medium">Branches</p>
        {seesAll ? (
          <p className="text-sm text-muted-foreground">
            This role works in every branch.
          </p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.entries(branchNames).map(([id, name]) => (
              <label
                key={id}
                className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  disabled={lockedAccess}
                  checked={form.branchIds.includes(id)}
                  onChange={(e) =>
                    set({
                      branchIds: e.target.checked
                        ? [...form.branchIds, id]
                        : form.branchIds.filter((b) => b !== id),
                    })
                  }
                />
                {name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          className="text-sm font-medium underline"
          onClick={() => setShowAccess((v) => !v)}
        >
          {showAccess ? "Hide" : "Show"} extra access for this person
          {form.overrides.length ? ` (${form.overrides.length} set)` : ""}
        </button>
        {showAccess ? (
          <div className="mt-2 space-y-1 rounded-lg border border-border p-2">
            <p className="px-1 pb-1 text-xs text-muted-foreground">
              Start from the role, then give this one person more, or take
              something away. Example: let a teller edit customers.
            </p>
            {allPermissions.map((p: Permission) => {
              const inRole = role?.permissions.includes(p) ?? false;
              return (
                <div
                  key={p}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md px-1 py-1"
                >
                  <span className="text-sm">
                    {permissionLabels[p]}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {inRole ? "in role" : "not in role"}
                    </span>
                  </span>
                  <Segmented
                    size="small"
                    disabled={lockedAccess}
                    value={overrideOf(p)}
                    onChange={(v) => setOverride(p, v as Choice)}
                    options={[
                      { label: "As role", value: "role" },
                      { label: "Allow", value: "allow" },
                      { label: "Deny", value: "deny" },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {!user ? (
        <div className="space-y-2">
          <TextField
            label="Temporary password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            hint="At least 10 characters. The person must choose their own when they first sign in."
          />
          <Button
            variant="secondary"
            type="button"
            onClick={() => setPassword(temporaryPassword())}
          >
            Make another
          </Button>
        </div>
      ) : null}

      {user && accessChanged ? (
        <Alert
          type="warning"
          showIcon
          title="Changing role, branches or extra access signs this person out. They sign in again to get the change."
        />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <Button
        className="w-full"
        onClick={submit}
        disabled={!ready}
        loading={pending}
      >
        {user ? "Save changes" : "Add user"}
      </Button>
    </div>
  );
}

export function UserModal({
  open,
  user,
  isSelf,
  onClose,
  onCreated,
}: {
  open: boolean;
  user: ManagedUser | null;
  isSelf: boolean;
  onClose: () => void;
  onCreated: (u: ManagedUser, password: string) => void;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={user ? `Edit ${user.displayName}` : "Add a user"}
      footer={null}
      destroyOnHidden
      width={620}
    >
      <Form
        user={user}
        isSelf={isSelf}
        onDone={onClose}
        onCreated={onCreated}
      />
    </Modal>
  );
}
