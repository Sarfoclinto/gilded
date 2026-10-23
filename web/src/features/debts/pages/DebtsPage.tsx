import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Segmented, Table, Tag } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useDebts } from "../api";
import { LoanModal } from "../LoanModal";
import { RepayModal } from "../RepayModal";
import type { Debt } from "../schemas";

const statusTag = (s: string) =>
  s === "open" ? (
    <Tag color="orange">Open</Tag>
  ) : s === "settled" ? (
    <Tag color="green">Settled</Tag>
  ) : (
    <Tag>{s.replace("_", " ")}</Tag>
  );

export default function DebtsPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const [direction, setDirection] = useState<"receivable" | "payable">(
    "receivable",
  );
  const [openOnly, setOpenOnly] = useState(true);
  const list = useDebts({ branchId, direction, openOnly });
  const [loan, setLoan] = useState(false);
  const [repay, setRepay] = useState<Debt | null>(null);
  const rows = list.data ?? [];
  const total = rows
    .filter((d) => d.status === "open")
    .reduce((s, d) => s + Number(d.outstanding), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Debts and loans"
        subtitle="Money customers owe this branch, and money this branch owes them."
        actions={
          <Can permission={PERMISSIONS.DEBTS_MANAGE}>
            <Button onClick={() => setLoan(true)}>Give a loan</Button>
          </Can>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={direction}
          onChange={(v) => setDirection(v as "receivable" | "payable")}
          options={[
            { label: "Owed to us", value: "receivable" },
            { label: "We owe", value: "payable" },
          ]}
        />
        <Segmented
          value={openOnly ? "open" : "all"}
          onChange={(v) => setOpenOnly(v === "open")}
          options={[
            { label: "Open", value: "open" },
            { label: "All", value: "all" },
          ]}
        />
      </div>
      <p className="tnum text-sm text-muted-foreground">
        {direction === "receivable" ? "Customers owe" : "The branch owes"}{" "}
        <strong className="text-foreground">{cedis(total)}</strong> in total
      </p>
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<Debt>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={rows}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: 720 }}
        locale={{
          emptyText: openOnly ? "Nothing outstanding" : "Nothing recorded",
        }}
        expandable={{
          expandedRowRender: (d) => (
            <div className="space-y-2 text-sm">
              {d.reason ? <p>{d.reason}</p> : null}
              {d.collateral ? (
                <p>
                  Security: {d.collateral.topWeight} g unrefined gold (
                  {d.collateral.status})
                  {d.collateral.description
                    ? ` · ${d.collateral.description}`
                    : ""}{" "}
                  ·{" "}
                  <Link className="underline" to={paths.collateral.href}>
                    held gold
                  </Link>
                </p>
              ) : null}
              {d.sourceTransactionId ? (
                <p>
                  <Link
                    className="underline"
                    to={paths.transactions.detail.to(d.sourceTransactionId)}
                  >
                    From a purchase
                  </Link>
                </p>
              ) : null}
              {d.repayments.length ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {d.repayments.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span>
                        {when(r.receivedAt)} ·{" "}
                        {r.method === "gold"
                          ? "settled with gold"
                          : r.method.replace("_", " ")}
                        {r.note ? ` · ${r.note}` : ""}
                      </span>
                      <strong className="tnum">
                        {cedis(Number(r.amount))}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No payments yet.</p>
              )}
            </div>
          ),
        }}
        columns={[
          {
            title: "Who",
            render: (_: unknown, d) => (
              <div>
                <div className="font-medium">{d.party.name}</div>
                <div className="text-xs text-muted-foreground">
                  {d.party.phone ?? d.party.type}
                </div>
              </div>
            ),
          },
          {
            title: "Since",
            dataIndex: "issuedAt",
            render: (v: string, d) => (
              <div>
                <div>{when(v)}</div>
                {d.dueDate ? (
                  <div className="text-xs text-muted-foreground">
                    due {d.dueDate}
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            title: "Amount",
            dataIndex: "principal",
            align: "right",
            render: (v: string) => (
              <span className="tnum">{cedis(Number(v))}</span>
            ),
          },
          {
            title: "Outstanding",
            dataIndex: "outstanding",
            align: "right",
            render: (v: string) => (
              <strong className="tnum">{cedis(Number(v))}</strong>
            ),
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string, d) => (
              <>
                {statusTag(s)}
                {d.collateral?.status === "held" ? (
                  <Tag color="gold">Gold held</Tag>
                ) : null}
              </>
            ),
          },
          {
            title: "",
            align: "right",
            render: (_: unknown, d) =>
              d.status === "open" ? (
                <Can permission={PERMISSIONS.DEBTS_MANAGE}>
                  <Button variant="secondary" onClick={() => setRepay(d)}>
                    {d.direction === "receivable" ? "Repayment" : "Pay"}
                  </Button>
                </Can>
              ) : null,
          },
        ]}
      />
      <LoanModal open={loan} onClose={() => setLoan(false)} />
      <RepayModal debt={repay} onClose={() => setRepay(null)} />
    </div>
  );
}
