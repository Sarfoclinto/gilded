import { useEffect, useRef } from "react";
import {
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { LinePoint } from "./model";

/**
 * The branch's own price through time, drawn from what the server holds (no outside service, so it also shows with no connection).
 *  - gold line: the price per pound the branch pays (reference price + margin), as steps, because a price holds until it is changed;
 *  - grey dashed line: the reference price (GoldBod) under it;
 *  - bars below (optional): the cedis paid for gold each day.
 * Drawn with TradingView's open-source Lightweight Charts; its small logo on the chart is the attribution its licence asks for.
 */
export function OwnPriceChart({
  price,
  base,
  bought,
  height = 300,
}: {
  price: LinePoint[];
  base?: LinePoint[];
  bought?: LinePoint[];
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{
    price: ISeriesApi<"Line">;
    base: ISeriesApi<"Line">;
    bought: ISeriesApi<"Histogram"> | null;
  } | null>(null);
  const withBars = !!bought;

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#64748b",
        fontFamily: '"DM Sans", system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: "rgba(100,116,139,0.25)" },
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(100,116,139,0.15)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: { labelBackgroundColor: "#0d1b2e" },
        vertLine: { labelBackgroundColor: "#0d1b2e" },
      },
      // The locale is fixed (not taken from the computer), so dates read the same everywhere and an odd system locale cannot break the chart.
      localization: {
        locale: "en-GB",
        priceFormatter: (v: number) => Math.round(v).toLocaleString("en-GH"),
      },
      handleScale: { mouseWheel: false }, // the page scrolls with the wheel; pinch and drag still zoom and pan
    });
    const baseSeries = c.addSeries(LineSeries, {
      color: "#94a3b8",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const priceSeries = c.addSeries(LineSeries, {
      color: "#c9a84c",
      lineWidth: 3,
      lineType: LineType.WithSteps,
      priceLineColor: "#c9a84c",
      pointMarkersVisible: false,
    });
    const boughtSeries = withBars
      ? c.addSeries(
          HistogramSeries,
          {
            color: "rgba(13,27,46,0.55)",
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat: { type: "volume" },
          },
          1,
        )
      : null;
    if (boughtSeries) c.panes()[1]?.setHeight(Math.round(height * 0.26));
    chart.current = c;
    series.current = {
      price: priceSeries,
      base: baseSeries,
      bought: boughtSeries,
    };
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [withBars, height]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const data = (l: LinePoint[]) =>
      l.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
    s.price.setData(data(price));
    s.base.setData(data(base ?? []));
    s.bought?.setData(data(bought ?? []));
    chart.current?.timeScale().fitContent();
  }, [price, base, bought, withBars, height]);

  return (
    <div
      ref={host}
      style={{ height }}
      className="w-full"
      role="img"
      aria-label="Chart of the branch's price per pound over time"
    />
  );
}
