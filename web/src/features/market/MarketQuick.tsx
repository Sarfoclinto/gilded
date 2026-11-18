import { useMemo } from "react";
import { Link } from "react-router-dom";
import paths from "@/config/paths";
import { useAuth } from "@/features/auth/store";
import { cedis } from "@/features/calculator/format";
import { useSettings } from "@/features/settings/api";
import { when } from "@/features/transactions/format";
import { useUtilityPanel } from "@/features/utility/store";
import { usePriceHistory } from "./api";
import { priceLine, priceStats } from "./model";
import { GoldbodWorldTile } from "./GoldbodWorldTile";
import { OwnPriceChart } from "./OwnPriceChart";
import { Step } from "./Step";
import { WorldGoldChart } from "./WorldGoldChart";

/** The market at a glance, beside whatever page is open: our price and its last move, a month of it, and the world price. */
export function MarketQuick() {
  const branchId = useAuth((s) => s.activeBranchId);
  const showWorld = useSettings()["market.worldChart"];
  const history = usePriceHistory(branchId, 30);
  const h = history.data;
  const stats = useMemo(() => (h ? priceStats(h.points) : null), [h]);
  const price = useMemo(
    () => (h ? priceLine(h.points, h.from, h.asOf) : []),
    [h],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-navy p-4 text-white">
        <div className="text-xs text-white/70">Our price per pound</div>
        <div className="tnum text-3xl font-bold text-gold">
          {stats ? cedis(stats.current) : "—"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/75">
          {stats ? (
            <>
              <span className="rounded-full bg-white px-2 py-0.5">
                <Step change={stats.change} percent={stats.changePercent} />
              </span>
              <span>since {when(stats.since)}</span>
              <span>
                GoldBod {stats.base.toLocaleString("en-GH")} +{" "}
                {stats.margin.toLocaleString("en-GH")}
              </span>
            </>
          ) : history.isLoading ? (
            "Loading…"
          ) : (
            "No price set yet"
          )}
        </div>
      </div>

      {price.length > 0 ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Our price · last 30 days
          </h3>
          <OwnPriceChart price={price} height={170} />
        </div>
      ) : null}

      {showWorld ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            World price · USD per ounce
          </h3>
          <div className="mb-2">
            <GoldbodWorldTile goldbod={h?.goldbod} live compact />
          </div>
          <WorldGoldChart interval="60" height={300} compact />
          <p className="mt-1 text-[11px] text-muted-foreground">
            For watching only. Not the price we pay.
          </p>
        </div>
      ) : null}

      <Link
        to={paths.market.href}
        onClick={() => useUtilityPanel.getState().setOpen(false)}
        className="block rounded-lg border border-border py-2.5 text-center text-sm font-semibold text-brand hover:bg-muted"
      >
        Open the Gold market page
      </Link>
    </div>
  );
}
