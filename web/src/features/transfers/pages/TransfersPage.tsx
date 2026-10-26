import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Segmented, Table } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useTransfers } from "../api";
import { purposeLabel, StatusChip } from "../labels";
import type { TransferRow } from "../schemas";

type Direction = "all" | "outgoing" | "incoming";

export default function TransfersPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>("all");
  const [status, setStatus] = useState<string>("");
  const list = useTransfers({
    branchId,
    direction,
    ...(status ? { status } : {}),
  });
  const rows = list.data ?? [];
  const waiting = (
    useTransfers({ branchId, direction: "incoming", status: "released" })
      .data ?? []
  ).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Transfers"
        subtitle="Gold and cash moving between branches."
        actions={
          <Can permission={PERMISSIONS.TRANSFERS_CREATE}>
            <Link to={paths.transfers.create.href}>
              <Button>New transfer</Button>
            </Link>
          </Can>
        }
      />
      {waiting > 0 ? (
        <Alert
          type="info"
          showIcon
          title={`${waiting} transfer${waiting === 1 ? " is" : "s are"} on the way to this branch.`}
          action={
            <button
              type="button"
              className="text-sm font-medium underline"
              onClick={() => {
                setDirection("incoming");
                setStatus("released");
              }}
            >
              Show
            </button>
          }
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={direction}
          onChange={(v) => setDirection(v as Direction)}
          options={[
            { label: "All", value: "all" },
            { label: "Sent from here", value: "outgoing" },
            { label: "Coming here", value: "incoming" },
          ]}
        />
        <Segmented
          value={status}
          onChange={(v) => setStatus(String(v))}
          options={[
            { label: "Any", value: "" },
            { label: "Draft", value: "draft" },
            { label: "On the way", value: "released" },
            { label: "Received", value: "received" },
            { label: "Differences", value: "received_with_discrepancy" },
          ]}
        />
      </div>
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<TransferRow>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={rows}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: 720 }}
        locale={{ emptyText: "No transfers yet" }}
        onRow={(r) => ({
          onClick: () => navigate(paths.transfers.detail.to(r.id)),
          style: { cursor: "pointer" },
        })}
        columns={[
          {
            title: "Transfer",
            render: (_: unknown, r) => (
              <div>
                <div className="font-medium">{r.reference}</div>
                <div className="text-xs text-muted-foreground">
                  {r.kind === "cash"
                    ? "Cash"
                    : `${r.lineCount} piece${r.lineCount === 1 ? "" : "s"}`}{" "}
                  · {purposeLabel[r.purpose] ?? r.purpose}
                </div>
              </div>
            ),
          },
          {
            title: "From → to",
            render: (_: unknown, r) =>
              `${r.originBranchName} → ${r.destinationBranchName}`,
          },
          {
            title: "Carried by",
            dataIndex: "collectorName",
            render: (v: string | null | undefined) => v ?? "—",
          },
          {
            title: "Worth",
            align: "right",
            render: (_: unknown, r) => (
              <span className="tnum">
                {r.declaredValue ? cedis(Number(r.declaredValue)) : "—"}
              </span>
            ),
          },
          {
            title: "When",
            render: (_: unknown, r) => when(r.releasedAt ?? r.createdAt),
          },
          {
            title: "Status",
            render: (_: unknown, r) => <StatusChip status={r.status} />,
          },
        ]}
      />
    </div>
  );
}
