import { useState } from "react";
import { Segmented } from "antd";
import { RefreshCw, WifiOff } from "lucide-react";
import { useAuth } from "@/features/auth/store";
import { useActiveDrawer } from "@/features/drawer/hooks";
import { Chip } from "@/shared/ui/Chip";
import { useConnectivity } from "@/shared/offline/connectivity";
import { cedis } from "@/features/calculator/format";
import { useCashOverview, type BranchCash } from "./api";
import { clock, grandTotal, noteRows, noteTotal, sinceText } from "./model";

const DAY: Record<
  BranchCash["day"],
  { label: string; tone: "green" | "grey" | "amber" }
> = {
  open: { label: "Day open", tone: "green" },
  closed: { label: "Day closed", tone: "grey" },
  none: { label: "No day opened", tone: "amber" },
};

function BranchCard({ b, showName }: { b: BranchCash; showName: boolean }) {
  const rows = noteRows(b.lines);
  return (
    <section className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {showName && (
            <p className="truncate text-sm font-semibold">{b.name}</p>
          )}
          <p className="text-2xl font-bold tabular-nums">
            {cedis(b.cashValue)}
          </p>
        </div>
        <Chip tone={DAY[b.day].tone}>{DAY[b.day].label}</Chip>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No cash recorded.</p>
      ) : (
        <table className="mt-2 w-full text-sm tabular-nums">
          <tbody>
            {rows.map((r) => (
              <tr key={r.denomination} className="border-t border-border/60">
                <td className="py-1">GHS {r.denomination}</td>
                <td className="py-1 text-right text-muted-foreground">
                  × {r.count}
                </td>
                <td className="py-1 text-right font-medium">
                  {cedis(r.value)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="py-1 text-muted-foreground" colSpan={2}>
                {noteTotal(b.lines)} notes
              </td>
              <td className="py-1 text-right font-semibold">
                {cedis(b.cashValue)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

/** What each branch holds right now, by note. Always carries the time it was fetched, because offline work elsewhere is not in it. */
export function CashBody() {
  const active = useAuth((s) => s.activeBranchId);
  const online = useConnectivity((s) => s.online);
  const q = useCashOverview(null);
  const drawer = useActiveDrawer();
  const [pick, setPick] = useState<string>("all");
  const all = q.data?.branches ?? [];
  const shown = pick === "all" ? all : all.filter((b) => b.branchId === pick);
  const multi = all.length > 1;
  const pending = drawer.view.pendingCount;
  const mine = all.find((b) => b.branchId === active);

  return (
    <div className="space-y-3">
      {multi && (
        <Segmented
          block
          value={pick}
          onChange={(v) => setPick(String(v))}
          options={[
            { label: "All", value: "all" },
            ...all.map((b) => ({ label: b.name, value: b.branchId })),
          ]}
        />
      )}
      {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.isError && !q.data && (
        <p className="text-sm text-red-700">
          {online
            ? "Could not load the cash."
            : "You are offline, and no earlier figure is saved on this device."}
        </p>
      )}
      {shown.length > 1 && (
        <div className="rounded-xl bg-navy p-3 text-white">
          <p className="text-xs text-white/70">
            Total across {shown.length} branches
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {cedis(grandTotal(shown))}
          </p>
        </div>
      )}
      {shown.map((b) => (
        <BranchCard key={b.branchId} b={b} showName={multi} />
      ))}
      {pending > 0 && mine && (pick === "all" || pick === active) && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          This device has {pending} change{pending === 1 ? "" : "s"} not sent
          yet. Your drawer screen shows the figure with them included.
        </p>
      )}
      {q.data && (
        <div className="flex items-start gap-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground">
          {!online && <WifiOff className="mt-0.5 size-3.5 shrink-0" />}
          <p className="flex-1">
            Fetched at {clock(q.data.asOf)} ({sinceText(q.data.asOf)})
            {q.isFetching ? " · refreshing…" : ""}. Cash handled on a device
            that has not synced yet is not included.
          </p>
          <button
            type="button"
            aria-label="Refresh cash"
            className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-background disabled:opacity-50"
            disabled={q.isFetching || !online}
            onClick={() => void q.refetch()}
          >
            <RefreshCw
              className={`size-4 ${q.isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      )}
    </div>
  );
}
