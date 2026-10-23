import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Input, Modal, Segmented, Table, Tag } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { grams } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useCollateral, useReturnCollateral } from "../api";
import type { Collateral } from "../schemas";

const tag = (s: Collateral["status"]) =>
  s === "held" ? (
    <Tag color="gold">Held</Tag>
  ) : s === "converted" ? (
    <Tag color="green">Refined and bought</Tag>
  ) : (
    <Tag>Handed back</Tag>
  );

export default function CollateralPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const [status, setStatus] = useState<"held" | "all">("held");
  const list = useCollateral({
    branchId,
    ...(status === "held" ? { status: "held" as const } : {}),
  });
  const [giveBack, setGiveBack] = useState<Collateral | null>(null);
  const [note, setNote] = useState("");
  const ret = useReturnCollateral();
  const rows = list.data ?? [];
  const heldTotal = rows
    .filter((c) => c.status === "held")
    .reduce((s, c) => s + Number(c.topWeight), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Held gold"
        subtitle="Unrefined gold customers left as security for a loan. It has no value until it is refined and bought."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={status}
          onChange={(v) => setStatus(v as "held" | "all")}
          options={[
            { label: "Still held", value: "held" },
            { label: "All", value: "all" },
          ]}
        />
        <span className="tnum text-sm text-muted-foreground">
          Held now:{" "}
          <strong className="text-foreground">{grams(heldTotal)}</strong>
        </span>
      </div>
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<Collateral>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={rows}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: 680 }}
        locale={{ emptyText: "No gold is held" }}
        columns={[
          {
            title: "Customer",
            render: (_: unknown, c) => (
              <div>
                <div className="font-medium">{c.customer.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.customer.phone ?? ""}
                </div>
              </div>
            ),
          },
          {
            title: "Top weight",
            dataIndex: "topWeight",
            align: "right",
            render: (v: string) => <strong className="tnum">{grams(v)}</strong>,
          },
          {
            title: "Still owes",
            dataIndex: "debtOutstanding",
            align: "right",
            render: (v?: string | null) =>
              v ? <span className="tnum">{cedis(Number(v))}</span> : "—",
          },
          {
            title: "Received",
            dataIndex: "receivedAt",
            render: (v: string, c) => (
              <div>
                <div>{when(v)}</div>
                <div className="text-xs text-muted-foreground">
                  {c.description ?? ""}
                </div>
              </div>
            ),
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: Collateral["status"], c) => (
              <div>
                {tag(s)}
                {c.convertedTransactionId ? (
                  <div>
                    <Link
                      className="text-xs underline"
                      to={paths.transactions.detail.to(
                        c.convertedTransactionId,
                      )}
                    >
                      See purchase
                    </Link>
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            title: "",
            align: "right",
            render: (_: unknown, c) =>
              c.status === "held" ? (
                <div className="flex justify-end gap-2">
                  <Can permission={PERMISSIONS.DEBTS_MANAGE}>
                    <Button
                      variant="secondary"
                      disabled={Number(c.debtOutstanding ?? 0) > 0}
                      title={
                        Number(c.debtOutstanding ?? 0) > 0
                          ? "The loan must be paid first"
                          : undefined
                      }
                      onClick={() => {
                        setNote("");
                        setGiveBack(c);
                      }}
                    >
                      Hand back
                    </Button>
                  </Can>
                  <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
                    <Link to={paths.transactions.createFromHeld.to(c.id)}>
                      <Button>Refine and buy</Button>
                    </Link>
                  </Can>
                </div>
              ) : null,
          },
        ]}
      />
      <Modal
        open={!!giveBack}
        title={
          giveBack
            ? `Hand back ${grams(giveBack.topWeight)} to ${giveBack.customer.name}`
            : ""
        }
        onCancel={() => setGiveBack(null)}
        okText="Hand back"
        okButtonProps={{ loading: ret.isPending }}
        onOk={() =>
          giveBack &&
          ret.mutate(
            { id: giveBack.id, note: note.trim() || null },
            { onSuccess: () => setGiveBack(null) },
          )
        }
        destroyOnHidden
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Use this when the gold goes back to the customer unrefined. It is only
          allowed once the loan has been fully paid.
        </p>
        <Input.TextArea
          rows={2}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
        />
        {ret.error ? (
          <p className="mt-2 text-sm text-red-600">{ret.error.message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
