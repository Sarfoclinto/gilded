import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Input, Table } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { useDebounced } from "@/shared/lib/useDebounced";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useCustomerPage, type CustomerRow } from "../api";
import { CustomerFormModal } from "../CustomerFormModal";

const PAGE = 20;

export default function CustomersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const text = useDebounced(q, 300);
  const list = useCustomerPage(text, page, PAGE);
  const [adding, setAdding] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Customers"
        subtitle="Everyone the business has bought from or lent to."
        actions={
          <Can permission={PERMISSIONS.CUSTOMERS_MANAGE}>
            <Button onClick={() => setAdding(true)}>Add a customer</Button>
          </Can>
        }
      />
      <Input.Search
        size="large"
        allowClear
        placeholder="Search by name or phone"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      <Table<CustomerRow>
        rowKey="id"
        size="middle"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        scroll={{ x: 680 }}
        pagination={{
          current: page,
          pageSize: PAGE,
          total: list.data?.total ?? 0,
          showSizeChanger: false,
          hideOnSinglePage: true,
          onChange: setPage,
        }}
        locale={{
          emptyText: text ? "No customer matches" : "No customers yet",
        }}
        onRow={(c) => ({
          onClick: () => navigate(paths.people.customer.to(c.id)),
          style: { cursor: "pointer" },
        })}
        columns={[
          {
            title: "Name",
            dataIndex: "name",
            render: (v: string, c) => (
              <Link
                to={paths.people.customer.to(c.id)}
                className="font-medium underline-offset-2 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {v}
              </Link>
            ),
          },
          {
            title: "Phone",
            dataIndex: "phone",
            render: (v?: string | null) => v ?? "—",
          },
          { title: "Purchases", dataIndex: "purchases", align: "right" },
          {
            title: "Last purchase",
            dataIndex: "lastPurchaseAt",
            render: (v?: string | null) => (v ? when(v) : "—"),
          },
          {
            title: "Owes us",
            dataIndex: "owesUs",
            align: "right",
            render: (v: string) =>
              Number(v) > 0 ? (
                <strong className="tnum">{cedis(Number(v))}</strong>
              ) : (
                "—"
              ),
          },
          {
            title: "We owe",
            dataIndex: "weOwe",
            align: "right",
            render: (v: string) =>
              Number(v) > 0 ? (
                <strong className="tnum">{cedis(Number(v))}</strong>
              ) : (
                "—"
              ),
          },
        ]}
      />
      <CustomerFormModal
        open={adding}
        customer={null}
        onClose={() => setAdding(false)}
        onDone={(c) => {
          setAdding(false);
          navigate(paths.people.customer.to(c.id));
        }}
      />
    </div>
  );
}
