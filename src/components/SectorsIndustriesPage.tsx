"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDisplayDate } from "@/lib/date-format";

type Timeframe = "day" | "week" | "month" | "quarter" | "year";

type BarItem = {
  id: string;
  name: string;
  changePct: number | null;
  meta?: string;
};

type ApiResponse = {
  timeframe: Timeframe;
  date: string | null;
  indices: Array<{ id: string; name: string; ticker: string; changePct: number | null }>;
  sectors: Array<{ id: string; name: string; changePct: number | null; totalMarketCap: number; stockCount: number }>;
  industries: Array<{ id: string; name: string; changePct: number | null; totalMarketCap: number; stockCount: number }>;
  themes: Array<{ id: string; category: string; name: string; ticker: string; changePct: number | null }>;
  error?: string;
};

type OpenCollectionTarget = {
  kind: "index" | "sector" | "industry" | "theme";
  value: string;
};

const TIMEFRAME_OPTIONS: Array<{ id: Timeframe; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "NA";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function HorizontalBars({
  title,
  items,
  onClick,
}: {
  title: string;
  items: BarItem[];
  onClick?: (item: BarItem) => void;
}) {
  const maxAbs = useMemo(() => {
    const vals = items.map((x) => Math.abs(x.changePct ?? 0));
    return Math.max(1, ...vals);
  }, [items]);

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
      <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      <div className="space-y-1.5">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No data</p>
        ) : (
          items.map((item) => {
            const hasValue = item.changePct != null && Number.isFinite(item.changePct);
            const value = hasValue ? Number(item.changePct) : 0;
            const pctWidth = Math.min(100, (Math.abs(value) / maxAbs) * 100);
            const isUp = value >= 0;
            const clickable = typeof onClick === "function";
            return (
              <button
                key={item.id}
                type="button"
                disabled={!clickable}
                onClick={() => onClick?.(item)}
                className={`w-full text-left rounded px-2 py-1 transition ${
                  clickable
                    ? "hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    : "cursor-default"
                }`}
              >
                <div className="grid grid-cols-[minmax(140px,240px)_1fr_auto] items-center gap-3 text-xs">
                  <span className="truncate text-zinc-700 dark:text-zinc-200">
                    {item.name}
                    {item.meta ? <span className="text-zinc-500 dark:text-zinc-400"> ({item.meta})</span> : null}
                  </span>
                  <div className="relative h-4">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-400/70 dark:bg-zinc-500/70" />
                    <div className="absolute inset-y-0 left-0 right-0 rounded bg-zinc-200 dark:bg-zinc-700/70" />
                    {hasValue ? (
                      <div
                        className={`absolute inset-y-0 rounded ${isUp ? "bg-emerald-500/80" : "bg-red-500/80"}`}
                        style={
                          isUp
                            ? { left: "50%", width: `${pctWidth / 2}%` }
                            : { left: `${50 - pctWidth / 2}%`, width: `${pctWidth / 2}%` }
                        }
                      />
                    ) : null}
                  </div>
                  <span
                    className={`tabular-nums ${
                      hasValue
                        ? isUp
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {fmtPct(item.changePct)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

export default function SectorsIndustriesPage({
  onOpenCollection,
}: {
  onOpenCollection: (target: OpenCollectionTarget) => void;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("day");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sectors-industries?timeframe=${encodeURIComponent(timeframe)}`)
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setPayload(null);
          return;
        }
        setPayload(json);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to load sectors/industries performance");
          setPayload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  const indexItems: BarItem[] = useMemo(
    () =>
      (payload?.indices ?? []).map((x) => ({
        id: x.id,
        name: x.name,
        changePct: x.changePct,
        meta: x.ticker,
      })),
    [payload]
  );
  const sectorItems: BarItem[] = useMemo(
    () =>
      (payload?.sectors ?? []).map((x) => ({
        id: x.id,
        name: x.name,
        changePct: x.changePct,
      })),
    [payload]
  );
  const industryItems: BarItem[] = useMemo(
    () =>
      (payload?.industries ?? []).map((x) => ({
        id: x.id,
        name: x.name,
        changePct: x.changePct,
      })),
    [payload]
  );
  const themeItems: BarItem[] = useMemo(
    () =>
      (payload?.themes ?? []).map((x) => ({
        id: x.id,
        name: x.name,
        changePct: x.changePct,
        meta: x.ticker,
      })),
    [payload]
  );

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-zinc-900 p-4">
      <div className="mb-4 relative flex flex-wrap items-center justify-end gap-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 absolute left-1/2 -translate-x-1/2">
          Sectors / Industries
        </h2>
        <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-1">
          {TIMEFRAME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTimeframe(opt.id)}
              className={`rounded px-2 py-1 text-xs ${
                timeframe === opt.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        EOD weighted performance as of {payload?.date ? formatDisplayDate(payload.date) : "—"}.
      </p>
      {loading ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {!loading && !error && (
        <div className="grid grid-cols-1 gap-3">
          <HorizontalBars
            title="Indices (SPY, QQQ, IWM)"
            items={indexItems}
            onClick={(item) => onOpenCollection({ kind: "index", value: item.id })}
          />
          <HorizontalBars
            title="Sectors (Market-Cap Weighted)"
            items={sectorItems}
            onClick={(item) => onOpenCollection({ kind: "sector", value: item.name })}
          />
          <HorizontalBars
            title="Industries (Market-Cap Weighted)"
            items={industryItems}
            onClick={(item) => onOpenCollection({ kind: "industry", value: item.name })}
          />
          <HorizontalBars
            title="Themes (ETF-Based)"
            items={themeItems}
            onClick={(item) => onOpenCollection({ kind: "theme", value: item.id })}
          />
        </div>
      )}
    </div>
  );
}

