import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Segmented, Table } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { when } from "@/features/transactions/format";
import { usePendingPayments, type PendingPayment } from "./api";
import { ResolvePaymentModal, type ResolveTarget } from "./ResolvePaymentModal";

/** Mobile money parts of purchases that are waiting: ones this branch must send, and ones other branches are sending for it. */
export default function PendingPaymentsPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const canConfirm = useHasPermission(PERMISSIONS.PAYMENTS_CONFIRM);
  const [role, setRole] = useState<"sending" | "receiving">(
    canConfirm ? "sending" : "receiving",
  );
  const list = usePendingPayments(branchId, role);
  const [target, setTarget] = useState<ResolveTarget | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <h1 className="text-xl font-bold">Mobile money</h1>
      <Segmented
        value={role}
        onChange={(v) => setRole(v as "sending" | "receiving")}
        options={[
          ...(canConfirm
            ? [{ label: "This branch must send", value: "sending" }]
            : []),
          { label: "Other branches sending for us", value: "receiving" },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        {role === "sending"
          ? "Customers of other branches are waiting for this money. Send it from your mobile money account, then mark it as received here."
          : "These customers were paid partly by mobile money from another branch. They are not counted as paid until that branch confirms."}
      </p>
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<PendingPayment>
        rowKey="paymentId"
        size="middle"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: 640 }}
        locale={{ emptyText: "Nothing is waiting" }}
        columns={[
          {
            title: "Customer",
            dataIndex: "customerName",
            render: (v: string, p) => (
              <div>
                <div className="font-medium">{v}</div>
                <Link
                  className="text-xs underline"
                  to={paths.transactions.detail.to(p.transactionId)}
                >
                  {p.reference ?? "Open purchase"}
                </Link>
              </div>
            ),
          },
          {
            title: "Amount",
            dataIndex: "amount",
            align: "right",
            render: (v: string) => (
              <strong className="tnum">{cedis(Number(v))}</strong>
            ),
          },
          {
            title: role === "sending" ? "Bought at" : "Sent by",
            render: (_: unknown, p) =>
              role === "sending" ? p.purchaseBranchName : p.sendingBranchName,
          },
          {
            title: "Reference",
            dataIndex: "externalRef",
            render: (v?: string | null) => v ?? "—",
          },
          {
            title: "Since",
            dataIndex: "createdAt",
            render: (v: string) => when(v),
          },
          {
            title: "",
            align: "right",
            render: (_: unknown, p) =>
              role === "sending" && canConfirm ? (
                <Button
                  onClick={() =>
                    setTarget({
                      transactionId: p.transactionId,
                      paymentId: p.paymentId,
                      amount: p.amount,
                      customerName: p.customerName,
                      reference: p.reference,
                    })
                  }
                >
                  Resolve
                </Button>
              ) : null,
          },
        ]}
      />
      <ResolvePaymentModal target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
