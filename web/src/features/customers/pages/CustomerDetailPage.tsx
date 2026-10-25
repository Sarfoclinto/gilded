import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Tag } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { grams } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useCustomerDetail } from "../api";
import { CustomerFormModal } from "../CustomerFormModal";
import { MergeModal } from "../MergeModal";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const query = useCustomerDetail(id);
  const c = query.data;
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);

  if (query.isLoading)
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!c) {
    return (
      <div className="p-4 space-y-2">
        <Alert
          type="error"
          showIcon
          title={
            query.error ? errorMessage(query.error) : "Customer not found."
          }
        />
        <Link className="text-sm underline" to={paths.people.customers.href}>
          Back to customers
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-8">
      <Link
        to={paths.people.customers.href}
        className="text-sm text-muted-foreground underline"
      >
        ← Customers
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{c.name}</h1>
          <p className="text-sm text-muted-foreground">
            {c.phone ?? "No phone"} · customer since {when(c.createdAt)}
          </p>
          {c.notes ? <p className="mt-1 text-sm">{c.notes}</p> : null}
        </div>
        <Can permission={PERMISSIONS.CUSTOMERS_MANAGE}>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setMerging(true)}>
              Merge a duplicate
            </Button>
          </div>
        </Can>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <div className="text-xs text-muted-foreground">Purchases</div>
          <div className="tnum text-2xl font-bold">{c.purchases}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground">Owes us</div>
          <div className="tnum text-2xl font-bold">
            {cedis(Number(c.owesUs))}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-muted-foreground">We owe</div>
          <div className="tnum text-2xl font-bold">
            {cedis(Number(c.weOwe))}
          </div>
        </Card>
      </div>

      <Card className="space-y-2">
        <h2 className="text-base font-semibold">Recent purchases</h2>
        {c.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchases yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {c.transactions.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <Link
                    className="font-medium underline"
                    to={paths.transactions.detail.to(t.id)}
                  >
                    {t.reference}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {when(t.capturedAt)} · {t.branchName}
                    {t.customerName !== c.name
                      ? ` · recorded as “${t.customerName}”`
                      : ""}
                  </div>
                </div>
                <strong className="tnum">{cedis(Number(t.payable))}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-base font-semibold">Debts and loans</h2>
        {c.debts.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {c.debts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <div className="font-medium">
                    {d.direction === "receivable" ? "Owes us" : "We owe them"} ·{" "}
                    {d.reason ?? "Debt"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {when(d.issuedAt)} · {cedis(Number(d.principal))} in total
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Tag color={d.status === "open" ? "orange" : "green"}>
                    {d.status === "open" ? "Open" : d.status.replace("_", " ")}
                  </Tag>
                  <strong className="tnum">
                    {cedis(Number(d.outstanding))}
                  </strong>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link to={paths.debts.href} className="text-xs underline">
          Go to debts
        </Link>
      </Card>

      {c.held.length > 0 ? (
        <Card className="space-y-2">
          <h2 className="text-base font-semibold">Gold held as security</h2>
          <ul className="divide-y divide-border text-sm">
            {c.held.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span>
                  {grams(h.topWeight)} · {when(h.receivedAt)}
                  {h.description ? ` · ${h.description}` : ""}
                </span>
                <Tag
                  color={
                    h.status === "held"
                      ? "gold"
                      : h.status === "converted"
                        ? "green"
                        : undefined
                  }
                >
                  {h.status === "held"
                    ? "Held"
                    : h.status === "converted"
                      ? "Refined and bought"
                      : "Handed back"}
                </Tag>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <CustomerFormModal
        open={editing}
        customer={c}
        onClose={() => setEditing(false)}
        onDone={() => setEditing(false)}
      />
      <MergeModal keep={merging ? c : null} onClose={() => setMerging(false)} />
    </div>
  );
}
