import { useState } from "react";
import { InputNumber } from "antd";
import { DENOMINATIONS, lineTotal, noteCount, type Lines } from "@gold/core";
import { cedis } from "@/features/calculator/format";
import { packText } from "@/features/transactions/format";
import { checkTotal } from "./checkTotal";

/**
 * Count notes by denomination (200 down to 5). Used for the opening count, the closing count and top-ups.
 * Shows the value of each row and the grand total as the person types, because that is what they check against the cash.
 */
export function NoteCountInput({
  value,
  onChange,
  disabled,
  expected,
}: {
  value: Lines;
  onChange: (next: Lines) => void;
  disabled?: boolean;
  /** When given (closing), each row also shows what the drawer should hold. */
  expected?: Lines;
}) {
  // Only a cross-check for the person: it is never sent or saved.
  const [typed, setTyped] = useState("");
  const check = checkTotal(typed, lineTotal(value));
  const set = (d: number, n: number | null) => {
    const next = { ...value };
    if (!n || n < 0) delete next[`${d}`];
    else next[`${d}`] = Math.floor(n);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {DENOMINATIONS.map((d) => {
        const n = value[`${d}`] ?? 0;
        const exp = expected?.[`${d}`] ?? 0;
        return (
          <div
            key={d}
            className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-lg border border-border p-2"
          >
            <div className="font-semibold">GHS {d}</div>
            <div>
              <InputNumber
                size="large"
                className="w-full"
                min={0}
                precision={0}
                inputMode="numeric"
                aria-label={`Number of GHS ${d} notes`}
                value={n || null}
                placeholder="0"
                disabled={disabled}
                onChange={(v) => set(d, v)}
              />
              {n > 0 ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {packText(n)}
                </div>
              ) : null}
              {expected ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Expected {exp.toLocaleString("en-GH")}
                </div>
              ) : null}
            </div>
            <div className="tnum text-right text-sm text-muted-foreground">
              {n ? cedis(n * d) : "—"}
            </div>
          </div>
        );
      })}
      <div className="tnum flex items-baseline justify-between rounded-lg bg-muted p-3">
        <span className="text-sm text-muted-foreground">
          {noteCount(value).toLocaleString("en-GH")}{" "}
          {noteCount(value) === 1 ? "note" : "notes"}
        </span>
        <strong className="text-xl">{cedis(lineTotal(value))}</strong>
      </div>
      <div className="rounded-lg border border-dashed border-border p-2">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Total you were given or expect (optional)
          </span>
          <input
            inputMode="decimal"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={disabled}
            placeholder="GHS"
            aria-label="Total you were given or expect, optional"
            className="tnum min-h-10 w-32 rounded-lg border border-border bg-card px-2 text-right outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </label>
        {check.kind === "match" ? (
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            Matches the notes you counted.
          </p>
        ) : null}
        {check.kind === "differs" ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            The notes add up to {cedis(lineTotal(value))}, which is{" "}
            {cedis(Math.abs(check.difference))}{" "}
            {check.difference < 0 ? "less" : "more"} than you typed. Count
            again, or carry on if the notes are right.
          </p>
        ) : null}
      </div>
    </div>
  );
}
