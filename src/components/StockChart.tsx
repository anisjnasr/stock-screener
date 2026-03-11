"use client";

/**
 * Stock chart using TradingView Lightweight Charts
 * (https://www.tradingview.com/lightweight-charts/)
 */
import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import { DEFAULT_CHART_SETTINGS, loadChartSettings, saveChartSettings, type ChartSettings, type ChartSeriesType } from "@/lib/chart-settings";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartTimeframe = "daily" | "weekly" | "monthly";

type StockChartProps = {
  symbol: string;
  data: Candle[] | null;
  loading?: boolean;
  timeframe?: ChartTimeframe;
  onTimeframeChange?: (tf: ChartTimeframe) => void;
};

function dateToTime(dateStr: string): UTCTimestamp {
  return (new Date(dateStr + "T12:00:00Z").getTime() / 1000) as UTCTimestamp;
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length === 0 || period < 1) return [];
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      ema = sum / period;
    } else if (ema !== null) {
      ema = (c - ema) * k + ema;
    }
    out.push(ema);
  }
  return out;
}

export default function StockChart({
  symbol,
  data,
  loading,
  timeframe = "daily",
  onTimeframeChange,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [crosshairCandle, setCrosshairCandle] = useState<Candle | null>(null);
  const [settings, setSettings] = useState<ChartSettings>(() => loadChartSettings());
  const [showSettings, setShowSettings] = useState(false);

  const chronological = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.slice().sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const seriesData = useMemo(() => {
    if (chronological.length === 0) return [];
    return chronological.map((d) => ({
      time: dateToTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
  }, [chronological]);

  const volumeData = useMemo(() => {
    if (chronological.length === 0) return [];
    const upColor = settings.candleUpBodyColor;
    const downColor = settings.candleDownBodyColor;
    return chronological.map((d) => ({
      time: dateToTime(d.date),
      value: d.volume,
      color: d.close >= d.open ? upColor : downColor,
    }));
  }, [chronological, settings]);

  const ema50Data = useMemo(() => {
    if (timeframe !== "daily") return [];
    const closes = chronological.map((d) => d.close);
    const ema = computeEMA(closes, 50);
    return seriesData
      .map((d, i) => (ema[i] != null ? { time: d.time, value: ema[i]! } : null))
      .filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
  }, [timeframe, chronological, seriesData]);

  const ema200Data = useMemo(() => {
    if (timeframe !== "daily") return [];
    const closes = chronological.map((d) => d.close);
    const ema = computeEMA(closes, 200);
    return seriesData
      .map((d, i) => (ema[i] != null ? { time: d.time, value: ema[i]! } : null))
      .filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
  }, [timeframe, chronological, seriesData]);

  const ema40Data = useMemo(() => {
    if (timeframe !== "weekly") return [];
    const closes = chronological.map((d) => d.close);
    const ema = computeEMA(closes, 40);
    return seriesData
      .map((d, i) => (ema[i] != null ? { time: d.time, value: ema[i]! } : null))
      .filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
  }, [timeframe, chronological, seriesData]);

  const handleUpdateSettings = useCallback(
    (partial: Partial<ChartSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial };
        saveChartSettings(next);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current || seriesData.length === 0) return;

    const el = containerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: settings.backgroundColor },
        textColor: "#D9D9D9",
        panes: {
          separatorColor: "rgba(113,113,122,0.4)",
          separatorHoverColor: "rgba(113,113,122,0.6)",
        },
      },
      grid: {
        vertLines: { visible: settings.showVertGrid },
        horzLines: { visible: settings.showHorzGrid },
      },
      width: el.clientWidth,
      height: Math.max(el.clientHeight, 300),
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "rgba(113,113,122,0.4)",
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
          color: "rgba(140,140,140,0.28)",
          labelBackgroundColor: "rgba(140,140,140,0.28)",
        },
        horzLine: {
          visible: false,
          labelVisible: true,
          color: "rgba(140,140,140,0.28)",
          labelBackgroundColor: "#22c55e",
        },
      },
    });

    // Overlays: EMAs
    if (timeframe === "daily") {
      if (settings.showEma50 && ema50Data.length > 0) {
        chart
          .addSeries(LineSeries, {
            color: "#ef4444",
            lineWidth: 1,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
          .setData(ema50Data);
      }
      if (settings.showEma200 && ema200Data.length > 0) {
        chart
          .addSeries(LineSeries, {
            color: "#22c55e",
            lineWidth: 1,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
          .setData(ema200Data);
      }
    } else if (timeframe === "weekly" && settings.showEma40Weekly && ema40Data.length > 0) {
      chart
        .addSeries(LineSeries, {
          color: "#22c55e",
          lineWidth: 1,
          priceScaleId: "right",
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })
        .setData(ema40Data);
    }

    // Main price series type
    const addMainSeries = (type: ChartSeriesType) => {
      if (type === "line") {
        const series = chart.addSeries(LineSeries, {
          color: settings.candleUpBodyColor,
          lineWidth: 2,
        });
        series.setData(
          seriesData.map((d) => ({
            time: d.time,
            value: d.close,
          }))
        );
      } else if (type === "area") {
        const series = chart.addSeries(LineSeries, {
          color: settings.candleUpBodyColor,
          lineWidth: 2,
        });
        series.setData(
          seriesData.map((d) => ({
            time: d.time,
            value: d.close,
          }))
        );
      } else {
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: settings.candleUpBodyColor,
          downColor: settings.candleDownBodyColor,
          borderUpColor: settings.candleUpBorderColor,
          borderDownColor: settings.candleDownBorderColor,
          wickUpColor: settings.candleUpWickColor,
          wickDownColor: settings.candleDownWickColor,
        });
        candleSeries.setData(seriesData);
      }
    };
    addMainSeries(settings.type);

    const timeToCandle = new Map<number, Candle>();
    chronological.forEach((c) => timeToCandle.set(dateToTime(c.date), c));
    const unsubCrosshair = chart.subscribeCrosshairMove((param) => {
      if (param.time != null) {
        const candle = timeToCandle.get(param.time as number);
        setCrosshairCandle(candle ?? null);
      } else {
        setCrosshairCandle(null);
      }
    });

    if (settings.showVolume && volumeData.length > 0) {
      chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          priceScaleId: "",
        },
        1
      ).setData(volumeData);
      const panes = chart.panes();
      if (panes[0]) panes[0].setStretchFactor(7);
      if (panes[1]) panes[1].setStretchFactor(1);
    }

    // Default zoom: last 12 months of candles, with 3 bars space from current bar to price axis
    const barsIn12Months = timeframe === "daily" ? 252 : timeframe === "weekly" ? 52 : 12;
    const barCount = seriesData.length;
    const visibleFrom = Math.max(0, barCount - barsIn12Months);
    const visibleTo = barCount - 1;
    chart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: visibleTo + 3 });

    try {
      const rightScale = chart.priceScale("right");
      if (rightScale) rightScale.applyOptions({ visible: true, borderVisible: true });
    } catch {
      /* ignore */
    }

    chartRef.current = chart;

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      const el = containerRef.current;
      chartRef.current.applyOptions({
        width: el.clientWidth,
        height: Math.max(el.clientHeight, 300),
      });
    };
    window.addEventListener("resize", handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(el);

    return () => {
      try {
        (unsubCrosshair as (() => void) | undefined)?.();
      } catch {
        /* ignore */
      }
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, timeframe, chronological, seriesData, volumeData, ema50Data, ema200Data, ema40Data, settings]);

  const timeframes: ChartTimeframe[] = ["daily", "weekly", "monthly"];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-zinc-900">
      <div className="px-2 py-1 border-b border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold font-mono text-zinc-900 dark:text-zinc-100">{symbol}</span>
        <div className="flex items-center gap-1">
          {onTimeframeChange &&
            timeframes.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                  timeframe === tf
                    ? "bg-zinc-700 dark:bg-zinc-600 text-white"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {tf.charAt(0).toUpperCase() + tf.slice(1)}
              </button>
            ))}
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">TradingView Lightweight Charts</span>
      </div>
      {loading ? (
        <div className="flex-1 min-h-[300px] flex items-center justify-center">
          <p className="text-zinc-500 dark:text-zinc-400">Loading chart…</p>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex-1 min-h-[300px] flex items-center justify-center">
          <p className="text-zinc-500 dark:text-zinc-400">No chart data</p>
        </div>
      ) : (
        <div className="relative w-full flex-1 min-h-0">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />
          {crosshairCandle && (
            <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-[#2A2D31]/95 border border-zinc-600 text-[#D9D9D9] text-xs font-mono flex items-center gap-3">
              <span>O {crosshairCandle.open.toFixed(2)}</span>
              <span>H {crosshairCandle.high.toFixed(2)}</span>
              <span>L {crosshairCandle.low.toFixed(2)}</span>
              <span>C {crosshairCandle.close.toFixed(2)}</span>
              <span>V {fmtVol(crosshairCandle.volume)}</span>
            </div>
          )}
          {/* Chart settings trigger at axes intersection (bottom-right) */}
          <div className="absolute bottom-1 right-1 z-20">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="p-1.5 rounded bg-zinc-900/80 text-zinc-300 border border-zinc-600 hover:bg-zinc-800"
              title="Chart settings"
              aria-label="Chart settings"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M9.243 1.5a1.25 1.25 0 0 0-2.486 0l-.11.887a4.51 4.51 0 0 0-1.26.73l-.852-.36a1.25 1.25 0 0 0-1.64.66l-.75 1.8a1.25 1.25 0 0 0 .64 1.62l.83.35a4.37 4.37 0 0 0 0 1.46l-.83.35a1.25 1.25 0 0 0-.64 1.62l.75 1.8a1.25 1.25 0 0 0 1.64.66l.852-.36a4.51 4.51 0 0 0 1.26.73l.11.887a1.25 1.25 0 0 0 2.486 0l.11-.887a4.51 4.51 0 0 0 1.26-.73l.852.36a1.25 1.25 0 0 0 1.64-.66l.75-1.8a1.25 1.25 0 0 0-.64-1.62l-.83-.35a4.37 4.37 0 0 0 0-1.46l.83-.35a1.25 1.25 0 0 0 .64-1.62l-.75-1.8a1.25 1.25 0 0 0-1.64-.66l-.852.36a4.51 4.51 0 0 0-1.26-.73l-.11-.887ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
              </svg>
            </button>
            {showSettings && (
              <div className="absolute right-0 bottom-7 z-20 w-64 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg p-3 text-xs space-y-3">
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Chart type</div>
                  <div className="flex flex-wrap gap-1">
                    {(["candles", "line", "area"] as ChartSeriesType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleUpdateSettings({ type: t })}
                        className={`px-2 py-0.5 rounded border text-[11px] ${
                          settings.type === t
                            ? "border-zinc-700 dark:border-zinc-300 text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-700"
                            : "border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {t === "candles" ? "Candles" : t === "line" ? "Line" : "Area"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Overlays</div>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showEma50}
                      onChange={(e) => handleUpdateSettings({ showEma50: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">EMA 50 (daily)</span>
                  </label>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showEma200}
                      onChange={(e) => handleUpdateSettings({ showEma200: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">EMA 200 (daily)</span>
                  </label>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showEma40Weekly}
                      onChange={(e) => handleUpdateSettings({ showEma40Weekly: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">EMA 40 (weekly)</span>
                  </label>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Volume & grid</div>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showVolume}
                      onChange={(e) => handleUpdateSettings({ showVolume: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">Show volume</span>
                  </label>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showVertGrid}
                      onChange={(e) => handleUpdateSettings({ showVertGrid: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">Vertical grid</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.showHorzGrid}
                      onChange={(e) => handleUpdateSettings({ showHorzGrid: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">Horizontal grid</span>
                  </label>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Colors</div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Background</span>
                    <input
                      type="color"
                      value={settings.backgroundColor}
                      onChange={(e) => handleUpdateSettings({ backgroundColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Up candle body</span>
                    <input
                      type="color"
                      value={settings.candleUpBodyColor}
                      onChange={(e) => handleUpdateSettings({ candleUpBodyColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Down candle body</span>
                    <input
                      type="color"
                      value={settings.candleDownBodyColor}
                      onChange={(e) => handleUpdateSettings({ candleDownBodyColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Up outline</span>
                    <input
                      type="color"
                      value={settings.candleUpBorderColor}
                      onChange={(e) => handleUpdateSettings({ candleUpBorderColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Down outline</span>
                    <input
                      type="color"
                      value={settings.candleDownBorderColor}
                      onChange={(e) => handleUpdateSettings({ candleDownBorderColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Up wick</span>
                    <input
                      type="color"
                      value={settings.candleUpWickColor}
                      onChange={(e) => handleUpdateSettings({ candleUpWickColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-600 dark:text-zinc-300">Down wick</span>
                    <input
                      type="color"
                      value={settings.candleDownWickColor}
                      onChange={(e) => handleUpdateSettings({ candleDownWickColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setSettings(DEFAULT_CHART_SETTINGS);
                      saveChartSettings(DEFAULT_CHART_SETTINGS);
                    }}
                    className="text-[11px] text-zinc-500 dark:text-zinc-400 hover:underline"
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
