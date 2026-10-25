import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Modal, Table, Tag } from "antd";
import paths from "@/config/paths";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import {
  useManagedBranches,
  useUpdateBranch,
  type ManagedBranch,
} from "../api";
import { BranchModal } from "../BranchModal";

export default function BranchesPage() {
  const list = useManagedBranches();
  const update = useUpdateBranch();
  const [editing, setEditing] = useState<{
    branch: ManagedBranch | null;
  } | null>(null);
  const [toggle, setToggle] = useState<ManagedBranch | null>(null);
  const [added, setAdded] = useState<ManagedBranch | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Branches"
        subtitle="Where the business buys gold. A switched-off branch keeps its history but takes no new work."
        actions={
          <Button onClick={() => setEditing({ branch: null })}>
            Add a branch
          </Button>
        }
      />
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<ManagedBranch>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        pagination={false}
        scroll={{ x: 620 }}
        columns={[
          {
            title: "Name",
            dataIndex: "name",
            render: (v: string, b) => (
              <div>
                <div className="font-medium">{v}</div>
                <div className="text-xs text-muted-foreground">{b.code}</div>
              </div>
            ),
          },
          { title: "Time zone", dataIndex: "timezone" },
          {
            title: "Status",
            render: (_: unknown, b) => (
              <div>
                {b.isMain ? <Tag color="gold">Main</Tag> : null}
                {b.isActive ? (
                  <Tag color="green">Active</Tag>
                ) : (
                  <Tag>Switched off</Tag>
                )}
                {b.dayOpen ? <Tag color="blue">Day open</Tag> : null}
              </div>
            ),
          },
          {
            title: "",
            align: "right",
            render: (_: unknown, b) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setEditing({ branch: b })}
                >
                  Edit
                </Button>
                {!b.isMain ? (
                  <Button
                    variant="ghost"
                    disabled={b.isActive && b.dayOpen}
                    title={
                      b.isActive && b.dayOpen
                        ? "Close its day first"
                        : undefined
                    }
                    onClick={() => setToggle(b)}
                  >
                    {b.isActive ? "Switch off" : "Switch on"}
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]}
      />
      <BranchModal
        open={!!editing}
        branch={editing?.branch ?? null}
        onClose={() => setEditing(null)}
        onDone={(b) => {
          const wasNew = !editing?.branch;
          setEditing(null);
          if (wasNew) setAdded(b);
        }}
      />

      <Modal
        open={!!added}
        title={added ? `${added.name} is ready` : ""}
        onCancel={() => setAdded(null)}
        footer={<Button onClick={() => setAdded(null)}>Done</Button>}
        destroyOnHidden
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            <Link className="underline" to={paths.people.users.href}>
              Users
            </Link>
            : give each person who works there this branch. Directors see every
            branch but must sign out and in once.
          </li>
          <li>
            <Link className="underline" to={paths.prices.href}>
              Prices
            </Link>
            : set the branch's margin, so purchases there have a price.
          </li>
          <li>The branch opens its first day from the Cash drawer.</li>
        </ol>
      </Modal>

      <Modal
        open={!!toggle}
        title={
          toggle
            ? `${toggle.isActive ? "Switch off" : "Switch on"} ${toggle.name}?`
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
            ? "People can no longer work in this branch. Its history stays."
            : "The branch takes work again."}
        </p>
        {update.error ? (
          <p className="mt-2 text-sm text-red-600">{update.error.message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
