"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  LineSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chart-settings";
import {
  candleTimeToUtcTimestamp,
  computeEMA,
  computeSMA,
  type CompLabCandle,
} from "@/lib/complab/chart-series";
import { sliceCompMiniChartWindow } from "@/lib/complab/mini-chart-window";

const REFERENCE_CANDLE_UP = "#3DDC84";
const REFERENCE_CANDLE_DOWN = "#EF4468";
const POST_SETUP_OPACITY = 0.7;

function withOpacity(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Props = {
  candles: CompLabCandle[];
  compDate: string;
  className?: string;
};

export default function CompLabMiniChart({ candles, compDate, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const sliced = useMemo(() => sliceCompMiniChartWindow(candles, compDate), [candles, compDate]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || sliced.window.length === 0) return;

    const settings = DEFAULT_CHART_SETTINGS;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: settings.backgroundColor },
        textColor: "#D9D9D9",
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      width: el.clientWidth,
      height: el.clientHeight,
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        visible: false,
        borderVisible: false,
      },
      leftPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
      crosshair: { mode: CrosshairMode.Hidden },
    });

    const seriesData = sliced.window.map((d) => ({
      time: candleTimeToUtcTimestamp(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      date: d.date,
    }));

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: settings.candleUpBodyColor,
      downColor: settings.candleDownBodyColor,
      borderUpColor: settings.candleUpBorderColor,
      borderDownColor: settings.candleDownBorderColor,
      wickUpColor: settings.candleUpWickColor,
      wickDownColor: settings.candleDownWickColor,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    candleSeries.setData(
      seriesData.map((d, i) => {
        const up = d.close >= d.open;
        const isComp = i === sliced.compIndex;
        const isPostSetup = i >= sliced.postSetupStartIndex;
        const opacity = isPostSetup ? POST_SETUP_OPACITY : 1;

        if (isComp) {
          const color = up ? REFERENCE_CANDLE_UP : REFERENCE_CANDLE_DOWN;
          return {
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            color,
            borderColor: color,
            wickColor: color,
          };
        }

        const body = up ? settings.candleUpBodyColor : settings.candleDownBodyColor;
        const border = up ? settings.candleUpBorderColor : settings.candleDownBorderColor;
        const wick = up ? settings.candleUpWickColor : settings.candleDownWickColor;
        return {
          time: d.time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          color: withOpacity(body, opacity),
          borderColor: withOpacity(border, opacity),
          wickColor: withOpacity(wick, opacity),
        };
      })
    );

    const closes = sliced.window.map((d) => d.close);
    const addLine = (values: (number | null)[], color: string, alpha: number) => {
      const line = chart.addSeries(LineSeries, {
        color: withOpacity(color, alpha),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(
        seriesData
          .map((d, i) => (values[i] != null ? { time: d.time, value: values[i]! } : null))
          .filter((x): x is { time: UTCTimestamp; value: number } => x != null)
      );
    };

    addLine(computeEMA(closes, 20), "#a855f7", 0.85);
    addLine(computeEMA(closes, 50), "#ef4444", 0.85);
    addLine(computeSMA(closes, 200), "#22c55e", 0.85);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      chart.timeScale().fitContent();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [sliced]);

  if (sliced.window.length === 0) {
    return (
      <div
        className={`flex h-[180px] items-center justify-center rounded border text-xs ${className}`}
        style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
      >
        No chart window
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`h-[180px] w-full overflow-hidden rounded border ${className}`}
      style={{ borderColor: "var(--ws-border)", background: DEFAULT_CHART_SETTINGS.backgroundColor }}
    />
  );
}
