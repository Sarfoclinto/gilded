import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert } from "antd";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { branches } from "@/features/branches/api";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
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
import {
  effectiveWith,
  pendingBranches,
  priceChange,
  staleDays,
  updatedText,
  validMargin,
  validPrice,
} from "../model";

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
  const changed = price ? margin.trim() !== price.margin : margin.trim() !== "";
  const days = price ? staleDays(price.asOf) : 0;
  const preview =
    price && changed ? effectiveWith(price.basePrice, margin.trim()) : null;
  return (
    <Card
      className={`space-y-3 ${price?.status === "provisional" ? "border-amber-400/70" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{name}</h2>
          {price ? (
            <p
              className={`text-xs ${days >= 2 ? "text-amber-700" : "text-muted-foreground"}`}
            >
              {updatedText(days)} · {when(price.asOf)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tellers cannot buy here until a price is set.
            </p>
          )}
        </div>
        {price ? (
          <div className="text-right">
            <div className="tnum text-2xl font-bold">
              {cedis(price.effectivePrice)}
            </div>
            <Chip tone={price.status === "approved" ? "green" : "amber"}>
              {price.status === "approved"
                ? "Approved"
                : "Waiting for approval"}
            </Chip>
          </div>
        ) : (
          <Chip tone="red">No price yet</Chip>
        )}
      </div>
      {price ? (
        <p className="tnum text-xs text-muted-foreground">
          Reference {cedis(price.basePrice)} + margin {cedis(price.margin)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          className="w-44"
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
      </div>
      {preview ? (
        <p className="tnum text-sm">
          With this margin the price becomes <strong>{cedis(preview)}</strong>{" "}
          per pound.
        </p>
      ) : null}
    </Card>
  );
}

export default function PricesPage() {
  const canApprove = useHasPermission(PERMISSIONS.PRICES_APPROVE);
  const list = branches.useList();
  const branchList = list.data ?? [];
  const prices = useBranchPrices(branchList.map((b) => b.id));
  const setBase = useSetBasePrice();
  const approve = useApproveMargin();
  const [base, setBaseText] = useState("");
  const [checked, setChecked] = useState(false);
  const [approving, setApproving] = useState(false);
  const loaded = prices.map((q) => q.data);
  const current = loaded.find((p): p is CurrentPrice => !!p);
  const waiting = pendingBranches(loaded);
  const change = priceChange(current?.basePrice, base.trim());
  const needsCheck = change?.level === "warn";
  const canPublish =
    validPrice(base) && (!needsCheck || checked) && change?.level !== "same";
  const missing = branchList.filter(
    (_, i) => prices[i]?.isSuccess && !prices[i]?.data,
  ).length;

  async function approveAll() {
    setApproving(true);
    try {
      for (const p of waiting) await approve.mutateAsync(p.branchId);
    } catch {
      /* the failing request already showed its own message */
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 pb-8 sm:p-4 lg:p-6">
      <PageHeader
        title="Prices"
        subtitle="One reference price for everyone, plus a margin for each branch."
        actions={
          <Link to={paths.priceFeed.href}>
            <Button variant="secondary">Automatic price</Button>
          </Link>
        }
      />

      <section
        className="rounded-2xl bg-navy p-4 text-white sm:p-5"
        aria-label="Reference price"
      >
        <div className="text-sm text-white/70">
          Reference price per pound (GoldBod)
        </div>
        <div className="tnum text-4xl font-bold text-gold">
          {current ? cedis(current.basePrice) : "Not set yet"}
        </div>
        {current ? (
          <div className="text-xs text-white/60">
            {current.source === "goldbod"
              ? "From the automatic price"
              : "Set by hand"}{" "}
            · {updatedText(staleDays(current.asOf)).toLowerCase()}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-white/10 pt-4">
          <label className="block">
            <span className="mb-1 block text-sm text-white/80">
              New price (GHS)
            </span>
            <input
              inputMode="decimal"
              value={base}
              onChange={(e) => {
                setBaseText(decimalOnly(e.target.value));
                setChecked(false);
              }}
              className="tnum min-h-11 w-48 rounded-lg border border-white/20 bg-white/10 px-3 text-white outline-none placeholder:text-white/40 focus:border-gold"
              placeholder="e.g. 41250"
            />
          </label>
          <button
            type="button"
            disabled={!canPublish || setBase.isPending}
            onClick={() =>
              setBase.mutate(base.trim(), {
                onSuccess: () => {
                  setBaseText("");
                  setChecked(false);
                },
              })
            }
            className="min-h-11 rounded-lg bg-gold px-5 text-sm font-semibold text-navy hover:opacity-90 disabled:opacity-50"
          >
            {setBase.isPending ? "Publishing…" : "Publish"}
          </button>
        </div>
        {change && change.level !== "same" ? (
          <p
            className={`mt-2 text-sm ${needsCheck ? "text-amber-300" : "text-white/70"}`}
          >
            {Math.abs(change.pct).toFixed(1)}%{" "}
            {change.pct > 0 ? "higher" : "lower"} than now.
            {needsCheck ? " That is a big move." : ""}
          </p>
        ) : change?.level === "same" ? (
          <p className="mt-2 text-sm text-white/70">
            That is the price already in use.
          </p>
        ) : null}
        {needsCheck ? (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I checked this number against GoldBod
          </label>
        ) : null}
        <p className="mt-3 text-xs text-white/60">
          Publishing keeps every branch’s margin and whether it was approved.
        </p>
      </section>

      {list.error ? (
        <Alert type="error" showIcon title={errorMessage(list.error)} />
      ) : null}
      {setBase.error ? (
        <Alert type="error" showIcon title={setBase.error.message} />
      ) : null}
      {!canApprove ? (
        <Alert
          type="info"
          showIcon
          title="You can set margins. The director approves them; until then the price is marked as waiting for approval."
        />
      ) : null}
      {missing > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`${missing} branch${missing > 1 ? "es have" : " has"} no price yet. Publish a reference price and set a margin.`}
        />
      ) : null}
      {canApprove && waiting.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/70 bg-amber-500/10 p-3 text-sm">
          <span>
            <strong>
              {waiting.length} margin{waiting.length > 1 ? "s are" : " is"}{" "}
              waiting for approval.
            </strong>{" "}
            Branches buy at these prices already, marked as provisional.
          </span>
          <Button onClick={() => void approveAll()} loading={approving}>
            Approve all
          </Button>
        </div>
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
        <div
          className="h-32 animate-pulse rounded-xl border border-border bg-muted/50"
          aria-busy="true"
        />
      ) : null}
    </div>
  );
}
