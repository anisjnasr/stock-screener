"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import StockChart, { type ChartTimeframe } from "@/components/StockChart";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type NetPoint = { date: string; highs: number; lows: number; net: number };
type BreadthPoint = {
  date: string;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
  count50d: number;
  count200d: number;
};

type BreadthResponse = {
  indexId: "sp500" | "nasdaq";
  latestDate: string | null;
  startDate: string | null;
  netNewHighs: {
    oneMonth: NetPoint[];
    threeMonths: NetPoint[];
    sixMonths: NetPoint[];
    fiftyTwoWeek: NetPoint[];
  };
  breadth: BreadthPoint[];
};

type VisibleDateRange = { from: string; to: string };

function fmtDate(s: string): string {
  return s?.slice(5) ?? s;
}

function SubChart({
  title,
  data,
  kind,
}: {
  title: string;
  data: Array<{ date: string; value: number | null }>;
  kind: "net" | "pct";
}) {
  const cleaned = data.filter((d) => d.value != null) as Array<{ date: string; value: number }>;
  const currentValue = cleaned.length > 0 ? cleaned[cleaned.length - 1].value : null;
  const nnhDomain = useMemo(() => {
    if (kind !== "net" || cleaned.length === 0) return undefined as [number, number] | undefined;
    const absVals = cleaned.map((d) => Math.abs(d.value)).sort((a, b) => a - b);
    const p95 = absVals[Math.max(0, Math.floor(absVals.length * 0.95) - 1)] ?? 1;
    const maxAbs = Math.max(5, p95 * 1.15);
    return [-maxAbs, maxAbs] as [number, number];
  }, [kind, cleaned]);
  const fmtCurrentValue = currentValue != null
    ? kind === "pct" ? `${currentValue.toFixed(1)}%` : String(Math.round(currentValue))
    : "";
  const currentColor = kind === "pct"
    ? "text-sky-500 dark:text-sky-400"
    : currentValue != null && currentValue >= 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  return (
    <div className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/40 dark:bg-zinc-800/35 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
          {title}
        </span>
        <span className={`text-xs font-semibold tabular-nums ${currentColor}`}>
          {fmtCurrentValue}
        </span>
      </div>
      <div className="h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "net" ? (
            <BarChart data={cleaned} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#71717a" }}
                minTickGap={24}
              />
              <YAxis
                orientation="right"
                domain={nnhDomain}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#71717a" }}
                width={36}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.12)" }}
                formatter={(v) => {
                  const n = typeof v === "number" ? v : Number(v ?? 0);
                  return [Math.round(n), "Value"];
                }}
                labelFormatter={(label) => `Date: ${String(label)}`}
              />
              <ReferenceLine y={0} stroke="#3f3f46" strokeOpacity={0.7} />
              <Bar dataKey="value" maxBarSize={8} radius={[2, 2, 0, 0]}>
                {cleaned.map((row, idx) => (
                  <Cell key={`${row.date}-${idx}`} fill={row.value >= 0 ? "#0a8963" : "#a54557"} fillOpacity={1} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={cleaned} margin={{ top: 2, right: 4, left: 4, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#71717a" }}
                minTickGap={24}
              />
              <YAxis
                orientation="right"
                domain={[0, 100]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#71717a" }}
                width={36}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                cursor={{ stroke: "rgba(148,163,184,0.35)", strokeWidth: 1 }}
                formatter={(v) => {
                  const n = typeof v === "number" ? v : Number(v ?? 0);
                  return [`${n.toFixed(1)}%`, "Value"];
                }}
                labelFormatter={(label) => `Date: ${String(label)}`}
              />
              <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={1.8} dot={false} />
              <ReferenceLine y={50} stroke="#9ca3af" strokeOpacity={0.6} strokeWidth={1.25} strokeDasharray="3 3" />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function BreadthPage() {
  const [symbol, setSymbol] = useState<"SPY" | "QQQ">("SPY");
  const [breadth, setBreadth] = useState<BreadthResponse | null>(null);
  const [breadthLoading, setBreadthLoading] = useState(true);
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("daily");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [dualChartMode, setDualChartMode] = useState(false);
  const [syncCrosshair, setSyncCrosshair] = useState(true);
  const [dualLeftTimeframe, setDualLeftTimeframe] = useState<ChartTimeframe>("weekly");
  const [dualRightTimeframe, setDualRightTimeframe] = useState<ChartTimeframe>("daily");
  const [dualLeftCandles, setDualLeftCandles] = useState<Candle[] | null>(null);
  const [dualRightCandles, setDualRightCandles] = useState<Candle[] | null>(null);
  const [dualLeftLoading, setDualLeftLoading] = useState(true);
  const [dualRightLoading, setDualRightLoading] = useState(true);
  const [visibleRange, setVisibleRange] = useState<VisibleDateRange | null>(null);

  const indexId = symbol === "SPY" ? "sp500" : "nasdaq";

  const fetchCandlesFor = useCallback(async (sym: string, tf: ChartTimeframe, signal?: AbortSignal) => {
    try {
      const to = new Date();
      const from = new Date();
      from.setFullYear(from.getFullYear() - 2);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);
      const res = await fetch(
        `/api/candles?symbol=${encodeURIComponent(sym)}&from=${fromStr}&to=${toStr}&interval=${tf}`,
        signal ? { signal } : undefined
      );
      const d = await res.json();
      return Array.isArray(d) ? (d as Candle[]) : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setChartLoading(true);
    fetchCandlesFor(symbol, chartTimeframe, controller.signal)
      .then((rows) => {
        if (!cancelled && !controller.signal.aborted) setCandles(rows);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setChartLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, chartTimeframe, fetchCandlesFor]);

  useEffect(() => {
    if (!dualChartMode) return;
    let cancelled = false;
    const controller = new AbortController();
    setDualLeftLoading(true);
    fetchCandlesFor(symbol, dualLeftTimeframe, controller.signal)
      .then((rows) => {
        if (!cancelled && !controller.signal.aborted) setDualLeftCandles(rows);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setDualLeftLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dualChartMode, symbol, dualLeftTimeframe, fetchCandlesFor]);

  useEffect(() => {
    if (!dualChartMode) return;
    let cancelled = false;
    const controller = new AbortController();
    setDualRightLoading(true);
    fetchCandlesFor(symbol, dualRightTimeframe, controller.signal)
      .then((rows) => {
        if (!cancelled && !controller.signal.aborted) setDualRightCandles(rows);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setDualRightLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dualChartMode, symbol, dualRightTimeframe, fetchCandlesFor]);

  useEffect(() => {
    let cancelled = false;
    setBreadthLoading(true);
    fetch(`/api/breadth?index=${indexId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setBreadth(d as BreadthResponse);
      })
      .catch(() => {
        if (!cancelled) setBreadth(null);
      })
      .finally(() => {
        if (!cancelled) setBreadthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [indexId]);

  const sortAsc = useCallback(<T extends { date: string }>(rows: T[]): T[] => {
    return [...rows].sort((a, b) => a.date.localeCompare(b.date));
  }, []);
  const rangeClip = useCallback(
    <T extends { date: string }>(rows: T[]): T[] => {
      const sorted = sortAsc(rows);
      if (!visibleRange) return sorted.slice(-252);
      const from = visibleRange.from <= visibleRange.to ? visibleRange.from : visibleRange.to;
      const to = visibleRange.from <= visibleRange.to ? visibleRange.to : visibleRange.from;
      const inRange = sorted.filter((r) => r.date >= from && r.date <= to);
      return inRange.length > 0 ? inRange : sorted.slice(-252);
    },
    [sortAsc, visibleRange]
  );

  const nnh1m = useMemo(
    () => rangeClip((breadth?.netNewHighs.oneMonth ?? []).map((r) => ({ date: r.date, value: r.net }))),
    [breadth, rangeClip]
  );
  const nnh3m = useMemo(
    () => rangeClip((breadth?.netNewHighs.threeMonths ?? []).map((r) => ({ date: r.date, value: r.net }))),
    [breadth, rangeClip]
  );
  const nnh6m = useMemo(
    () => rangeClip((breadth?.netNewHighs.sixMonths ?? []).map((r) => ({ date: r.date, value: r.net }))),
    [breadth, rangeClip]
  );
  const nnh52w = useMemo(
    () => rangeClip((breadth?.netNewHighs.fiftyTwoWeek ?? []).map((r) => ({ date: r.date, value: r.net }))),
    [breadth, rangeClip]
  );
  const pct50 = useMemo(
    () => rangeClip((breadth?.breadth ?? []).map((r) => ({ date: r.date, value: r.pctAbove50d }))),
    [breadth, rangeClip]
  );
  const pct200 = useMemo(
    () => rangeClip((breadth?.breadth ?? []).map((r) => ({ date: r.date, value: r.pctAbove200d }))),
    [breadth, rangeClip]
  );

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-zinc-900 p-2 sm:p-3">
      <div className="mx-auto w-full max-w-[1800px] space-y-2 sm:space-y-3">
        <div className="flex flex-col items-center justify-center pt-1">
          <h1 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide text-center">
            Breadth
          </h1>
          <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 p-1">
            {(["SPY", "QQQ"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSymbol(s)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  symbol === s
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[280px] sm:h-[360px] lg:h-[460px] min-h-[220px] border border-zinc-200 dark:border-zinc-700 rounded-md overflow-hidden">
          {dualChartMode ? (
            <div className="flex h-full min-h-0 min-w-0">
              <div className="flex flex-1 min-w-0 min-h-0 border-r border-zinc-200 dark:border-zinc-700">
                <StockChart
                  symbol={symbol}
                  data={dualLeftCandles}
                  loading={dualLeftLoading}
                  timeframe={dualLeftTimeframe}
                  onTimeframeChange={setDualLeftTimeframe}
                  onVisibleDateRangeChange={setVisibleRange}
                  dualModeEnabled={dualChartMode}
                  onToggleDualMode={() => setDualChartMode((v) => !v)}
                  crosshairSyncEnabled={syncCrosshair}
                  onToggleCrosshairSync={() => setSyncCrosshair((v) => !v)}
                  showGlobalControls
                  chartInstanceId="breadth-dual-left"
                />
              </div>
              <div className="flex flex-1 min-w-0 min-h-0">
                <StockChart
                  symbol={symbol}
                  data={dualRightCandles}
                  loading={dualRightLoading}
                  timeframe={dualRightTimeframe}
                  onTimeframeChange={setDualRightTimeframe}
                  onVisibleDateRangeChange={setVisibleRange}
                  dualModeEnabled={dualChartMode}
                  crosshairSyncEnabled={syncCrosshair}
                  chartInstanceId="breadth-dual-right"
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 min-w-0">
              <StockChart
                symbol={symbol}
                data={candles}
                loading={chartLoading}
                timeframe={chartTimeframe}
                onTimeframeChange={setChartTimeframe}
                onVisibleDateRangeChange={setVisibleRange}
                dualModeEnabled={dualChartMode}
                onToggleDualMode={() => setDualChartMode((v) => !v)}
                crosshairSyncEnabled={syncCrosshair}
                onToggleCrosshairSync={() => setSyncCrosshair((v) => !v)}
                showGlobalControls
                chartInstanceId="breadth-single"
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <SubChart title="1M NNH" data={nnh1m} kind="net" />
          <SubChart title="3M NNH" data={nnh3m} kind="net" />
          <SubChart title="6M NNH" data={nnh6m} kind="net" />
          <SubChart title="52W NNH" data={nnh52w} kind="net" />
          <SubChart
            title={`${symbol === "SPY" ? "S&P 500" : "Nasdaq"} % Stocks > 50SMA`}
            data={pct50}
            kind="pct"
          />
          <SubChart
            title={`${symbol === "SPY" ? "S&P 500" : "Nasdaq"} % Stocks > 200SMA`}
            data={pct200}
            kind="pct"
          />
          {breadthLoading && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 px-1">Loading breadth series...</div>
          )}
        </div>
      </div>
    </div>
  );
}

