import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { recently, when } from "@/features/transactions/format";
import { useConnectivity } from "@/shared/offline/connectivity";
import { useWorldPrice, type GoldbodWorld } from "./api";
import { usd, worldMove } from "./model";

/**
 * GoldBod's world price (the LBMA price its own price is built on, e.g. "USD 3,759.35") with the time GoldBod published it, held against
 * the world price now: a green arrow up when the market has risen since, red down when it has fallen. GoldBod's figure comes with our
 * price history (kept on the device); the live price needs a connection and `live` (the outside-chart setting).
 */
export function GoldbodWorldTile({
  goldbod,
  live,
  compact = false,
}: {
  goldbod: GoldbodWorld | null | undefined;
  live: boolean;
  compact?: boolean;
}) {
  const online = useConnectivity((s) => s.online);
  const world = useWorldPrice(live && online);
  const w = world.data;
  // offline, a price fetched earlier is not "now": no comparison, no arrow
  const nowPrice = live && online && w?.available ? w.usdPerOunce : undefined;
  const move = worldMove(goldbod?.usdPerOunce, nowPrice);
  const g = Number(goldbod?.usdPerOunce);

  if (!goldbod?.usdPerOunce || !(g > 0)) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">
        GoldBod's world price shows here once the price has been read from
        GoldBod's website (Settings, Automatic price).
      </div>
    );
  }

  const tone =
    move?.direction === "up"
      ? {
          badge: "bg-emerald-600 text-white",
          text: "text-emerald-700 dark:text-emerald-400",
          Icon: ArrowUpRightIcon,
          word: "up",
        }
      : move?.direction === "down"
        ? {
            badge: "bg-red-600 text-white",
            text: "text-red-700 dark:text-red-400",
            Icon: ArrowDownRightIcon,
            word: "down",
          }
        : {
            badge: "bg-muted text-muted-foreground",
            text: "text-muted-foreground",
            Icon: MinusIcon,
            word: "unchanged",
          };

  let liveLine: React.ReactNode;
  if (!live) liveLine = null;
  else if (!online) liveLine = "The price now needs a connection.";
  else if (world.isLoading) liveLine = "Getting the price now…";
  else if (!w?.available || !move)
    liveLine =
      "The price now could not be fetched. The chart still shows the trend.";
  else
    liveLine = (
      <>
        Now <b className="tnum text-foreground">{usd(move.live)}</b>{" "}
        <span className={`tnum font-semibold ${tone.text}`}>
          {move.direction === "flat"
            ? "no change"
            : `${move.change > 0 ? "+" : "−"}${Math.abs(move.change).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${Math.abs(move.percent).toFixed(2)}%)`}
        </span>
        <span className="text-muted-foreground">
          {" "}
          · {w.stale ? "last fetched " : ""}
          {w.at ? recently(w.at) : ""}
        </span>
      </>
    );

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-border bg-card ${compact ? "p-3" : "p-4"}`}
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">
          GoldBod's world price (LBMA)
          {goldbod.publishedAt ? (
            <> · published {when(goldbod.publishedAt)}</>
          ) : null}
        </div>
        <div
          className={`tnum mt-0.5 font-bold text-foreground ${compact ? "text-xl" : "text-2xl"}`}
        >
          {usd(g)}
        </div>
        {goldbod.rate && Number(goldbod.rate) > 0 ? (
          <div className="text-[11px] text-muted-foreground">
            USD 1 = GHS {Number(goldbod.rate).toLocaleString("en-GH")} on
            GoldBod's page
          </div>
        ) : null}
        {liveLine ? (
          <div className="mt-1.5 text-xs text-muted-foreground">{liveLine}</div>
        ) : null}
      </div>
      {live && move ? (
        <span
          className={`grid shrink-0 place-items-center rounded-full ${tone.badge} ${compact ? "size-9" : "size-11"}`}
          role="img"
          aria-label={`The world price is ${tone.word} since GoldBod published`}
          title={`The world price is ${tone.word} since GoldBod published`}
        >
          <tone.Icon
            className={compact ? "size-5" : "size-6"}
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
      ) : null}
    </div>
  );
}
