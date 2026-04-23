"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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

const GAPPER_SCAN_INFO =
  "Market cap values are full USD (not millions). Optional TV cookies: TRADINGVIEW_SESSIONID, TRADINGVIEW_SESSIONID_SIGN on the server.";

/** Parse a plain decimal from a filter field on blur; empty = cancel edit (revert). */
function parseDecimalBlur(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
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
      <span style={{ fontSize: "var(--fs-75)", color: activeAsc ? hi : dim }}>▲</span>
      <span style={{ fontSize: "var(--fs-75)", color: activeDesc ? hi : dim }}>▼</span>
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
  onOpenTickerInLists?: (sym: string) => void;
  onJumpToEarnings?: () => void;
  filters: GapperFilterState;
  setFilters: Dispatch<SetStateAction<GapperFilterState>>;
  /** After parent hydrates gapper filters from localStorage, child runs one initial TV fetch. */
  filtersHydrated: boolean;
};

export default function PremarketGappers({
  onOpenTickerInLists,
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
  /** Draft strings for numeric filters so the user can clear the field while typing (controlled `type="number"` cannot). */
  const [minPriceDraft, setMinPriceDraft] = useState<string | null>(null);
  const [minGapDraft, setMinGapDraft] = useState<string | null>(null);
  const [minPmVolDraft, setMinPmVolDraft] = useState<string | null>(null);
  /** Wall time of the last completed `run()` (success or error), in seconds. */
  const [lastRefreshSeconds, setLastRefreshSeconds] = useState<number | null>(null);
  /** Row count from last successful scan (updates on Apply + Refresh). */
  const [resultsCount, setResultsCount] = useState<number | null>(null);

  const clearFilterInputDrafts = useCallback(() => {
    setMcapMinDraft(null);
    setMcapMaxDraft(null);
    setMinAvgVolDraft(null);
    setMinPriceDraft(null);
    setMinGapDraft(null);
    setMinPmVolDraft(null);
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
    const t0 = performance.now();
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
        setResultsCount(null);
        setError(json.error ?? res.statusText);
        return;
      }
      setRows(json.rows);
      setResultsCount(json.rows?.length ?? 0);
    } catch (e) {
      setRows(null);
      setResultsCount(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setLastRefreshSeconds((performance.now() - t0) / 1000);
    }
  }, []);

  useLayoutEffect(() => {
    if (!filtersHydrated || initialFetchDone.current) return;
    initialFetchDone.current = true;
    void run(filters);
  }, [filtersHydrated, filters, run]);

  const applyFilters = () => {
    clearFilterInputDrafts();
    saveGapperFiltersToStorage(filters);
    void run(filters);
  };

  function applyPreset(p: Exclude<GapperCapPreset, "custom">) {
    clearFilterInputDrafts();
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

  const gapFilterLabelStyle: CSSProperties = {
    fontFamily: "var(--font-premarket-barlow), sans-serif",
    fontSize: "var(--fs-10)",
    fontWeight: 500,
    letterSpacing: "0.8px",
    textTransform: "uppercase",
    color: "#8a8a8a",
    whiteSpace: "nowrap",
  };
  const gapFilterInputStyle: CSSProperties = {
    height: 30,
    padding: "5px 9px",
    fontFamily: "var(--font-premarket-mono), monospace",
    fontSize: "var(--fs-11)",
    background: "#1c1c1c",
    border: "1px solid #333",
    borderRadius: 3,
    color: "#e5e5e5",
    boxSizing: "border-box",
  };

  return (
    <div
      className="rounded border"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
    >
      <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums" style={{ color: "var(--ws-text-dim)", fontSize: "var(--fs-10)" }}>
          Results: {resultsCount === null ? "—" : resultsCount}
        </span>
        <button
          type="button"
          className="ws-focus-ring rounded px-0.5 leading-none"
          style={{ color: "var(--ws-text-dim)", fontSize: "var(--fs-12)", background: "none", border: "none", cursor: "help" }}
          title={GAPPER_SCAN_INFO}
          aria-label={GAPPER_SCAN_INFO}
        >
          ⓘ
        </button>
      </div>

      <div
        className="flex flex-wrap items-center gap-[14px] px-[14px] py-[10px]"
        style={{ alignItems: "center", fontFamily: "var(--font-premarket-barlow), sans-serif" }}
      >
        <div className="flex items-center gap-1.5">
          <span style={gapFilterLabelStyle}>Preset</span>
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
            className="tabular-nums outline-none ws-focus-ring focus:border-[#3BBFCF]"
            style={{ ...gapFilterInputStyle, width: 110 }}
          >
            <option value="all">All (min $100M)</option>
            <option value="mid">Mid ($2B–$10B)</option>
            <option value="large">Large ($10B–$200B)</option>
            <option value="mega">Mega ($200B+)</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div className="h-5 w-px shrink-0 bg-[#333]" aria-hidden />

        <div className="flex items-center gap-1.5">
          <span style={gapFilterLabelStyle}>MCap</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
            style={{ ...gapFilterInputStyle, width: 60 }}
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
          <span style={{ color: "#8a8a8a", fontSize: "var(--fs-11)" }}>–</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
            style={{ ...gapFilterInputStyle, width: 60 }}
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
        </div>

        <div className="flex items-center gap-1.5">
          <span style={gapFilterLabelStyle}>Price ≥</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
            style={{ ...gapFilterInputStyle, width: 50 }}
            value={minPriceDraft === null ? String(filters.minPrice) : minPriceDraft}
            onFocus={() => setMinPriceDraft(String(filters.minPrice))}
            onChange={(e) => setMinPriceDraft(e.target.value)}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              setMinPriceDraft(null);
              const p = parseDecimalBlur(raw);
              if (p == null) return;
              setCustomField("minPrice", Math.max(0.01, p));
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span style={gapFilterLabelStyle}>Gap % ≥</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
            style={{ ...gapFilterInputStyle, width: 50 }}
            value={minGapDraft === null ? String(filters.minGapPct) : minGapDraft}
            onFocus={() => setMinGapDraft(String(filters.minGapPct))}
            onChange={(e) => setMinGapDraft(e.target.value)}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              setMinGapDraft(null);
              const p = parseDecimalBlur(raw);
              if (p == null) return;
              setCustomField("minGapPct", Math.max(0, p));
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span style={gapFilterLabelStyle}>PM Vol ≥</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
            style={{ ...gapFilterInputStyle, width: 60 }}
            value={minPmVolDraft === null ? String(filters.minPmVolume) : minPmVolDraft}
            onFocus={() => setMinPmVolDraft(String(filters.minPmVolume))}
            onChange={(e) => setMinPmVolDraft(e.target.value)}
            onBlur={(e) => {
              const raw = e.currentTarget.value;
              setMinPmVolDraft(null);
              const p = parseDecimalBlur(raw);
              if (p == null) return;
              setCustomField("minPmVolume", Math.max(0, Math.round(p)));
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span style={gapFilterLabelStyle}>Avg Vol ≥</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="text-right outline-none ws-focus-ring focus:border-[#3BBFCF]"
            style={{ ...gapFilterInputStyle, width: 60 }}
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
        </div>

        <div className="min-w-2 flex-1" aria-hidden />

        <button
          type="button"
          onClick={applyFilters}
          disabled={loading}
          className="shrink-0 rounded font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:opacity-90 disabled:opacity-50"
          style={{
            height: 30,
            padding: "4px 12px",
            fontSize: "var(--fs-8)",
            border: "1px solid var(--ws-cyan)",
            color: "var(--ws-cyan)",
            background: "rgba(59, 191, 207, 0.08)",
          }}
        >
          Apply
        </button>

        <button
          type="button"
          onClick={() => {
            clearFilterInputDrafts();
            void run(filters);
          }}
          disabled={loading}
          className="shrink-0 rounded font-medium transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)] disabled:opacity-50"
          style={{
            height: 30,
            padding: "4px 12px",
            fontSize: "var(--fs-12)",
            lineHeight: 1,
            border: "1px solid var(--ws-border)",
            color: "var(--ws-text-dim)",
            background: "var(--ws-bg)",
          }}
          title="Refresh scan"
          aria-label="Refresh scan"
        >
          ↻
        </button>

        {lastRefreshSeconds != null ? (
          <span
            className="shrink-0 tabular-nums"
            style={{
              fontFamily: "var(--font-premarket-mono), monospace",
              fontSize: "var(--fs-10)",
              color: "#8a8a8a",
            }}
            title="Duration of the last gappers / TradingView request"
          >
            {lastRefreshSeconds.toFixed(2)}s
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          className="rounded border px-3 py-2.5 leading-relaxed"
          role="alert"
          style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)", fontSize: "var(--fs-11)" }}
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
        <p style={{ color: "var(--ws-text-dim)", fontSize: "var(--fs-11)" }}>
          No rows match these filters (or market is closed / no pre-market data).
        </p>
      ) : null}

      {sortedRows && sortedRows.length > 0 ? (
        <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--ws-border)" }}>
          <table className="w-full min-w-[36rem] border-collapse" style={{ fontSize: "var(--fs-10)" }}>
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
                        className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded border font-bold uppercase tracking-tight ws-focus-ring"
                        style={{
                          fontSize: "var(--fs-8)",
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
                  <td className="whitespace-nowrap px-2 py-1.5 text-left font-mono font-semibold">
                    {onOpenTickerInLists ? (
                      <button
                        type="button"
                        className="ws-focus-ring rounded underline-offset-2 hover:underline"
                        style={{ color: "var(--ws-text)", font: "inherit", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        onClick={() => onOpenTickerInLists(r.ticker)}
                      >
                        {r.ticker}
                      </button>
                    ) : (
                      <span style={{ color: "var(--ws-text)" }}>{r.ticker}</span>
                    )}
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
        <p style={{ color: "var(--ws-text-dim)", fontSize: "var(--fs-11)" }}>
          Loading gappers…
        </p>
      ) : null}
      </div>
    </div>
  );
}
