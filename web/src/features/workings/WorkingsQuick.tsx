import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { useSettings } from "@/features/settings/api";
import { useSheets } from "./api";
import { SheetView } from "./SheetPage";

/**
 * Workings in the Tools panel: pick one of your sheets (or start one) and keep it open beside whatever page you are on, for example a
 * purchase. Select a result and tap Copy, then paste it into the form.
 */
export function WorkingsQuick() {
  const off = !useSettings()["workings.enabled"];
  const list = useSheets();
  const [open, setOpen] = useState<{ id: string; fresh: boolean } | null>(null);
  if (open)
    return (
      <SheetView
        compact
        id={open.id}
        fresh={open.fresh}
        onBack={() => setOpen(null)}
      />
    );
  const items = (list.data?.items ?? []).slice(0, 12);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Your sheets</p>
        {!off ? (
          <button
            type="button"
            onClick={() => setOpen({ id: crypto.randomUUID(), fresh: true })}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-semibold text-white"
          >
            <PlusIcon className="size-4" aria-hidden />
            New
          </button>
        ) : null}
      </div>
      {list.isLoading ? (
        <div className="h-14 animate-pulse rounded-xl bg-muted" />
      ) : null}
      <ul className="space-y-1.5">
        {items.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setOpen({ id: s.id, fresh: false })}
              className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:bg-muted"
            >
              <span className="block truncate text-sm font-semibold">
                {s.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {s.notes} note{s.notes === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {list.data && !items.length ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No sheets yet. Tap New to start one.
        </p>
      ) : null}
    </div>
  );
}
