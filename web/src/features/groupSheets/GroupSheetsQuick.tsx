import { useState } from "react";
import { Link } from "react-router-dom";
import { MinusIcon, PlusIcon } from "lucide-react";
import paths from "@/config/paths";
import { useUtilityPanel } from "@/features/utility/store";
import { useGsHome, type Sheet } from "./api";
import { EntryModal } from "./EntryForm";
import { useGsOutbox } from "./local";
import { money, qty } from "./model";

/**
 * Group Sheets in the Tools panel: every open sheet the person can write on, with its balance and + / −, beside whatever page is open.
 * The entry goes through the same form and the same on-device queue as on the sheet's own page.
 */
export function GroupSheetsQuick() {
  const home = useGsHome();
  const pending = useGsOutbox((s) => s.items);
  const [adding, setAdding] = useState<{
    sheet: Sheet;
    direction: "in" | "out";
  } | null>(null);
  const close = () => useUtilityPanel.getState().setOpen(false);
  const groups = (home.data?.groups ?? [])
    .map((g) => ({
      ...g,
      sheets: g.sheets.filter((s) => s.access === "write" && !s.closed),
    }))
    .filter((g) => g.sheets.length);

  if (home.isLoading && !home.data)
    return (
      <p className="text-sm text-muted-foreground">Loading your sheets…</p>
    );
  if (!groups.length)
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>There is no sheet you can write on yet.</p>
        <Link
          to={paths.groupSheets.href}
          onClick={close}
          className="block rounded-lg border border-border py-2.5 text-center font-semibold text-brand hover:bg-muted"
        >
          Open Group Sheets
        </Link>
      </div>
    );
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.id} className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            {g.name}
          </h3>
          <ul className="space-y-2">
            {g.sheets.map((s) => {
              const waiting = pending.filter(
                (p) => p.sheetId === s.id && !p.problem,
              ).length;
              return (
                <li
                  key={s.id}
                  className="rounded-xl border border-border bg-card p-3"
                >
                  <Link
                    to={paths.groupSheets.sheet.to(s.id)}
                    onClick={close}
                    className="block"
                  >
                    <span className="block truncate text-sm font-semibold">
                      {s.name}
                    </span>
                    <span className="tnum block text-lg font-semibold">
                      {money(s.balance)}
                      {s.kind === "quantity" ? (
                        <span className="ml-2 text-sm font-medium text-muted-foreground">
                          {qty(s.stock, s.unit)}
                        </span>
                      ) : null}
                    </span>
                    {waiting ? (
                      <span className="text-xs text-sky-700">
                        {waiting} waiting to send
                      </span>
                    ) : null}
                  </Link>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAdding({ sheet: s, direction: "in" })}
                      className="inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-gold text-sm font-semibold text-navy"
                    >
                      <PlusIcon className="size-4" aria-hidden />
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdding({ sheet: s, direction: "out" })}
                      className="inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-navy text-sm font-semibold text-white"
                    >
                      <MinusIcon className="size-4" aria-hidden />
                      Take out
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {adding ? (
        <EntryModal
          sheet={adding.sheet}
          direction={adding.direction}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </div>
  );
}
