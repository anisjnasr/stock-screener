"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { createChart } from "lightweight-charts";

export function InstrumentChart({ symbol }: { symbol: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addCandlestickSeries"]> | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { color: "#27272a" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "#3f3f46" }, horzLines: { color: "#3f3f46" } },
      width: chartRef.current.clientWidth,
      height: 400,
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
    if (!symbol) return;
    api
      .candles(symbol)
      .then((data: { t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[] }) => {
        const series = seriesRef.current;
        if (!series || !data.t?.length) return;
        const bars = data.t.map((t, i) => ({
          time: new Date((t as number) * 1000).toISOString().slice(0, 10),
          open: (data.o ?? [])[i] ?? 0,
          high: (data.h ?? [])[i] ?? 0,
          low: (data.l ?? [])[i] ?? 0,
          close: (data.c ?? [])[i] ?? 0,
        }));
        series.setData(bars);
      })
      .catch(() => {});
  }, [symbol]);

  return <div ref={chartRef} />;
}
