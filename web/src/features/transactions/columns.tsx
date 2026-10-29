import type { ReactNode } from "react";
import { cedis } from "@/features/calculator/format";
import { grams } from "@/shared/lib/numbers";
import { Chip } from "@/shared/ui/Chip";
import type { Column } from "@/shared/ui/DataTable";
import { when } from "./format";
import { SyncChip } from "./SyncChip";
import { paymentMethodText, type TransactionView } from "./view";

export const netGrams = (t: TransactionView) =>
  t.items.reduce((s, i) => s + Number(i.result?.netWeight ?? 0), 0);
const methods = (t: TransactionView) => [
  ...new Set(t.payments.map((p) => p.method)),
];

export function StatusCell({ t }: { t: TransactionView }) {
  if (t.status === "void") return <Chip tone="red">Cancelled</Chip>;
  return (
    <SyncChip
      sync={t.sync}
      flags={t.flags}
      pendingMoney={t.payments.filter((x) => x.status === "pending").length}
    />
  );
}

function PaidBy({ t }: { t: TransactionView }) {
  return (
    <div className="flex flex-wrap gap-1">
      {methods(t).map((m) => (
        <Chip key={m} tone={m === "cash" ? "grey" : "sky"}>
          {paymentMethodText[m] ?? m}
        </Chip>
      ))}
    </div>
  );
}

/** The purchase list's columns. A customer's own page leaves out the customer and shows the branch instead. */
export function transactionColumns(
  opts: { showCustomer?: boolean; branchNames?: Record<string, string> } = {},
): Column<TransactionView>[] {
  const { showCustomer = true, branchNames } = opts;
  const cols: Column<TransactionView>[] = [
    {
      key: "when",
      header: "When",
      cell: (t) => (
        <span className="whitespace-nowrap">{when(t.capturedAt)}</span>
      ),
    },
    {
      key: "ref",
      header: "Receipt",
      cell: (t) => (
        <span className="whitespace-nowrap font-mono text-xs">
          {t.reference ?? "Not numbered yet"}
        </span>
      ),
    },
  ];
  if (showCustomer)
    cols.push({
      key: "customer",
      header: "Customer",
      cell: (t) => (
        <>
          <div className="font-semibold">{t.customerName}</div>
          {t.customerPhone ? (
            <div className="text-xs text-muted-foreground">
              {t.customerPhone}
            </div>
          ) : null}
        </>
      ),
    });
  else if (branchNames)
    cols.push({
      key: "branch",
      header: "Branch",
      hideBelow: "lg",
      cell: (t) => <span>{branchNames[t.branchId] ?? "—"}</span>,
    });
  cols.push(
    {
      key: "gold",
      header: "Gold",
      hideBelow: "lg",
      cell: (t) => (
        <span className="tnum whitespace-nowrap">
          {t.items.length} item{t.items.length === 1 ? "" : "s"} ·{" "}
          {grams(netGrams(t))}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Paid (GHS)",
      align: "right",
      cell: (t) => (
        <span
          className={`tnum font-bold ${t.status === "void" ? "text-muted-foreground line-through" : ""}`}
        >
          {cedis(t.payout.payable)}
        </span>
      ),
    },
    ...(showCustomer
      ? [
          {
            key: "method",
            header: "Paid by",
            hideBelow: "lg" as const,
            cell: (t: TransactionView) => <PaidBy t={t} />,
          },
        ]
      : []),
    { key: "status", header: "Status", cell: (t) => <StatusCell t={t} /> },
  );
  if (showCustomer)
    cols.push({
      key: "by",
      header: "Recorded by",
      hideBelow: "xl",
      cell: (t) => (
        <span className="text-muted-foreground">{t.createdBy ?? "—"}</span>
      ),
    });
  return cols;
}

/** One purchase on a phone. */
export function TransactionCard({
  t,
  showCustomer = true,
}: {
  t: TransactionView;
  showCustomer?: boolean;
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate font-semibold">
          {showCustomer ? t.customerName : (t.reference ?? "Not numbered yet")}
        </div>
        <div className="text-xs text-muted-foreground">
          {showCustomer ? `${t.reference ?? "Not numbered yet"} · ` : ""}
          {when(t.capturedAt)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t.items.length} item{t.items.length === 1 ? "" : "s"} ·{" "}
          {grams(netGrams(t))}
        </div>
      </div>
      <div className="text-right">
        <div
          className={`tnum font-bold ${t.status === "void" ? "text-muted-foreground line-through" : ""}`}
        >
          {cedis(t.payout.payable)}
        </div>
        <div className="mt-1">
          <StatusCell t={t} />
        </div>
      </div>
    </div>
  );
}
