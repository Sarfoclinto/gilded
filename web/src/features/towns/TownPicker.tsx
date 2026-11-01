import { useEffect, useId, useMemo, useState } from "react";
import {
  allTowns,
  refreshTowns,
  searchTowns,
  tidyTown,
  townKey,
  useTowns,
  type Town,
} from "./towns";
import { useConnectivity } from "@/shared/offline/connectivity";

/** What the purchase carries: a town from the list (id), or a new name (id made here so it works offline). */
export interface TownValue {
  id: string;
  name: string;
}

/**
 * "Gold from" — optional, one line. Type to search the company's towns; if the town is not there, "Add …" saves it for everyone.
 * Works offline from the list kept on the device.
 */
export function TownPicker({
  value,
  onChange,
  disabled,
}: {
  value: TownValue | null;
  onChange: (v: TownValue | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const online = useConnectivity((s) => s.online);
  const towns = useTowns((s) => s.towns);
  const pending = useTowns((s) => s.pending);
  const id = useId();

  useEffect(() => {
    if (online) void refreshTowns();
  }, [online]);

  const list = useMemo(
    () => searchTowns(allTowns(towns, pending), text, 6),
    [towns, pending, text],
  );
  const typed = tidyTown(text);
  const exact = typed
    ? list.some((t) => townKey(t.name) === townKey(typed))
    : true;
  const canAdd = !exact && townKey(typed).length >= 2 && typed.length <= 80;
  const rows: Array<{ kind: "town"; town: Town } | { kind: "add" }> = [
    ...list.map((town) => ({ kind: "town" as const, town })),
    ...(canAdd ? [{ kind: "add" as const }] : []),
  ];

  function choose(i: number) {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "town") onChange({ id: row.town.id, name: row.town.name });
    else {
      const t = { id: crypto.randomUUID(), name: typed };
      useTowns.getState().remember(t);
      onChange(t);
    }
    setText("");
    setOpen(false);
  }

  if (value) {
    return (
      <div>
        <div className="mb-1 text-sm font-medium">Gold from</div>
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3">
          <span className="truncate font-medium">{value.name}</span>
          <button
            type="button"
            disabled={disabled}
            className="min-h-10 shrink-0 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted"
            onClick={() => onChange(null)}
            aria-label="Remove the town"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        Gold from{" "}
        <span className="font-normal text-muted-foreground">
          (town, optional)
        </span>
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder="Type a town"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, rows.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (
            e.key === "Enter" &&
            open &&
            rows.length > 0 &&
            text.trim()
          ) {
            e.preventDefault();
            choose(active);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
      />
      {open && rows.length > 0 ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {rows.map((row, i) => (
            <li
              key={row.kind === "town" ? row.town.id : "add"}
              role="option"
              aria-selected={i === active}
              // mouse down, not click: the input would blur first and close the list
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm ${i === active ? "bg-muted" : ""}`}
            >
              {row.kind === "town" ? (
                <>
                  <span>{row.town.name}</span>
                  {row.town.uses ? (
                    <span className="text-xs text-muted-foreground">
                      {row.town.uses} bought
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-medium text-primary">Add “{typed}”</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
