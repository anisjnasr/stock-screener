"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
  CandlestickSeries,
} from "lightweight-charts";
import { DEFAULT_CHART_SETTINGS, loadChartSettings } from "@/lib/chart-settings";
import { createExtendedHoursShadePrimitive, extendedHoursShadeFromBg } from "@/lib/intraday-extended-hours-shade";
import type { IntradayBarInterval } from "@/lib/massive";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type IntradayTf = { label: string; interval: IntradayBarInterval };

const TIMEFRAMES: IntradayTf[] = [
  { label: "1m", interval: 1 },
  { label: "5m", interval: 5 },
  { label: "15m", interval: 15 },
  { label: "1h", interval: 60 },
];

function candleToBar(c: Candle): { time: UTCTimestamp; open: number; high: number; low: number; close: number } {
  const ms = new Date(c.date).getTime();
  return {
    time: (ms / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

const CHART_MIN_HEIGHT_PX = 300;

/** Match StockChart: treat bright canvas backgrounds as “light” for toolbar styling. */
function isLightChartBackground(color: string): boolean {
  const hex = color.replace("#", "");
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export default function IntradayChart({ symbol }: { symbol: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);
  const extendedHoursPrimitiveRef = useRef<ReturnType<typeof createExtendedHoursShadePrimitive> | null>(null);

  const [interval, setInterval] = useState<IntradayBarInterval>(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = typeof window !== "undefined" ? loadChartSettings() : DEFAULT_CHART_SETTINGS;
  const isLightBackground = isLightChartBackground(settings.backgroundColor);
  const toolbarMutedClass = isLightBackground
    ? "text-zinc-800 hover:bg-zinc-200/70"
    : "text-zinc-200 hover:bg-white/10";
  const toolbarActiveClass = isLightBackground ? "bg-zinc-900 text-zinc-100" : "bg-zinc-200 text-zinc-900";

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const settings = typeof window !== "undefined" ? loadChartSettings() : DEFAULT_CHART_SETTINGS;
    const isLightBg = isLightChartBackground(settings.backgroundColor);

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: settings.backgroundColor },
        textColor: isLightBg ? "#333333" : "#D9D9D9",
        panes: {
          separatorColor: isLightBg ? "rgba(0,0,0,0.15)" : "rgba(113,113,122,0.4)",
          separatorHoverColor: isLightBg ? "rgba(0,0,0,0.3)" : "rgba(113,113,122,0.6)",
        },
      },
      grid: {
        vertLines: { visible: settings.showVertGrid },
        horzLines: { visible: settings.showHorzGrid },
      },
      width: el.clientWidth,
      height: Math.max(el.clientHeight, CHART_MIN_HEIGHT_PX),
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: isLightBg ? "rgba(0,0,0,0.2)" : "rgba(113,113,122,0.4)",
        allowBoldLabels: true,
      },
      handleScroll: { mouseWheel: false },
      handleScale: { mouseWheel: false },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: isLightBg ? "rgba(0,0,0,0.2)" : "rgba(113,113,122,0.5)",
        scaleMargins: { top: 0.08, bottom: 0.05 },
        minimumWidth: 72,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          width: 1,
          style: 1,
          color: isLightBg ? "rgba(50,50,50,0.5)" : "rgba(233,236,243,0.9)",
          labelBackgroundColor: isLightBg ? "rgba(240,240,240,0.96)" : "rgba(28,30,34,0.96)",
        },
        horzLine: {
          visible: true,
          width: 1,
          style: 1,
          labelVisible: true,
          color: isLightBg ? "rgba(50,50,50,0.5)" : "rgba(233,236,243,0.9)",
          labelBackgroundColor: isLightBg ? "rgba(240,240,240,0.96)" : "rgba(28,30,34,0.96)",
        },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: settings.candleUpBodyColor,
      downColor: settings.candleDownBodyColor,
      borderUpColor: settings.candleUpBorderColor,
      borderDownColor: settings.candleDownBorderColor,
      wickUpColor: settings.candleUpWickColor,
      wickDownColor: settings.candleDownWickColor,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const extPrimitive = createExtendedHoursShadePrimitive(extendedHoursShadeFromBg(settings.backgroundColor));
    extendedHoursPrimitiveRef.current = extPrimitive;
    chart.panes()[0].attachPrimitive(extPrimitive);

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current || !chartRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      chartRef.current.applyOptions({
        width: Math.floor(r.width),
        height: Math.max(Math.floor(r.height), CHART_MIN_HEIGHT_PX),
      });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.panes()[0].detachPrimitive(extPrimitive);
      extendedHoursPrimitiveRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  const loadData = useCallback(
    async (sym: string, iv: IntradayBarInterval, signal: AbortSignal) => {
      const s = sym.trim().toUpperCase();
      if (!s) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/intraday-candles?symbol=${encodeURIComponent(s)}&interval=${iv}`,
          { signal, cache: "no-store" }
        );
        const json = (await res.json()) as Candle[] | { error?: string };
        if (!res.ok) {
          const msg = json && typeof json === "object" && "error" in json ? String(json.error) : res.statusText;
          throw new Error(msg || "Request failed");
        }
        if (!Array.isArray(json)) {
          throw new Error("Invalid response");
        }
        const bars = json.map(candleToBar).filter((b) => Number.isFinite(b.time) && b.time > 0);
        seriesRef.current?.setData(bars);
        const stepSec = iv === 60 ? 3600 : iv * 60;
        extendedHoursPrimitiveRef.current?.setBarTimesSec(
          bars.map((b) => b.time),
          stepSec
        );
        chartRef.current?.timeScale().fitContent();
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Failed to load intraday data";
        setError(msg);
        seriesRef.current?.setData([]);
        extendedHoursPrimitiveRef.current?.setBarTimesSec([], 60);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadData(symbol, interval, controller.signal);
    return () => controller.abort();
  }, [symbol, interval, loadData]);

  const sym = symbol.trim().toUpperCase();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5"
        style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg3)" }}
      >
        <div className="text-ws-caption font-semibold uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
          Intraday <span className="font-mono normal-case tracking-normal" style={{ color: "var(--ws-cyan)" }}>{sym}</span>
          <span style={{ color: "var(--ws-text-vdim)" }} className="ml-1.5 font-normal normal-case">
            (48h)
          </span>
        </div>
        <div
          className="flex flex-wrap items-center gap-1 rounded-b px-1.5 py-0.5"
          style={{
            background: isLightBackground ? "rgba(255,255,255,0.28)" : "transparent",
          }}
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.interval}
              type="button"
              onClick={() => setInterval(tf.interval)}
              className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
                interval === tf.interval ? toolbarActiveClass : toolbarMutedClass
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="shrink-0 px-2 py-1 text-ws-caption" style={{ color: "var(--ws-red)" }}>
          {error}
        </div>
      )}
      <div className="relative flex-1 min-h-[300px] min-w-0">
        {loading && (
          <div
            className="pointer-events-none absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: "var(--ws-bg2)", color: "var(--ws-text-dim)", border: "1px solid var(--ws-border)" }}
          >
            Loading…
          </div>
        )}
        <div ref={wrapRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
