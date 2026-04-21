"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { GapperRow, GappersRequestBody, GappersResponse } from "@/types/gappers";
import {
  GAPPER_CAP_PRESET_MC,
  gapperFilterStateToRequestBody,
  type GapperCapPreset,
  type GapperFilterState,
  saveGapperFiltersToStorage,
} from "@/components/premarket/gapper-filters-storage";
import {
  abbreviateUsdFilterDisplay,
  formatScreenerCompact,
  formatUsdIntInputDisplay,
  parseFlexibleFilterNumber,
} from "@/components/premarket/premarket-number-display";

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function numIn(v: string, fallback: number): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

type GapperSortKey = "ticker" | "companyName" | "gapPct" | "lastPrice" | "pmVolume" | "avgVolume90d" | "marketCap" | "sector";
type SortDir = "asc" | "desc";

function defaultSortDir(key: GapperSortKey): SortDir {
  return key === "ticker" || key === "companyName" || key === "sector" ? "asc" : "desc";
}

function cmpNum(a: number | null, b: number | null, asc: boolean): number {
  const aOk = a != null && Number.isFinite(a);
  const bOk = b != null && Number.isFinite(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return asc ? a - b : b - a;
}

function cmpStr(a: string | null, b: string | null, asc: boolean): number {
  const as = (a ?? "").toLowerCase();
  const bs = (b ?? "").toLowerCase();
  const c = as.localeCompare(bs);
  return asc ? c : -c;
}

function compareGapperRows(a: GapperRow, b: GapperRow, key: GapperSortKey, asc: boolean): number {
  switch (key) {
    case "ticker":
      return cmpStr(a.ticker, b.ticker, asc);
    case "companyName":
      return cmpStr(a.companyName, b.companyName, asc);
    case "gapPct":
      return asc ? a.gapPct - b.gapPct : b.gapPct - a.gapPct;
    case "lastPrice":
      return asc ? a.lastPrice - b.lastPrice : b.lastPrice - a.lastPrice;
    case "pmVolume":
      return asc ? a.pmVolume - b.pmVolume : b.pmVolume - a.pmVolume;
    case "avgVolume90d":
      return cmpNum(a.avgVolume90d, b.avgVolume90d, asc);
    case "marketCap":
      return cmpNum(a.marketCap, b.marketCap, asc);
    case "sector":
      return cmpStr(a.sector, b.sector, asc);
    default:
      return 0;
  }
}

function SortChevrons({ activeAsc, activeDesc }: { activeAsc: boolean; activeDesc: boolean }) {
  const dim = "var(--ws-text-vdim)";
  const hi = "var(--ws-text)";
  return (
    <span className="ml-0.5 inline-flex shrink-0 flex-col items-center justify-center leading-[0.65]" aria-hidden>
      <span style={{ fontSize: "7px", color: activeAsc ? hi : dim }}>▲</span>
      <span style={{ fontSize: "7px", color: activeDesc ? hi : dim }}>▼</span>
    </span>
  );
}

function GapperSortTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align,
}: {
  label: ReactNode;
  col: GapperSortKey;
  sortKey: GapperSortKey;
  sortDir: SortDir;
  onSort: (k: GapperSortKey) => void;
  align: "left" | "right";
}) {
  const active = sortKey === col;
  return (
    <th
      scope="col"
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-1.5 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
      style={{ color: "var(--ws-text-dim)" }}
      onClick={() => onSort(col)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(col);
        }
      }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span
        className={`inline-flex w-full items-center gap-0.5 ${align === "right" ? "justify-end" : "justify-start"}`}
      >
        <span>{label}</span>
        <SortChevrons activeAsc={active && sortDir === "asc"} activeDesc={active && sortDir === "desc"} />
      </span>
    </th>
  );
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
  const [sortKey, setSortKey] = useState<GapperSortKey>("gapPct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  /** Local string while editing large-number filters; `null` = show abbreviated/blurred display. */
  const [mcapMinDraft, setMcapMinDraft] = useState<string | null>(null);
  const [mcapMaxDraft, setMcapMaxDraft] = useState<string | null>(null);
  const [minAvgVolDraft, setMinAvgVolDraft] = useState<string | null>(null);

  const clearLargeNumberDrafts = useCallback(() => {
    setMcapMinDraft(null);
    setMcapMaxDraft(null);
    setMinAvgVolDraft(null);
  }, []);

  const onSortHeaderClick = useCallback((key: GapperSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultSortDir(key));
    }
  }, [sortKey]);

  const sortedRows = useMemo(() => {
    if (!rows?.length) return rows;
    const asc = sortDir === "asc";
    return [...rows].sort((a, b) => compareGapperRows(a, b, sortKey, asc));
  }, [rows, sortKey, sortDir]);

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
    clearLargeNumberDrafts();
    saveGapperFiltersToStorage(filters);
    void run(filters);
  };

  function applyPreset(p: Exclude<GapperCapPreset, "custom">) {
    clearLargeNumberDrafts();
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

  const inputClsBase =
    "min-w-0 rounded border px-2 py-1 text-right tabular-nums outline-none ws-focus-ring bg-[color:var(--ws-bg)] text-[var(--ws-text)]";
  const inputCls = `w-full ${inputClsBase} max-w-[7.5rem] sm:max-w-[7.5rem]`;
  const inputClsNarrow = `w-full ${inputClsBase} max-w-[4.25rem] sm:max-w-[4.25rem]`;
  const filterLabelCls = "flex min-w-0 flex-col items-end gap-0.5";
  const filterLabelSpanCls =
    "block w-full text-right text-[10px] font-medium uppercase tracking-wide";

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-snug" style={{ color: "var(--ws-text-dim)" }}>
        Market cap values are full USD (not millions). Optional TV cookies:{" "}
        <code className="rounded bg-[color:var(--ws-bg)] px-0.5">TRADINGVIEW_SESSIONID</code>,{" "}
        <code className="rounded bg-[color:var(--ws-bg)] px-0.5">TRADINGVIEW_SESSIONID_SIGN</code> on the server.
      </p>

      <div className="flex flex-wrap items-end gap-2 gap-y-2">
        <label className={`${filterLabelCls} min-w-[5.5rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
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
            className={`${inputCls} text-right`}
            style={{ borderColor: "var(--ws-border)" }}
          >
            <option value="all">All (min $100M)</option>
            <option value="mid">Mid ($2B–$10B)</option>
            <option value="large">Large ($10B–$200B)</option>
            <option value="mega">Mega ($200B+)</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className={`${filterLabelCls} min-w-[5.5rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
            Min mcap USD
          </span>
          <input
            type="text"
            inputMode="numeric"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={mcapMinDraft ?? abbreviateUsdFilterDisplay(filters.minMarketCap ?? 0)}
            onFocus={() => setMcapMinDraft(formatUsdIntInputDisplay(filters.minMarketCap))}
            onChange={(e) => setMcapMinDraft(e.target.value)}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              setMcapMinDraft(null);
              const p = parseFlexibleFilterNumber(raw);
              if (p == null) return;
              setFilters((prev) => ({
                ...prev,
                minMarketCap: Math.min(p, prev.maxMarketCap ?? 10_000_000_000_000),
                capPreset: "custom",
              }));
            }}
          />
        </label>
        <label className={`${filterLabelCls} min-w-[5.5rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
            Max mcap USD
          </span>
          <input
            type="text"
            inputMode="numeric"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={mcapMaxDraft ?? abbreviateUsdFilterDisplay(filters.maxMarketCap ?? 0)}
            onFocus={() => setMcapMaxDraft(formatUsdIntInputDisplay(filters.maxMarketCap))}
            onChange={(e) => setMcapMaxDraft(e.target.value)}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              setMcapMaxDraft(null);
              const p = parseFlexibleFilterNumber(raw);
              if (p == null) return;
              setFilters((prev) => ({
                ...prev,
                maxMarketCap: Math.max(p, prev.minMarketCap ?? 100_000_000),
                capPreset: "custom",
              }));
            }}
          />
        </label>
        <label className={`${filterLabelCls} min-w-[3.25rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
            Min price
          </span>
          <input
            type="number"
            className={inputClsNarrow}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.minPrice}
            onChange={(e) => setCustomField("minPrice", numIn(e.target.value, 5))}
          />
        </label>
        <label className={`${filterLabelCls} min-w-[3.25rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
            Min gap %
          </span>
          <input
            type="number"
            className={inputClsNarrow}
            style={{ borderColor: "var(--ws-border)" }}
            value={filters.minGapPct}
            onChange={(e) => setCustomField("minGapPct", numIn(e.target.value, 1))}
          />
        </label>
        <label className={`${filterLabelCls} min-w-[4rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
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
        <label className={`${filterLabelCls} min-w-[5rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
            Min avg vol
          </span>
          <input
            type="text"
            inputMode="numeric"
            className={inputCls}
            style={{ borderColor: "var(--ws-border)" }}
            value={minAvgVolDraft ?? abbreviateUsdFilterDisplay(filters.minAvgVolume ?? 0)}
            onFocus={() => setMinAvgVolDraft(formatUsdIntInputDisplay(filters.minAvgVolume))}
            onChange={(e) => setMinAvgVolDraft(e.target.value)}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              setMinAvgVolDraft(null);
              const p = parseFlexibleFilterNumber(raw);
              if (p == null) return;
              setCustomField("minAvgVolume", Math.max(0, Math.round(p)));
            }}
          />
        </label>
        <label className={`${filterLabelCls} min-w-[3.25rem]`}>
          <span className={filterLabelSpanCls} style={{ color: "var(--ws-text-dim)" }}>
            Max rows
          </span>
          <input
            type="number"
            className={inputClsNarrow}
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
          onClick={() => {
            clearLargeNumberDrafts();
            void run(filters);
          }}
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

      {sortedRows && sortedRows.length > 0 ? (
        <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--ws-border)" }}>
          <table className="w-full min-w-[36rem] border-collapse text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}>
                <th
                  className="w-8 px-1 py-1.5 text-center font-semibold"
                  style={{ color: "var(--ws-text-dim)" }}
                  aria-label="Earnings"
                />
                <GapperSortTh
                  label="Ticker"
                  col="ticker"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="left"
                />
                <GapperSortTh
                  label="Company"
                  col="companyName"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="left"
                />
                <GapperSortTh
                  label="Gap"
                  col="gapPct"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="right"
                />
                <GapperSortTh
                  label="Last"
                  col="lastPrice"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="right"
                />
                <GapperSortTh
                  label="PM Vol"
                  col="pmVolume"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="right"
                />
                <GapperSortTh
                  label="Avg Vol (3M)"
                  col="avgVolume90d"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="right"
                />
                <GapperSortTh
                  label="Mkt Cap"
                  col="marketCap"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="right"
                />
                <GapperSortTh
                  label="Sector"
                  col="sector"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSortHeaderClick}
                  align="left"
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
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
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-left font-mono font-semibold"
                    style={{ color: "var(--ws-text)" }}
                  >
                    {r.ticker}
                  </td>
                  <td className="max-w-[12rem] truncate px-2 py-1.5 text-left" style={{ color: "var(--ws-text-dim)" }}>
                    {r.companyName ?? "—"}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                    style={{ color: r.gapPct >= 0 ? "#5bbd6e" : "#e05a5a" }}
                  >
                    {fmtPct(r.gapPct)}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                    style={{ color: "var(--ws-text)" }}
                  >
                    {r.lastPrice.toFixed(2)}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                    style={{ color: "var(--ws-text-dim)" }}
                  >
                    {formatScreenerCompact(r.pmVolume)}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                    style={{ color: "var(--ws-text-dim)" }}
                  >
                    {formatScreenerCompact(r.avgVolume90d)}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums"
                    style={{ color: "var(--ws-text-dim)" }}
                  >
                    {formatScreenerCompact(r.marketCap)}
                  </td>
                  <td className="max-w-[8rem] truncate px-2 py-1.5 text-left" style={{ color: "var(--ws-text-dim)" }}>
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
