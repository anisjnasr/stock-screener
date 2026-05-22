"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  LineSeries,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type TimeChartOptions,
  type UTCTimestamp,
} from "lightweight-charts";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chart-settings";
import {
  candleTimeToUtcTimestamp,
  computeEMA,
  computeSMA,
  timeToDateKey,
  type CompLabCandle,
} from "@/lib/complab/chart-series";
import {
  buildReferenceDateContext,
  isSelectableReferenceDate,
  type ReferenceDateContext,
} from "@/lib/complab/reference-dates";
import { ymdInEt } from "@/lib/et-ymd";

const REFERENCE_CANDLE_UP = "#3DDC84";
const REFERENCE_CANDLE_DOWN = "#EF4468";
const DEFAULT_VISIBLE_BARS = 126;
const CHART_RIGHT_PADDING = 5;

const COMP_LAB_INDICATORS = [
  { key: "ema20", label: "EMA(20)", color: "#a855f7" },
  { key: "ema50", label: "EMA(50)", color: "#ef4444" },
  { key: "sma200", label: "SMA(200)", color: "#22c55e" },
] as const;

function compLabChartOptions(el: HTMLElement, backgroundColor: string): DeepPartial<TimeChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: backgroundColor },
      textColor: "#D9D9D9",
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    width: el.clientWidth,
    height: el.clientHeight,
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: "rgba(113,113,122,0.4)",
      allowBoldLabels: true,
    },
    handleScroll: {
      mouseWheel: false,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: false,
      pinch: true,
      axisPressedMouseMove: true,
    },
    rightPriceScale: {
      visible: true,
      borderVisible: true,
      borderColor: "rgba(113,113,122,0.5)",
      scaleMargins: { top: 0.1, bottom: 0.02 },
      minimumWidth: 80,
      entireTextOnly: false,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        visible: true,
        width: 1,
        style: 1 as const,
        color: "rgba(233,236,243,0.9)",
        labelBackgroundColor: "rgba(28,30,34,0.96)",
      },
      horzLine: {
        visible: true,
        width: 1,
        style: 1 as const,
        labelVisible: true,
        color: "rgba(233,236,243,0.9)",
        labelBackgroundColor: "rgba(28,30,34,0.96)",
      },
    },
  };
}

export type CompLabSetupChartProps = {
  symbol: string;
  candles: CompLabCandle[] | null;
  loading?: boolean;
  referenceDate: string | null;
  onReferenceDateChange: (date: string | null) => void;
};

export function buildCompLabDateContext(candles: CompLabCandle[] | null): ReferenceDateContext | null {
  if (!candles?.length) return null;
  return buildReferenceDateContext(candles, ymdInEt());
}

