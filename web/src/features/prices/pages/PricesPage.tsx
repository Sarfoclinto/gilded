import { useState } from "react";
import { Alert } from "antd";
import { PERMISSIONS } from "@/config/permissions";
import { branches } from "@/features/branches/api";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { errorMessage } from "@/shared/api/errors";
import { decimalOnly } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Chip } from "@/shared/ui/Chip";
import { PageHeader } from "@/shared/ui/PageHeader";
import { TextField } from "@/shared/ui/TextField";
import {
  useApproveMargin,
  useBranchPrices,
  useSetBasePrice,
  useSetMargin,
  type CurrentPrice,
} from "../api";

const validPrice = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;
const validMargin = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

function BranchRow({
  branchId,
  name,
  price,
  canApprove,
}: {
  branchId: string;
  name: string;
  price: CurrentPrice | null;
  canApprove: boolean;
}) {
  const [margin, setMargin] = useState(price?.margin ?? "");
  const setM = useSetMargin();
  const approve = useApproveMargin();
  const changed = price ? margin.trim() !== price.margin : margin.trim() !== "";
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{name}</h2>
        {price ? (
          <div className="flex items-center gap-2">
            <span className="tnum text-lg font-bold">
              {cedis(price.effectivePrice)}
            </span>
            <Chip tone={price.status === "approved" ? "green" : "amber"}>
              {price.status === "approved"
                ? "Approved"
                : "Waiting for approval"}
            </Chip>
          </div>
        ) : (
          <Chip tone="grey">No price yet</Chip>
        )}
      </div>
      {price ? (
        <p className="tnum text-xs text-muted-foreground">
          Reference {price.basePrice} + margin {price.margin}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          className="w-40"
          label="Margin (GHS per pound)"
          inputMode="decimal"
          value={margin}
          onChange={(e) => setMargin(decimalOnly(e.target.value))}
        />
        <Button
          variant="secondary"
          disabled={!validMargin(margin) || !changed}
          loading={setM.isPending}
          onClick={() =>
            void setM.mutate({
              branchId,
              margin: margin.trim(),
              approve: false,
            })
          }
        >
          Save
        </Button>
        {canApprove ? (
          <Button
            disabled={
              !validMargin(margin) || (!changed && price?.status === "approved")
            }
            loading={setM.isPending}
            onClick={() =>
              void setM.mutate({
                branchId,
                margin: margin.trim(),
                approve: true,
              })
            }
          >
            {changed ? "Save and approve" : "Approve"}
          </Button>
        ) : null}
        {canApprove && price && price.status === "provisional" && !changed ? (
          <Button
            variant="ghost"
            loading={approve.isPending}
            onClick={() => approve.mutate(price.branchId)}
          >
            Approve as it is
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export default function PricesPage() {
  const canApprove = useHasPermission(PERMISSIONS.PRICES_APPROVE);
  const list = branches.useList();
  const branchList = list.data ?? [];
  const prices = useBranchPrices(branchList.map((b) => b.id));
  const setBase = useSetBasePrice();
  const [base, setBaseText] = useState("");
  const current = prices.map((q) => q.data).find((p): p is CurrentPrice => !!p);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <PageHeader
        title="Prices"
        subtitle="One reference price for everyone, plus a margin for each branch."
      />

      <Card className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">
            Reference price per pound (GoldBod)
          </h2>
          <p className="text-sm text-muted-foreground">
            {current ? `Now ${cedis(current.basePrice)}. ` : "Not set yet. "}
            Publishing a new price keeps every branch's margin and whether it
            was approved.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            className="w-48"
            label="New price (GHS)"
            inputMode="decimal"
            value={base}
            onChange={(e) => setBaseText(decimalOnly(e.target.value))}
          />
          <Button
            disabled={!validPrice(base)}
            loading={setBase.isPending}
            onClick={() =>
              setBase.mutate(base.trim(), { onSuccess: () => setBaseText("") })
            }
          >
            Publish
          </Button>
        </div>
      </Card>

      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      {!canApprove ? (
        <Alert
          type="info"
          showIcon
          title="You can set margins. The director approves them; until then the price is marked as waiting for approval."
        />
      ) : null}

      {branchList.map((b, i) => (
        <BranchRow
          key={`${b.id}:${prices[i]?.data?.margin ?? ""}:${prices[i]?.data?.status ?? ""}`}
          branchId={b.id}
          name={`${b.name}${b.isMain ? " (main)" : ""}`}
          price={prices[i]?.data ?? null}
          canApprove={canApprove}
        />
      ))}
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
    </div>
  );
}
