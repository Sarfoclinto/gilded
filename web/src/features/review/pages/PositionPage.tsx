import { Alert } from "antd";
import { cedis } from "@/features/calculator/format";
import { errorMessage } from "@/shared/api/errors";
import { Card } from "@/shared/ui/Card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { usePosition } from "../api";

export default function PositionPage() {
  const q = usePosition();
  const rows = q.data ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Between branches"
        subtitle="What each branch has sent to another, or paid on its behalf, since the beginning."
      />
      {q.error ? (
        <Alert type="error" showIcon title={errorMessage(q.error)} />
      ) : null}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {!q.isLoading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has moved between branches yet.
        </p>
      ) : null}
      {rows.map((r) => (
        <Card
          key={`${r.senderBranchId}-${r.receiverBranchId}`}
          className="space-y-2"
        >
          <h2 className="text-base font-semibold">
            {r.senderName} → {r.receiverName}
          </h2>
          <dl className="tnum grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Cash handed over</dt>
              <dd className="font-semibold">{cedis(Number(r.cashSent))}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Gold handed over (value)
              </dt>
              <dd className="font-semibold">
                {cedis(Number(r.goodsValueSent))}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Mobile money {r.senderName} paid for {r.receiverName}
              </dt>
              <dd className="font-semibold">
                {cedis(Number(r.mobileMoneyPaidOnBehalf))}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Mobile money that failed, {r.receiverName} paid cash,{" "}
                {r.senderName} still has to hand over
              </dt>
              <dd className="font-semibold">
                {cedis(Number(r.mobileMoneyFailedCoveredByCash))}
              </dd>
            </div>
          </dl>
        </Card>
      ))}
    </div>
  );
}
