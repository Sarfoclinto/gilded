import { useState } from "react";
import { Alert, Modal, Table, Tag } from "antd";
import { useAuth } from "@/features/auth/store";
import { useBranchNames } from "@/features/branches/api";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useUpdateUser, useUsers } from "../api";
import { PasswordShownModal } from "../PasswordShownModal";
import { ResetPasswordModal } from "../ResetPasswordModal";
import type { ManagedUser } from "../schemas";
import { UserModal } from "../UserModal";

export default function UsersPage() {
  const me = useAuth((s) => s.user?.id);
  const branchNames = useBranchNames();
  const list = useUsers();
  const update = useUpdateUser();
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
      <Table<ManagedUser>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 760 }}
        columns={[
          {
            title: "Name",
            render: (_: unknown, u) => (
              <div>
                <div className="font-medium">
                  {u.displayName}
                  {u.id === me ? " (you)" : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {u.username}
                </div>
              </div>
            ),
          },
          {
            title: "Role",
            render: (_: unknown, u) => (
              <div>
                <Tag>{u.role.name}</Tag>
                {u.overrides.length ? (
                  <Tag color="gold">+{u.overrides.length} extra</Tag>
                ) : null}
              </div>
            ),
          },
          {
            title: "Branches",
            render: (_: unknown, u) =>
              u.permissions.includes("branches:all")
                ? "All"
                : u.branchIds.map((b) => branchNames[b] ?? "…").join(", ") ||
                  "—",
          },
          {
            title: "Status",
            render: (_: unknown, u) => (
              <div>
                {u.isActive ? (
                  <Tag color="green">Active</Tag>
                ) : (
                  <Tag>Switched off</Tag>
                )}
                {u.mustChangePassword ? (
                  <Tag color="orange">New password pending</Tag>
                ) : null}
              </div>
            ),
          },
          {
            title: "Last sign-in",
            dataIndex: "lastLoginAt",
            render: (v?: string | null) => (v ? when(v) : "Never"),
          },
          {
            title: "",
            align: "right",
            render: (_: unknown, u) => (
              <div className="flex justify-end gap-2">
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
            ),
          },
        ]}
      />

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