export default function CompLabSetupChart({
  symbol,
  candles,
  loading = false,
  referenceDate,
  onReferenceDateChange,
}: CompLabSetupChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const referenceDateRef = useRef(referenceDate);
  referenceDateRef.current = referenceDate;
  const dateContext = useMemo(() => buildCompLabDateContext(candles), [candles]);

  const chronological = useMemo(() => {
    if (!candles?.length) return [];
    return candles.slice().sort((a, b) => a.date.localeCompare(b.date));
  }, [candles]);

  const seriesData = useMemo(
    () =>
      chronological.map((d) => ({
        time: candleTimeToUtcTimestamp(d.date),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        date: d.date,
      })),
    [chronological]
  );

  const barIndexByDate = useMemo(() => {
    const m = new Map<string, number>();
    chronological.forEach((c, i) => m.set(c.date, i));
    return m;
  }, [chronological]);

  const scrollToDate = useCallback(
    (isoDate: string | null) => {
      const chart = chartRef.current;
      if (!chart || !isoDate || seriesData.length === 0) return;
      const idx = barIndexByDate.get(isoDate);
      if (idx == null) return;
      const to = idx + CHART_RIGHT_PADDING;
      const from = Math.max(0, to - DEFAULT_VISIBLE_BARS + 1);
      chart.timeScale().setVisibleLogicalRange({ from, to });
    },
    [barIndexByDate, seriesData.length]
  );

  const applyCandleData = useCallback(
    (selected: string | null) => {
      const series = candleSeriesRef.current;
      if (!series) return;
      const settings = DEFAULT_CHART_SETTINGS;
      series.setData(
        seriesData.map((d) => {
          if (d.date === selected) {
            const up = d.close >= d.open;
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
          const up = d.close >= d.open;
          return {
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            color: up ? settings.candleUpBodyColor : settings.candleDownBodyColor,
            borderColor: up ? settings.candleUpBorderColor : settings.candleDownBorderColor,
            wickColor: up ? settings.candleUpWickColor : settings.candleDownWickColor,
          };
        })
      );
    },
    [seriesData]
  );

  useEffect(() => {
    applyCandleData(referenceDate);
  }, [applyCandleData, referenceDate]);

  useEffect(() => {
    if (referenceDate) scrollToDate(referenceDate);
  }, [referenceDate, scrollToDate]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || seriesData.length === 0) return;

    const settings = DEFAULT_CHART_SETTINGS;
    const chart = createChart(el, compLabChartOptions(el, settings.backgroundColor));
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: settings.candleUpBodyColor,
      downColor: settings.candleDownBodyColor,
      borderUpColor: settings.candleUpBorderColor,
      borderDownColor: settings.candleDownBorderColor,
      wickUpColor: settings.candleUpWickColor,
      wickDownColor: settings.candleDownWickColor,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    candleSeriesRef.current = candleSeries;
    applyCandleData(referenceDateRef.current);

    const closes = chronological.map((d) => d.close);
    const ema20 = computeEMA(closes, 20);
    const ema50 = computeEMA(closes, 50);
    const sma200 = computeSMA(closes, 200);

    const addLine = (values: (number | null)[], color: string) => {
      const line = chart.addSeries(LineSeries, {
        color,
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

    addLine(ema20, "#a855f7");
    addLine(ema50, "#ef4444");
    addLine(sma200, "#22c55e");

    const lastIdx = seriesData.length - 1;
    const fromIdx = Math.max(0, lastIdx - DEFAULT_VISIBLE_BARS + 1);
    chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: lastIdx + CHART_RIGHT_PADDING });

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const from = Number(range.from);
      const to = Number(range.to);
      const visibleBars = to - from;
      const zoomFactor = e.deltaY > 0 ? 0.1 : -0.1;
      const delta = Math.max(1, Math.round(visibleBars * Math.abs(zoomFactor)));
      const newFrom = e.deltaY > 0 ? from - delta : from + delta;
      const clampedFrom = Math.max(-50, Math.min(to - 5, newFrom));
      ts.setVisibleLogicalRange({ from: clampedFrom, to });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });

    const todayEt = ymdInEt();
    chart.subscribeClick((param) => {
      const dateKey = timeToDateKey(param.time);
      if (!dateKey || !dateContext) return;
      if (dateKey >= todayEt) return;
      if (!isSelectableReferenceDate(dateKey, dateContext)) return;
      const current = referenceDateRef.current;
      onReferenceDateChange(current === dateKey ? null : dateKey);
    });

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    ro.observe(el);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [applyCandleData, chronological, dateContext, onReferenceDateChange, seriesData, symbol]);

  return (
    <div
      className="relative min-h-[400px] w-full overflow-hidden rounded border"
      style={{ borderColor: "var(--ws-border)", background: DEFAULT_CHART_SETTINGS.backgroundColor }}
    >
      {loading && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center text-sm"
          style={{
            color: "#D9D9D9",
            background: "rgba(41,43,49,0.82)",
          }}
        >
          Loading chart…
        </div>
      )}
      {!loading && (!candles || candles.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "#D9D9D9" }}>
          No chart data for {symbol}
        </div>
      )}
      {!loading && candles && candles.length > 0 && (
        <div
          className="pointer-events-none absolute left-3 top-2 z-10 flex flex-row flex-wrap items-center gap-x-4 gap-y-1"
        >
          {COMP_LAB_INDICATORS.map((ind) => (
            <div
              key={ind.key}
              className="flex items-center gap-1.5 text-ws-label font-medium"
              style={{ color: ind.color }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ind.color }} />
              {ind.label}
            </div>
          ))}
        </div>
      )}
      <div ref={containerRef} className="h-full min-h-[400px] w-full" />
    </div>
  );
}
