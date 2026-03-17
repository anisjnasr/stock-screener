"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
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
  timeframes?: {
    indices: Timeframe;
    sectors: Timeframe;
    industries: Timeframe;
    themes: Timeframe;
  };
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

function toSentenceCase(input: string): string {
  return String(input)
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function TimeframePills({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-1">
      {TIMEFRAME_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`rounded px-2 py-1 text-xs ${
            value === opt.id
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function HorizontalBars({
  title,
  items,
  timeframe,
  onTimeframeChange,
  centerControl,
  onClick,
}: {
  title: string;
  items: BarItem[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  centerControl?: ReactNode;
  onClick?: (item: BarItem) => void;
}) {
  const [sortMode, setSortMode] = useState<"perf-desc" | "perf-asc" | "alpha-asc" | "alpha-desc">(
    "perf-desc"
  );
  const maxAbs = useMemo(() => {
    const vals = items.map((x) => Math.abs(x.changePct ?? 0));
    return Math.max(1, ...vals);
  }, [items]);
  const maxUp = useMemo(
    () => Math.max(0.0001, ...items.map((x) => (x.changePct != null && x.changePct > 0 ? x.changePct : 0))),
    [items]
  );
  const maxDownAbs = useMemo(
    () =>
      Math.max(
        0.0001,
        ...items.map((x) => (x.changePct != null && x.changePct < 0 ? Math.abs(x.changePct) : 0))
      ),
    [items]
  );
  const sortedItems = useMemo(() => {
    const list = [...items];
    if (sortMode === "alpha-asc") return list.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "alpha-desc") return list.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === "perf-asc") {
      return list.sort((a, b) => (a.changePct ?? Number.POSITIVE_INFINITY) - (b.changePct ?? Number.POSITIVE_INFINITY));
    }
    return list.sort((a, b) => (b.changePct ?? Number.NEGATIVE_INFINITY) - (a.changePct ?? Number.NEGATIVE_INFINITY));
  }, [items, sortMode]);

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent p-3">
      {centerControl ? <div className="mb-2 flex justify-center">{centerControl}</div> : null}
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            setSortMode((prev) =>
              prev === "alpha-asc" ? "alpha-desc" : prev === "alpha-desc" ? "alpha-asc" : "alpha-asc"
            )
          }
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:underline"
          title="Sort alphabetically"
        >
          {title}
        </button>
        <TimeframePills value={timeframe} onChange={onTimeframeChange} />
      </div>
      <div className="mb-1 grid grid-cols-[minmax(220px,420px)_1fr] items-center gap-1">
        <span />
        <div className="relative h-5">
        <button
          type="button"
          onClick={() =>
            setSortMode((prev) =>
              prev === "perf-desc" ? "perf-asc" : prev === "perf-asc" ? "perf-desc" : "perf-desc"
            )
          }
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:underline whitespace-nowrap"
          title="Sort by performance"
        >
          Performance
        </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {sortedItems.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No data</p>
        ) : (
          sortedItems.map((item, idx) => {
            const hasValue = item.changePct != null && Number.isFinite(item.changePct);
            const value = hasValue ? Number(item.changePct) : 0;
            const clickable = typeof onClick === "function";
            return (
              <motion.button
                layout
                key={item.id}
                type="button"
                disabled={!clickable}
                onClick={() => onClick?.(item)}
                transition={{ layout: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
                className={`w-full text-left rounded px-2 py-1 transition ${
                  clickable
                    ? "hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    : "cursor-default"
                }`}
                style={{ transitionDelay: `${Math.min(idx, 20) * 8}ms` }}
              >
                <div className="grid grid-cols-[minmax(220px,420px)_1fr] items-center gap-1 text-xs">
                  <span
                    className="text-zinc-700 dark:text-zinc-200 whitespace-nowrap overflow-x-auto"
                    title={item.name}
                  >
                    {item.name}
                    {item.meta ? <span className="text-zinc-500 dark:text-zinc-400"> ({item.meta})</span> : null}
                  </span>
                  <div className="relative h-5 rounded">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-400/70 dark:bg-zinc-500/70" />
                    {hasValue ? (
                      <>
                        {(() => {
                          const halfSpan = 34;
                          const halfWidth = Math.min(halfSpan, (Math.abs(value) / maxAbs) * halfSpan);
                          const isUpVal = value >= 0;
                          const intensity = Math.min(
                            1,
                            isUpVal ? Math.abs(value) / maxUp : Math.abs(value) / maxDownAbs
                          );
                          // Gradient emphasis is primarily between bars (rank intensity),
                          // with a subtle intra-bar fade for depth.
                          const greenBase = `hsl(158 85% ${30 + intensity * 24}%)`;
                          const greenEdge = `hsl(158 78% ${22 + intensity * 14}%)`;
                          const redBase = `hsl(347 55% ${34 + intensity * 20}%)`;
                          const redEdge = `hsl(347 45% ${24 + intensity * 12}%)`;
                          const barStyle = isUpVal
                            ? {
                                left: "50%",
                                width: `${halfWidth}%`,
                                backgroundImage: `linear-gradient(to right, ${greenEdge}, ${greenBase})`,
                              }
                            : {
                                left: `${50 - halfWidth}%`,
                                width: `${halfWidth}%`,
                                backgroundImage: `linear-gradient(to left, ${redEdge}, ${redBase})`,
                              };
                          const labelStyle: Record<string, string> = isUpVal
                            ? { left: `min(calc(50% + ${halfWidth}% + 6px), calc(100% - 58px))` }
                            : {
                                left: `max(calc(50% - ${halfWidth}% - 6px), 64px)`,
                                transform: "translate(-100%, -50%)",
                              };
                          return (
                            <>
                              <motion.div
                                layout
                                className="absolute inset-y-0 rounded"
                                style={barStyle}
                                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                              />
                              <span
                                className={`absolute tabular-nums text-[13px] leading-none whitespace-nowrap pointer-events-none ${
                                  isUpVal ? "text-emerald-400" : "text-rose-300"
                                }`}
                                style={{
                                  ...labelStyle,
                                  top: "50%",
                                  transform: labelStyle.transform ?? "translateY(-50%)",
                                }}
                              >
                                {fmtPct(item.changePct)}
                              </span>
                            </>
                          );
                        })()}
                      </>
                    ) : null}
                  </div>
                </div>
              </motion.button>
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
  const [indicesTimeframe, setIndicesTimeframe] = useState<Timeframe>("day");
  const [sectorsTimeframe, setSectorsTimeframe] = useState<Timeframe>("day");
  const [industriesTimeframe, setIndustriesTimeframe] = useState<Timeframe>("day");
  const [themesTimeframe, setThemesTimeframe] = useState<Timeframe>("day");
  const [rightTab, setRightTab] = useState<"industries" | "themes">("industries");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (payload) setRefreshing(true);
    else setLoading(true);
    setError(null);
    fetch(
      `/api/sectors-industries?indicesTimeframe=${encodeURIComponent(indicesTimeframe)}&sectorsTimeframe=${encodeURIComponent(sectorsTimeframe)}&industriesTimeframe=${encodeURIComponent(industriesTimeframe)}&themesTimeframe=${encodeURIComponent(themesTimeframe)}`
    )
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
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [indicesTimeframe, sectorsTimeframe, industriesTimeframe, themesTimeframe]);

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
        name: toSentenceCase(x.name),
        changePct: x.changePct,
      })),
    [payload]
  );
  const themeItems: BarItem[] = useMemo(
    () =>
      (payload?.themes ?? []).map((x) => ({
        id: x.id,
        name: toSentenceCase(x.name),
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
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        As of: {payload?.date ? formatDisplayDate(payload.date) : "—"}.
      </p>
      {refreshing && (
        <div className="mb-3 overflow-hidden rounded border border-zinc-200 dark:border-zinc-700 h-1.5">
          <div className="h-full w-full animate-pulse bg-gradient-to-r from-transparent via-emerald-500/70 to-transparent" />
        </div>
      )}
      {loading ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {!loading && !error && (
        <div className={`grid grid-cols-1 xl:grid-cols-2 gap-3 transition-opacity duration-300 ${refreshing ? "opacity-80" : "opacity-100"}`}>
          <div className="space-y-3">
            <HorizontalBars
              title="Indices"
              items={indexItems}
              timeframe={indicesTimeframe}
              onTimeframeChange={(tf) => {
                setIndicesTimeframe(tf);
              }}
              onClick={(item) => onOpenCollection({ kind: "index", value: item.id })}
            />
            <HorizontalBars
              title="Sectors"
              items={sectorItems}
              timeframe={sectorsTimeframe}
              onTimeframeChange={(tf) => {
                setSectorsTimeframe(tf);
              }}
              onClick={(item) => onOpenCollection({ kind: "sector", value: item.name })}
            />
          </div>
          <div>
            {rightTab === "industries" ? (
              <HorizontalBars
                title="Industries"
                items={industryItems}
                timeframe={industriesTimeframe}
                onTimeframeChange={(tf) => {
                  setIndustriesTimeframe(tf);
                }}
                centerControl={
                  <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-1">
                    <button
                      type="button"
                      onClick={() => setRightTab("industries")}
                      className={`rounded px-2 py-1 text-xs ${
                        rightTab === "industries"
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Industries
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightTab("themes")}
                      className={`rounded px-2 py-1 text-xs ${
                        rightTab === "themes"
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Thematic ETFs
                    </button>
                  </div>
                }
                onClick={(item) => onOpenCollection({ kind: "industry", value: item.name })}
              />
            ) : (
              <HorizontalBars
                title="Thematic ETFs"
                items={themeItems}
                timeframe={themesTimeframe}
                onTimeframeChange={(tf) => {
                  setThemesTimeframe(tf);
                }}
                centerControl={
                  <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-1">
                    <button
                      type="button"
                      onClick={() => setRightTab("industries")}
                      className={`rounded px-2 py-1 text-xs ${
                        rightTab === "industries"
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Industries
                    </button>
                    <button
                      type="button"
                      onClick={() => setRightTab("themes")}
                      className={`rounded px-2 py-1 text-xs ${
                        rightTab === "themes"
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Thematic ETFs
                    </button>
                  </div>
                }
                onClick={(item) => onOpenCollection({ kind: "theme", value: item.id })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

