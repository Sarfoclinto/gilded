import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { lineTotal } from "@gold/core";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can, useHasPermission } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { useCollateral, useDebts } from "@/features/debts/api";
import { useActiveDrawer, useDayHistory } from "@/features/drawer/hooks";
import { usePendingPayments } from "@/features/payments/api";
import { useCurrentPrice } from "@/features/prices/api";
import { grams } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

function Tile({
  to,
  title,
  children,
  wide,
}: {
  to: string;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Link to={to} className={wide ? "col-span-2 block lg:col-span-1" : "block"}>
      <Card className="h-full p-3 sm:p-4">
        <div className="text-sm text-muted-foreground">{title}</div>
        {children}
      </Card>
    </Link>
  );
}

function PriceTile() {
  const branchId = useAuth((s) => s.activeBranchId);
  const price = useCurrentPrice(branchId);
  return (
    <Tile to={paths.prices.href} title="Price per pound today" wide>
      {price.isLoading ? (
        <div className="mt-1 text-sm text-muted-foreground">Loading…</div>
      ) : price.data ? (
        <>
          <div className="tnum text-2xl font-bold sm:text-3xl">
            GHS {Number(price.data.effectivePrice).toLocaleString("en-GH")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            GoldBod {price.data.basePrice} + margin {price.data.margin}
            {price.data.status === "provisional"
              ? " · waiting for director approval"
              : ""}
          </div>
        </>
      ) : price.notSet ? (
        <div className="mt-1 text-sm text-amber-700 dark:text-amber-300">
          No price yet. Tap to set it up.
        </div>
      ) : (
        <div className="mt-1 text-sm text-red-600 dark:text-red-400">
          Price not available.
        </div>
      )}
    </Tile>
  );
}

function DrawerTile() {
  const { view: drawer } = useActiveDrawer();
  return (
    <Tile to={paths.drawer.home.href} title="Cash drawer">
      {drawer.status === "open" && drawer.balance ? (
        <div className="tnum text-2xl font-bold sm:text-3xl">
          {cedis(lineTotal(drawer.balance))}
        </div>
      ) : (
        <div className="text-lg font-semibold">
          {drawer.status === "closed"
            ? "Closed for today"
            : drawer.status === "none"
              ? "Day not opened yet"
              : "Not loaded yet"}
        </div>
      )}
      {drawer.pendingCount > 0 ? (
        <div className="mt-1 text-xs text-amber-700">
          {drawer.pendingCount} not sent yet
        </div>
      ) : null}
    </Tile>
  );
}

function SignoffTile() {
  const branchId = useAuth((s) => s.activeBranchId);
  const pending = useDayHistory({ branchId, signoff: "pending" });
  const n = pending.data?.length ?? 0;
  return (
    <Tile to={paths.drawer.history.href} title="Days waiting for sign-off">
      <div className="tnum text-2xl font-bold sm:text-3xl">{n}</div>
      <div className="text-xs text-muted-foreground">
        {n ? "Closed with differences. Tap to review." : "Nothing to review"}
      </div>
    </Tile>
  );
}

function MoneyTile() {
  const branchId = useAuth((s) => s.activeBranchId);
  const canConfirm = useHasPermission(PERMISSIONS.PAYMENTS_CONFIRM);
  const sending = usePendingPayments(branchId, "sending", canConfirm);
  const receiving = usePendingPayments(branchId, "receiving");
  const out = sending.data?.length ?? 0;
  const inn = receiving.data?.length ?? 0;
  return (
    <Tile to={paths.payments.href} title="Mobile money waiting">
      <div className="tnum text-2xl font-bold sm:text-3xl">{out + inn}</div>
      <div className="text-xs text-muted-foreground">
        {out} to send · {inn} on the way for our customers
      </div>
    </Tile>
  );
}

function DebtTile() {
  const branchId = useAuth((s) => s.activeBranchId);
  const owedToUs = useDebts({
    branchId,
    direction: "receivable",
    openOnly: true,
  });
  const weOwe = useDebts({ branchId, direction: "payable", openOnly: true });
  const sum = (l?: { outstanding: string }[]) =>
    (l ?? []).reduce((s, d) => s + Number(d.outstanding), 0);
  return (
    <Tile to={paths.debts.href} title="Debts">
      <div className="tnum text-base font-semibold sm:text-lg">
        Owed to us {cedis(sum(owedToUs.data))}
      </div>
      <div className="tnum text-sm text-muted-foreground">
        We owe {cedis(sum(weOwe.data))}
      </div>
    </Tile>
  );
}

function HeldTile() {
  const branchId = useAuth((s) => s.activeBranchId);
  const held = useCollateral({ branchId, status: "held" });
  const list = held.data ?? [];
  return (
    <Tile to={paths.collateral.href} title="Unrefined gold held">
      <div className="tnum text-base font-semibold sm:text-lg">
        {grams(list.reduce((s, c) => s + Number(c.topWeight), 0))}
      </div>
      <div className="text-xs text-muted-foreground">
        {list.length} item{list.length === 1 ? "" : "s"} as loan security
      </div>
    </Tile>
  );
}

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4">
      <h1 className="text-xl font-bold">Hello, {user?.displayName}</h1>
      <Can permission={PERMISSIONS.TRANSACTIONS_CREATE}>
        <Link to={paths.transactions.create.href} className="block">
          <Button className="w-full">New transaction</Button>
        </Link>
      </Can>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Can permission={PERMISSIONS.TRANSACTIONS_READ}>
          <PriceTile />
        </Can>
        <Can permission={PERMISSIONS.DAYS_READ}>
          <DrawerTile />
        </Can>
        <Can permission={PERMISSIONS.DAYS_SIGNOFF}>
          <SignoffTile />
        </Can>
        <Can permission={PERMISSIONS.TRANSACTIONS_READ}>
          <MoneyTile />
        </Can>
        <Can permission={PERMISSIONS.DEBTS_READ}>
          <DebtTile />
        </Can>
        <Can permission={PERMISSIONS.DEBTS_READ}>
          <HeldTile />
        </Can>
      </div>
    </div>
  );
}
