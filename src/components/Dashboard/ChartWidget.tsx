"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { createChart } from "lightweight-charts";

const DEFAULT_SYMBOL = "SPY";

export function ChartWidget() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addCandlestickSeries"]> | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { color: "#27272a" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "#3f3f46" }, horzLines: { color: "#3f3f46" } },
      width: chartRef.current.clientWidth,
      height: 280,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    const candlestick = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
    });
    chartInstance.current = chart;
    seriesRef.current = candlestick;
    const resize = () => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
      chartInstance.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .candles(symbol)
      .then((data: { t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[] }) => {
        const series = seriesRef.current;
        if (!series || !data.t?.length) {
          setLoading(false);
          return;
        }
        const bars = data.t.map((t, i) => ({
          time: t as unknown as string,
          open: (data.o ?? [])[i] ?? 0,
          high: (data.h ?? [])[i] ?? 0,
          low: (data.l ?? [])[i] ?? 0,
          close: (data.c ?? [])[i] ?? 0,
        }));
        // lightweight-charts expects time in seconds as number for intraday or YYYY-MM-DD for daily
        const formatted = bars.map((b) => ({
          ...b,
          time: (typeof b.time === "number"
            ? new Date(b.time * 1000).toISOString().slice(0, 10)
            : b.time) as string,
        }));
        series.setData(formatted);
        setLoading(false);
      })
      .catch((e) => {
        setError((e as Error).message ?? "Failed to load chart");
        setLoading(false);
      });
  }, [symbol]);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-semibold text-white">Chart</h3>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onBlur={(e) => setSymbol(e.target.value.toUpperCase() || DEFAULT_SYMBOL)}
          className="w-20 rounded border border-zinc-600 bg-zinc-700 px-2 py-0.5 text-sm text-white"
        />
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {loading && (
        <div className="flex h-[280px] items-center justify-center text-zinc-400">
          Loading…
        </div>
      )}
      <div ref={chartRef} className={loading ? "hidden" : ""} />
    </div>
  );
}
