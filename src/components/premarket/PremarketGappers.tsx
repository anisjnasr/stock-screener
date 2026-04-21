"use client";

import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { GapperRow, GappersRequestBody, GappersResponse } from "@/types/gappers";
import {
  GAPPER_CAP_PRESET_MC,
  gapperFilterStateToRequestBody,
  type GapperCapPreset,
  type GapperFilterState,
  saveGapperFiltersToStorage,
} from "@/components/premarket/gapper-filters-storage";

function fmtCompact(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const x = Math.abs(n);
  if (x >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function numIn(v: string, fallback: number): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

type PremarketGappersProps = {
  onJumpToEarnings?: () => void;
  filters: GapperFilterState;
  setFilters: Dispatch<SetStateAction<GapperFilterState>>;
  /** After parent hydrates gapper filters from localStorage, child runs one initial TV fetch. */
  filtersHydrated: boolean;
};

export default function PremarketGappers({
  onJumpToEarnings,
  filters,
  setFilters,
  filtersHydrated,
}: PremarketGappersProps) {
  const [rows, setRows] = useState<GapperRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const initialFetchDone = useRef(false);

  const run = useCallback(async (f: GapperFilterState) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/movers/gappers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(gapperFilterStateToRequestBody(f)),
        cache: "no-store",
      });
      const json = (await res.json()) as GappersResponse & { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setRows(null);
        setError(json.error ?? res.statusText);
        return;
      }
      setRows(json.rows);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (!filtersHydrated || initialFetchDone.current) return;
    initialFetchDone.current = true;
    void run(filters);
  }, [filtersHydrated, filters, run]);

  const applyFilters = () => {
    saveGapperFiltersToStorage(filters);
    void run(filters);
  };

  function applyPreset(p: Exclude<GapperCapPreset, "custom">) {
    const { min, max } = GAPPER_CAP_PRESET_MC[p];
    setFilters((prev) => {
      const next = { ...prev, capPreset: p, minMarketCap: min, maxMarketCap: max };
      saveGapperFiltersToStorage(next);
      queueMicrotask(() => run(next));
      return next;
    });
  }

  function setCustomField<K extends keyof GappersRequestBody>(key: K, value: number) {
    setFilters((prev) => ({ ...prev, [key]: value, capPreset: "custom" }));
  }

  const inputCls =
    "w-full min-w-0 rounded border px-2 py-1 tabular-nums outline-none ws-focus-ring sm:max-w-[7.5rem]" +
    " bg-[color:var(--ws-bg)] text-[var(--ws-text)]";

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-snug" style={{ color: "var(--ws-text-dim)" }}>
        Market cap values are full USD (not millions). Optional TV cookies:{" "}
        <code className="rounded bg-[color:var(--ws-bg)] px-0.5">TRADINGVIEW_SESSIONID</code>,{" "}
        <code className="rounded bg-[color:var(--ws-bg)] px-0.5">TRADINGVIEW_SESSIONID_SIGN</code> on the server.
      </p>

      <div className="flex flex-wrap items-end gap-2 gap-y-2">
        <label className="flex min-w-[5.5rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Cap preset
          </span>
          <select
            value={filters.capPreset === "custom" ? "custom" : filters.capPreset}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") {
                setFilters((p) => ({ ...p, capPreset: "custom" }));
                return;
              }
              applyPreset(v as Exclude<GapperCapPreset, "custom">);
            }}
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
          >
            <option value="all">All (min $100M)</option>
            <option value="mid">Mid ($2B–$10B)</option>
            <option value="large">Large ($10B–$200B)</option>
            <option value="mega">Mega ($200B+)</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="flex min-w-[6rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Min mcap USD
          </span>
          <input
            type="number"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.minMarketCap}
            onChange={(e) => setCustomField("minMarketCap", numIn(e.target.value, 100_000_000))}
          />
        </label>
        <label className="flex min-w-[6rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Max mcap USD
          </span>
          <input
            type="number"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.maxMarketCap}
            onChange={(e) => setCustomField("maxMarketCap", numIn(e.target.value, 10_000_000_000_000))}
          />
        </label>
        <label className="flex min-w-[3.5rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Min price
          </span>
          <input
            type="number"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.minPrice}
            onChange={(e) => setCustomField("minPrice", numIn(e.target.value, 5))}
          />
        </label>
        <label className="flex min-w-[3.5rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Min gap %
          </span>
          <input
            type="number"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.minGapPct}
            onChange={(e) => setCustomField("minGapPct", numIn(e.target.value, 1))}
          />
        </label>
        <label className="flex min-w-[4rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Min PM vol
          </span>
          <input
            type="number"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.minPmVolume}
            onChange={(e) => setCustomField("minPmVolume", numIn(e.target.value, 0))}
          />
        </label>
        <label className="flex min-w-[4rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Min avg vol
          </span>
          <input
            type="number"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.minAvgVolume}
            onChange={(e) => setCustomField("minAvgVolume", numIn(e.target.value, 0))}
          />
        </label>
        <label className="flex min-w-[3.5rem] flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Max rows
          </span>
          <input
            type="number"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.maxRows}
            onChange={(e) => setCustomField("maxRows", Math.min(150, Math.max(1, numIn(e.target.value, 50))))}
          />
        </label>
        <button
          type="button"
          onClick={applyFilters}
          disabled={loading}
          className="rounded border px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)] disabled:opacity-50"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={() => void run(filters)}
          disabled={loading}
          className="rounded border px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)] disabled:opacity-50"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div
          className="rounded border px-3 py-2.5 text-sm leading-relaxed"
          role="alert"
          style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)" }}
        >
          <p className="font-semibold" style={{ color: "var(--ws-text)" }}>
            TradingView screener failed
          </p>
          <p className="mt-1" style={{ color: "var(--ws-text-dim)" }}>
            {error}
          </p>
        </div>
      ) : null}

      {!error && rows && rows.length === 0 && !loading ? (
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>
          No rows match these filters (or market is closed / no pre-market data).
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--ws-border)" }}>
          <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}>
                {["", "Ticker", "Company", "Gap", "Last", "PM vol", "Avg 90d", "M cap", "Sector"].map((h) => (
                  <th key={h || "earn"} className="px-2 py-1.5 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.ticker}
                  className="border-t transition-colors hover:bg-[color:var(--ws-hover)]"
                  style={{
                    borderColor: "var(--ws-border)",
                    boxShadow: r.earningsRecent24h ? "inset 3px 0 0 0 #9d6fd4" : undefined,
                  }}
                >
                  <td className="px-1 py-1 align-middle text-center">
                    {r.earningsRecent24h ? (
                      <button
                        type="button"
                        title="Earnings in last 24h — open Earnings section"
                        onClick={() => onJumpToEarnings?.()}
                        className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border text-[10px] font-bold uppercase tracking-tight ws-focus-ring"
                        style={{
                          borderColor: "var(--ws-border)",
                          color: "#c4a7e7",
                          background: "var(--ws-bg)",
                        }}
                      >
                        E
                      </button>
                    ) : (
                      <span className="inline-block w-6" aria-hidden />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono font-semibold" style={{ color: "var(--ws-text)" }}>
                    {r.ticker}
                  </td>
                  <td className="max-w-[12rem] truncate px-2 py-1.5" style={{ color: "var(--ws-text-dim)" }}>
                    {r.companyName ?? "—"}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums"
                    style={{ color: r.gapPct >= 0 ? "#5bbd6e" : "#e05a5a" }}
                  >
                    {fmtPct(r.gapPct)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums" style={{ color: "var(--ws-text)" }}>
                    {r.lastPrice.toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                    {fmtCompact(r.pmVolume)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                    {fmtCompact(r.avgVolume90d)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
                    {fmtCompact(r.marketCap)}
                  </td>
                  <td className="max-w-[8rem] truncate px-2 py-1.5" style={{ color: "var(--ws-text-dim)" }}>
                    {r.sector ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {loading && !rows?.length ? (
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>
          Loading gappers…
        </p>
      ) : null}
    </div>
  );
}
