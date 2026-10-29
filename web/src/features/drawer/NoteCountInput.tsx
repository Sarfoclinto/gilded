import { useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { DENOMINATIONS, lineTotal, noteCount, type Lines } from "@gold/core";
import { cedis } from "@/features/calculator/format";
import { packText } from "@/features/transactions/format";
import { checkTotal } from "./checkTotal";

/**
 * Count notes by denomination (200 down to 5). Used for the opening count, the closing count and top-ups.
 * Each row has − and + buttons for quick counting, shows its value, and (when `expected` is given) turns green or amber
 * against what the drawer should hold. The optional typed total is only a cross-check for the person; it is never sent.
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
  const [typed, setTyped] = useState("");
  const check = checkTotal(typed, lineTotal(value));
  const count = noteCount(value);
  const set = (d: number, n: number) => {
    const next = { ...value };
    if (!n || n < 0) delete next[`${d}`];
    else next[`${d}`] = Math.floor(n);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-dashed border-border p-3">
        <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <span className="font-medium">Total you were given or expect</span>
            <span className="block text-xs text-muted-foreground">
              Optional. Only a check, it is not saved.
            </span>
          </span>
          <input
            inputMode="decimal"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={disabled}
            placeholder="GHS"
            aria-label="Total you were given or expect, optional"
            className="tnum min-h-11 w-36 rounded-lg border border-border bg-card px-3 text-right outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </label>
        {check.kind === "match" ? (
          <p className="mt-1 text-xs text-emerald-700">
            Matches the notes you counted.
          </p>
        ) : null}
        {check.kind === "differs" ? (
          <p className="mt-1 text-xs text-amber-700">
            The notes add up to {cedis(lineTotal(value))}, which is{" "}
            {cedis(Math.abs(check.difference))}{" "}
            {check.difference < 0 ? "less" : "more"} than you typed. Count
            again, or carry on if the notes are right.
          </p>
        ) : null}
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {DENOMINATIONS.map((d) => {
          const n = value[`${d}`] ?? 0;
          const exp = expected?.[`${d}`];
          const tone =
            expected === undefined ||
            count === 0 ||
            (n === 0 && (exp ?? 0) === 0)
              ? ""
              : n === (exp ?? 0)
                ? "bg-emerald-500/5"
                : "bg-amber-500/10";
          return (
            <div
              key={d}
              className={`grid grid-cols-[4.75rem_1fr_auto] items-center gap-2 p-2 sm:grid-cols-[5rem_1fr_7rem] sm:gap-3 sm:p-3 ${tone}`}
            >
              <div className="whitespace-nowrap text-sm font-semibold sm:text-base">
                GHS {d}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`One fewer GHS ${d} note`}
                    disabled={disabled || n === 0}
                    onClick={() => set(d, n - 1)}
                    className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40"
                  >
                    <MinusIcon className="size-4" />
                  </button>
                  <input
                    inputMode="numeric"
                    aria-label={`Number of GHS ${d} notes`}
                    value={n || ""}
                    placeholder="0"
                    disabled={disabled}
                    onChange={(e) =>
                      set(d, Number(e.target.value.replace(/\D/g, "")) || 0)
                    }
                    className="tnum min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-center text-base font-semibold outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                  <button
                    type="button"
                    aria-label={`One more GHS ${d} note`}
                    disabled={disabled}
                    onClick={() => set(d, n + 1)}
                    className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40"
                  >
                    <PlusIcon className="size-4" />
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
                  <span>{n > 0 ? packText(n) : " "}</span>
                  {expected ? (
                    <span>Books: {(exp ?? 0).toLocaleString("en-GH")}</span>
                  ) : null}
                </div>
              </div>
              <div className="tnum min-w-14 text-right text-xs text-muted-foreground sm:text-sm">
                {n ? cedis(n * d) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="tnum flex items-center justify-between gap-3 rounded-xl bg-navy p-3 text-white">
        <span className="text-sm text-white/70">
          {count.toLocaleString("en-GH")} {count === 1 ? "note" : "notes"}
        </span>
        <div className="flex items-center gap-3">
          {count > 0 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({})}
              className="text-xs text-white/70 underline"
            >
              Clear
            </button>
          ) : null}
          <strong className="text-xl text-gold">
            {cedis(lineTotal(value))}
          </strong>
        </div>
      </div>
    </div>
  );
}
