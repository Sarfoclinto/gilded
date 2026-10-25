import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Table, Tag } from "antd";
import { DENOMINATIONS, lineTotal, noteCount } from "@gold/core";
import paths from "@/config/paths";
import { PERMISSIONS } from "@/config/permissions";
import { useAuth } from "@/features/auth/store";
import { Can } from "@/features/auth/useHasPermission";
import { cedis } from "@/features/calculator/format";
import { when } from "@/features/transactions/format";
import { errorMessage } from "@/shared/api/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { dayFlagText, linesText } from "../format";
import { useActiveDrawer, useClosingPreview } from "../hooks";
import { useHasPermission } from "@/features/auth/useHasPermission";
import { grams } from "@/shared/lib/numbers";
import { MovementModal } from "../MovementModal";

export default function DrawerPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const { view, state, query } = useActiveDrawer();
  const [moving, setMoving] = useState(false);
  const day = state?.day ?? null;
  const canManage = useHasPermission(PERMISSIONS.DAYS_MANAGE);
  const books = useClosingPreview(
    canManage && view.status === "open" ? view.dayId : null,
  ).data;

  const rows = DENOMINATIONS.map((d) => ({
    key: d,
    denomination: `GHS ${d}`,
    notes: view.balance?.[`${d}`] ?? 0,
    value: (view.balance?.[`${d}`] ?? 0) * d,
  })).filter((r) => r.notes !== 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Cash drawer</h1>
        <Link to={paths.drawer.history.href} className="text-sm underline">
          Day history
        </Link>
      </div>

      {query.error && !state ? (
        <Alert type="error" showIcon title={errorMessage(query.error)} />
      ) : null}
      {view.pendingCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`${view.pendingCount} change${view.pendingCount > 1 ? "s" : ""} on this device not sent yet. The balance below already includes them.`}
        />
      ) : null}
      {view.negative ? (
        <Alert
          type="error"
          showIcon
          title="More notes were paid out than the drawer should hold. Recount before closing and tell the manager."
        />
      ) : null}

      {view.status === "unknown" ? (
        <Card className="text-sm text-muted-foreground">
          {query.isLoading
            ? "Loading the drawer…"
            : "The drawer has not been loaded yet. Connect once to load it."}
        </Card>
      ) : null}

      {view.status === "none" || view.status === "closed" ? (
        <Card className="space-y-3">
          <div>
            <div className="text-sm text-muted-foreground">
              {view.status === "none"
                ? "No day opened yet"
                : `Closed · ${view.businessDate}`}
            </div>
            <div className="text-lg font-semibold">
              {view.status === "none"
                ? "Open the day to start paying customers"
                : "This day is closed"}
            </div>
            {view.status === "closed" && view.closingLines ? (
              <div className="mt-1 text-sm text-muted-foreground">
                Counted at close: {cedis(lineTotal(view.closingLines))} (
                {linesText(view.closingLines)})
              </div>
            ) : null}
          </div>
          <Can permission={PERMISSIONS.DAYS_MANAGE}>
            <Link to={paths.drawer.open.href}>
              <Button className="w-full">Open the day</Button>
            </Link>
          </Can>
        </Card>
      ) : null}

      {view.status === "open" && view.balance ? (
        <>
          <Card className="space-y-1">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Open · {view.businessDate}</span>
              {day?.flags.map((f) => (
                <Tag key={f} color="gold">
                  {dayFlagText[f] ?? f}
                </Tag>
              ))}
            </div>
            <div className="text-sm text-muted-foreground">
              In the drawer now
            </div>
            <div className="tnum text-3xl font-bold">
              {cedis(lineTotal(view.balance))}
            </div>
            <div className="text-xs text-muted-foreground">
              {noteCount(view.balance).toLocaleString("en-GH")} notes
            </div>
          </Card>

          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={rows}
            locale={{ emptyText: "The drawer is empty" }}
            columns={[
              { title: "Note", dataIndex: "denomination" },
              {
                title: "Count",
                dataIndex: "notes",
                align: "right",
                render: (n: number) => (
                  <span className={n < 0 ? "text-red-600" : ""}>
                    {n.toLocaleString("en-GH")}
                  </span>
                ),
              },
              {
                title: "Value",
                dataIndex: "value",
                align: "right",
                render: (v: number) => cedis(v),
              },
            ]}
          />

          {books ? (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">What the books hold now</h2>
              <dl className="tnum grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                {[
                  ["Goods, top weight", grams(books.expected.goodsTop)],
                  ["Goods, down weight", grams(books.expected.goodsDown)],
                  ["Value of goods", cedis(books.expected.goodsValue)],
                  ["Owed to us", cedis(books.expected.debt)],
                  ["We owe", cedis(books.expected.payable)],
                  ["Unrefined gold held", grams(books.expected.custodyTop)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              {books.pendingPayments > 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {books.pendingPayments} mobile money part
                  {books.pendingPayments > 1 ? "s" : ""} still waiting for
                  confirmation.
                </p>
              ) : null}
            </Card>
          ) : null}

          <Can permission={PERMISSIONS.DAYS_MANAGE}>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setMoving(true)}>
                Cash in / out
              </Button>
              <Link to={paths.drawer.close.href}>
                <Button className="w-full">Close the day</Button>
              </Link>
            </div>
          </Can>

          {state && state.movements.length > 0 ? (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">Cash in and out today</h2>
              <ul className="divide-y divide-border text-sm">
                {state.movements.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start justify-between gap-3 py-2"
                  >
                    <div>
                      <div>{m.note}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.createdBy.displayName} · {when(m.capturedAt)} ·{" "}
                        {linesText(m.lines)}
                      </div>
                    </div>
                    <Tag color={m.kind === "topup" ? "green" : "volcano"}>
                      {m.kind === "topup" ? "+" : "−"}
                      {cedis(lineTotal(m.lines))}
                    </Tag>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {view.dayId && branchId ? (
            <MovementModal
              open={moving}
              onClose={() => setMoving(false)}
              dayId={view.dayId}
              branchId={branchId}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
