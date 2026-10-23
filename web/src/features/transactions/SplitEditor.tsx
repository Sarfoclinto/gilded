import { cedis } from "@/features/calculator/format";
import { useBranchNames } from "@/features/branches/api";
import type { Debt } from "@/features/debts/schemas";
import { SelectField } from "@/shared/ui/SelectField";
import { Button } from "@/shared/ui/Button";
import { TextField } from "@/shared/ui/TextField";
import { digitsOnly } from "@/shared/lib/numbers";
import { newSplit, type SplitDraft } from "./split";

const titles = {
  mobile_money: "Mobile money",
  owed: "Branch will owe the customer",
  debt_offset: "Gold settles a debt",
} as const;

/**
 * "Pay some of it another way." The rest is paid in cash. Every part is a whole number of cedis.
 * mobile_money: another branch (e.g. Kumasi) sends it. owed: pay later. debt_offset: the customer's debt to us shrinks.
 */
export function SplitEditor({
  parts,
  onChange,
  payable,
  debts,
  customerPicked,
  problems,
}: {
  parts: SplitDraft[];
  onChange: (next: SplitDraft[]) => void;
  payable: number;
  debts: Debt[];
  customerPicked: boolean;
  problems: string[];
}) {
  const branchNames = useBranchNames();
  const set = (key: string, patch: Partial<SplitDraft>) =>
    onChange(parts.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const sumOthers = (key: string) =>
    parts
      .filter((p) => p.key !== key)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const rest = Math.max(
    0,
    payable - parts.reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">How is it paid?</h3>
        <span className="tnum text-xs text-muted-foreground">
          Cash: {cedis(rest)}
        </span>
      </div>

      {parts.map((p) => {
        const open = debts.filter((d) => d.status === "open");
        return (
          <div key={p.key} className="space-y-2 rounded-lg bg-muted/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{titles[p.method]}</span>
              <button
                type="button"
                className="min-h-9 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
                onClick={() => onChange(parts.filter((x) => x.key !== p.key))}
              >
                Remove
              </button>
            </div>
            <div className="flex gap-2">
              <TextField
                className="flex-1"
                label="Amount (GHS)"
                inputMode="numeric"
                value={p.amount}
                onChange={(e) =>
                  set(p.key, { amount: digitsOnly(e.target.value) })
                }
              />
              <Button
                type="button"
                variant="secondary"
                className="self-end"
                onClick={() =>
                  set(p.key, {
                    amount: String(Math.max(0, payable - sumOthers(p.key))),
                  })
                }
              >
                All that is left
              </Button>
            </div>
            {p.method === "mobile_money" ? (
              <>
                <SelectField
                  label="Sent by branch"
                  value={p.paidByBranchId}
                  onChange={(e) =>
                    set(p.key, { paidByBranchId: e.target.value })
                  }
                >
                  <option value="">Choose a branch…</option>
                  {Object.entries(branchNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Reference (optional)"
                  value={p.externalRef}
                  onChange={(e) => set(p.key, { externalRef: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  It stays “waiting” until the sending branch confirms the money
                  really went out.
                </p>
              </>
            ) : null}
            {p.method === "owed" ? (
              <TextField
                label="Pay by (optional)"
                type="date"
                value={p.dueDate}
                onChange={(e) => set(p.key, { dueDate: e.target.value })}
              />
            ) : null}
            {p.method === "debt_offset" ? (
              customerPicked ? (
                <SelectField
                  label="Which debt"
                  value={p.debtId}
                  onChange={(e) => {
                    const d = open.find((x) => x.id === e.target.value);
                    set(p.key, {
                      debtId: e.target.value,
                      amount:
                        p.amount ||
                        (d
                          ? String(
                              Math.min(
                                payable,
                                Math.floor(Number(d.outstanding)),
                              ),
                            )
                          : ""),
                    });
                  }}
                >
                  <option value="">Choose…</option>
                  {open.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.reason ?? "Debt"} · owes {cedis(Number(d.outstanding))}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Pick the customer from the list above first.
                </p>
              )
            ) : null}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...parts, newSplit("mobile_money")])}
        >
          + Mobile money
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...parts, newSplit("owed")])}
        >
          + We owe them
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...parts, newSplit("debt_offset")])}
        >
          + Gold settles a debt
        </Button>
      </div>
      {problems.length ? (
        <ul
          role="alert"
          className="list-disc space-y-1 pl-5 text-xs text-red-600 dark:text-red-400"
        >
          {problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
