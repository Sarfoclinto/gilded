import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DENOMINATIONS,
  lineTotal,
  solveNotes,
  toPayable,
  type PayablePolicy,
  type SolveStrategy,
} from "@gold/core";
import { Card } from "@/shared/ui/Card";
import { SelectInput } from "@/shared/ui/SelectField";
import { cedis } from "./format";
import { useActiveDrawer } from "@/features/drawer/hooks";
import { limitsFromBalance } from "@/features/drawer/projection";
import { packText } from "@/features/transactions/format";
import { usePersonalSettings } from "@/features/settings/personal";
import { useNoteLimits } from "./useNoteLimits";
import { checkManual, setCount, type Counts } from "./manualNotes";

const policyLabels: Record<PayablePolicy, string> = {
  down: "Round down (customer gets less)",
  nearest: "Nearest 5",
  up: "Round up (we absorb it)",
};

export interface PayoutSelection {
  policy: PayablePolicy;
  strategy: SolveStrategy;
  payable: string;
  lines: Record<string, number>;
  totalNotes: number;
}

/** Pass `onResult` to receive the current payout (or null when the drawer cannot make it), e.g. to save it. */
export function PayoutPanel({
  amount,
  onResult,
  nonCash = 0,
  split,
}: {
  amount: number;
  onResult?: (p: PayoutSelection | null) => void;
  /** Part of the payable paid another way (mobile money, owed, gold against a debt). Only the rest is paid in notes. */
  nonCash?: number;
  /** Where the editor for those other parts goes. It is given the payable, so it can offer "all that is left". */
  split?: (payable: number) => ReactNode;
}) {
  const [policy, setPolicy] = useState<PayablePolicy>("down");
  const [strategy, setStrategy] = useState<SolveStrategy>(
    () => usePersonalSettings.getState().noteStrategy,
  );
  // Notes picked by hand instead of the suggestion. Only applies to the cash amount it was made for.
  const [manualState, setManualState] = useState<{
    forCash: number;
    counts: Counts;
  } | null>(null);
  const [override, setOverride] = useState<{
    forAmount: number;
    value: number;
  } | null>(null);
  const { draft, update, limits: draftLimits } = useNoteLimits();
  // With an open day the drawer decides which notes exist. Without one, the per-device draft below is used.
  const { view: drawer } = useActiveDrawer();
  const balance = drawer.status === "open" ? drawer.balance : null;
  const loose = drawer.status === "open" && drawer.loose;
  const limits = useMemo(
    () => (balance ? limitsFromBalance(balance, loose) : draftLimits),
    [balance, loose, draftLimits],
  );
  // Money is always enforced: even a loose branch cannot pay out more than the drawer holds.
  const drawerTotal = balance ? lineTotal(balance) : null;

  const rounded = useMemo(() => toPayable(amount, policy), [amount, policy]);
  // An override only applies to the amount it was chosen for.
  const payable =
    override && override.forAmount === amount
      ? override.value
      : rounded.payable;
  const difference = payable - amount;
  const cashPart = payable - nonCash;
  const tooMuch = cashPart < 0;
  const result = useMemo(
    () =>
      cashPart > 0
        ? solveNotes(cashPart, limits, strategy)
        : ({ ok: true, lines: {}, totalNotes: 0, display: [] } as const),
    [cashPart, limits, strategy],
  );

  const overDrawer = loose && drawerTotal !== null && cashPart > drawerTotal;
  const picked =
    manualState && manualState.forCash === cashPart && cashPart > 0
      ? manualState.counts
      : null;
  // Note rule off: the teller always states the notes really handed out (they must add up to the cash part). The suggestion is only the starting point.
  const manual =
    picked ??
    (loose && cashPart > 0 && result.ok && !overDrawer
      ? ({ ...result.lines } as Counts)
      : null);
  const check = manual
    ? checkManual(manual, cashPart, limits, loose ? drawerTotal : null)
    : null;

  useEffect(() => {
    if (!onResult) return;
    if (tooMuch || overDrawer) return onResult(null);
    if (check)
      return onResult(
        check.valid
          ? {
              policy,
              strategy,
              payable: String(payable),
              lines: check.lines,
              totalNotes: Object.values(check.lines).reduce((a, b) => a + b, 0),
            }
          : null,
      );
    if (!result.ok) return onResult(null);
    const lines = Object.fromEntries(
      Object.entries(result.lines).filter(([, n]) => (n ?? 0) > 0),
    ) as Record<string, number>;
    onResult({
      policy,
      strategy,
      payable: String(payable),
      lines,
      totalNotes: result.totalNotes,
    });
  }, [result, check, tooMuch, overDrawer, policy, strategy, payable, onResult]);

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold">Payout</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Rounding</span>
          <SelectInput
            value={policy}
            onChange={(e) => {
              setOverride(null);
              setPolicy(e.target.value as PayablePolicy);
            }}
          >
            {(Object.keys(policyLabels) as PayablePolicy[]).map((p) => (
              <option key={p} value={p}>
                {policyLabels[p]}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Notes</span>
          <SelectInput
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as SolveStrategy)}
          >
            <option value="prefer-100s">Prefer 100s</option>
            <option value="fewest-notes">Fewest notes</option>
          </SelectInput>
        </label>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">To pay</span>
        <span className="tnum text-2xl font-bold">{cedis(payable)}</span>
      </div>
      {difference !== 0 ? (
        <p className="tnum -mt-3 text-right text-xs text-muted-foreground">
          {difference < 0
            ? `${cedis(-difference)} less than calculated`
            : `${cedis(difference)} absorbed by the business`}
        </p>
      ) : null}

      {split ? split(payable) : null}

      {nonCash > 0 && !tooMuch ? (
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Paid in cash</span>
          <span className="tnum text-xl font-bold">{cedis(cashPart)}</span>
        </div>
      ) : null}

      {manual && check && !tooMuch ? (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {loose ? "Enter the notes you hand out" : "Choose the notes"}
            </h3>
            <button
              type="button"
              className="min-h-10 text-sm underline"
              onClick={() => setManualState(null)}
            >
              {loose ? "Reset to the suggestion" : "Use the suggestion"}
            </button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {DENOMINATIONS.filter(
              (d) => limits[`${d}`] !== undefined || (manual[`${d}`] ?? 0) > 0,
            ).map((d) => {
              const n = manual[`${d}`] ?? 0;
              const have = limits[`${d}`];
              const set = (v: number) =>
                setManualState({
                  forCash: cashPart,
                  counts: setCount(manual, d, v),
                });
              return (
                <li
                  key={d}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div>
                    <div className="font-semibold">GHS {d}</div>
                    <div className="text-xs text-muted-foreground">
                      {loose
                        ? "Notes are not limited here"
                        : have == null
                          ? "Count not known"
                          : `${have.toLocaleString("en-GH")} in the drawer`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`One less GHS ${d}`}
                      className="size-10 rounded-lg border border-border"
                      onClick={() => set(n - 1)}
                    >
                      −
                    </button>
                    <input
                      inputMode="numeric"
                      aria-label={`Number of GHS ${d} notes`}
                      className="tnum h-10 w-20 rounded-lg border border-border bg-card px-2 text-center"
                      value={n === 0 ? "" : String(n)}
                      placeholder="0"
                      onChange={(e) =>
                        set(Number(e.target.value.replace(/\D/g, "")))
                      }
                    />
                    <button
                      type="button"
                      aria-label={`One more GHS ${d}`}
                      className="size-10 rounded-lg border border-border"
                      onClick={() => set(n + 1)}
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">
              {check.remaining > 0
                ? "Still to give"
                : check.remaining < 0
                  ? "Given too much by"
                  : "Adds up exactly"}
            </span>
            <strong
              className={`tnum ${check.remaining === 0 ? "text-emerald-600" : "text-red-600"}`}
            >
              {check.remaining === 0
                ? cedis(check.total)
                : cedis(Math.abs(check.remaining))}
            </strong>
          </div>
          {check.overTotal ? (
            <p role="alert" className="text-sm text-red-600">
              The drawer holds only {cedis(drawerTotal ?? 0)}; these notes come
              to {cedis(check.total)}.
            </p>
          ) : null}
          {Object.keys(check.overStock).length > 0 ? (
            <p role="alert" className="text-sm text-red-600">
              The drawer does not have enough:{" "}
              {Object.entries(check.overStock)
                .map(([d, n]) => `GHS ${d} (${n} too many)`)
                .join(", ")}
              .
            </p>
          ) : null}
        </div>
      ) : null}

      {overDrawer ? (
        <p
          role="alert"
          className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm font-medium text-red-700"
        >
          The drawer holds only {cedis(drawerTotal ?? 0)}, which is less than
          the {cedis(cashPart)} to pay in cash.
        </p>
      ) : null}

      {cashPart === 0 && !tooMuch ? (
        <p className="text-sm text-muted-foreground">
          Nothing is paid in cash, so no notes leave the drawer.
        </p>
      ) : manual || overDrawer ? null : result.ok && !tooMuch ? (
        <div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {result.display.map((row) => (
              <li
                key={row.denomination}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div>
                  <div className="font-semibold">
                    GHS {row.denomination} × {row.total}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      row.packs
                        ? `${row.packs} pack${row.packs > 1 ? "s" : ""}`
                        : null,
                      row.bundles
                        ? `${row.bundles} bundle${row.bundles > 1 ? "s" : ""}`
                        : null,
                      row.loose ? `${row.loose} loose` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                </div>
                <div className="tnum text-sm text-muted-foreground">
                  {cedis(row.value)}
                </div>
              </li>
            ))}
          </ul>
          <p className="tnum mt-2 text-right text-sm">
            <span className="text-muted-foreground">Total pieces </span>
            <strong>{result.totalNotes.toLocaleString("en-GH")}</strong>
          </p>
          {!manual ? (
            <button
              type="button"
              className="mt-2 min-h-10 rounded-lg border border-border bg-card px-3 text-sm font-medium"
              onClick={() =>
                setManualState({
                  forCash: cashPart,
                  counts: { ...result.lines } as Counts,
                })
              }
            >
              Customer wants other notes
            </button>
          ) : null}
        </div>
      ) : tooMuch ? null : !result.ok ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">
            {result.code === "CANNOT_MAKE_AMOUNT"
              ? "The notes in the drawer cannot make this exact amount."
              : result.message}
          </p>
          {result.code === "CANNOT_MAKE_AMOUNT" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {result.nearestBelow != null ? (
                <button
                  className="min-h-10 rounded-lg border border-border bg-card px-3"
                  onClick={() =>
                    setOverride({
                      forAmount: amount,
                      value: result.nearestBelow! + nonCash,
                    })
                  }
                >
                  Pay {cedis(result.nearestBelow)}
                </button>
              ) : null}
              {result.nearestAbove != null ? (
                <button
                  className="min-h-10 rounded-lg border border-border bg-card px-3"
                  onClick={() =>
                    setOverride({
                      forAmount: amount,
                      value: result.nearestAbove! + nonCash,
                    })
                  }
                >
                  Pay {cedis(result.nearestAbove)}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {balance ? (
        <details className="text-sm">
          <summary className="min-h-10 cursor-pointer py-2 font-medium">
            Notes in the drawer
          </summary>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {DENOMINATIONS.filter((d) => (balance[`${d}`] ?? 0) > 0).map(
              (d) => (
                <li
                  key={d}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="font-medium">GHS {d}</span>
                  <span className="tnum text-muted-foreground">
                    {balance[`${d}`]!.toLocaleString("en-GH")} ·{" "}
                    {packText(balance[`${d}`]!)}
                  </span>
                </li>
              ),
            )}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            From today's cash drawer, including payouts not sent yet.
          </p>
        </details>
      ) : (
        <details className="text-sm">
          <summary className="min-h-10 cursor-pointer py-2 font-medium">
            Notes available (no open day)
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DENOMINATIONS.map((d) => (
              <div key={d} className="rounded-lg border border-border p-2">
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={draft[d].enabled}
                    onChange={(e) => update(d, { enabled: e.target.checked })}
                  />
                  GHS {d}
                </label>
                <input
                  inputMode="numeric"
                  placeholder="No limit"
                  aria-label={`Count of GHS ${d} notes`}
                  disabled={!draft[d].enabled}
                  value={draft[d].count}
                  onChange={(e) =>
                    update(d, { count: e.target.value.replace(/\D/g, "") })
                  }
                  className="tnum mt-2 min-h-10 w-full rounded-lg border border-border bg-card px-2 disabled:opacity-40"
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Open the day in Cash drawer and the real notes are used instead.
          </p>
        </details>
      )}
    </Card>
  );
}
