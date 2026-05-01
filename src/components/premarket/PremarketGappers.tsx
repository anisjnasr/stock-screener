"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { GapperRow, GappersResponse } from "@/types/gappers";
import type { SipCatalyst } from "@/types/sip-catalyst";
import type { SipPersistVariant } from "@/lib/premarket/sip-daily-persistence";
import type { PythonNewsItem } from "@/lib/python-service";
import { truncateSipRationale } from "@/lib/premarket/sip-rationale-truncate";
import {
  gapperFilterStateToRequestBody,
  loadSavedGapperFilterPresetsFromStorage,
  saveSavedGapperFilterPresetsToStorage,
  type GapperFilterState,
  type SavedGapperFilterPreset,
  saveGapperFiltersToStorage,
} from "@/components/premarket/gapper-filters-storage";
import GapperFilterControls, { type GapperFilterControlsRef } from "@/components/premarket/GapperFilterControls";
import { formatScreenerCompact } from "@/components/premarket/premarket-number-display";

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtVolPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function parseClientNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function parseEtHmToMinutes(raw: string | undefined, fallbackMinutes: number): number {
  if (!raw) return fallbackMinutes;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallbackMinutes;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallbackMinutes;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallbackMinutes;
  return hour * 60 + minute;
}

const ET_PREMARKET_START_MINUTES = parseEtHmToMinutes(process.env.NEXT_PUBLIC_PREMARKET_ET_START_HHMM, 4 * 60);
const ET_PREMARKET_END_MINUTES = parseEtHmToMinutes(process.env.NEXT_PUBLIC_PREMARKET_ET_END_HHMM, 9 * 60 + 30);
const PREMARKET_AUTO_REFRESH_MS =
  Math.max(15, parseClientNonNegativeInt(process.env.NEXT_PUBLIC_PREMARKET_AUTO_REFRESH_SECONDS, 60)) * 1000;

function isEtPremarketWindow(now: Date = new Date()): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = dayMap[weekdayShort] ?? -1;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || weekday < 1 || weekday > 5) return false;
  const minutes = hour * 60 + minute;
  return minutes >= ET_PREMARKET_START_MINUTES && minutes < ET_PREMARKET_END_MINUTES;
}

type GapperSortKey = "ticker" | "companyName" | "gapPct" | "lastPrice" | "pmVolume" | "volPct" | "marketCap" | "sector";
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

function makePresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    case "volPct":
      return cmpNum(a.volPct, b.volPct, asc);
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
      <span style={{ fontSize: "10px", color: activeAsc ? hi : dim }}>▲</span>
      <span style={{ fontSize: "10px", color: activeDesc ? hi : dim }}>▼</span>
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
      className={`pm-sip-col-head cursor-pointer select-none whitespace-nowrap px-2 py-1.5 ${align === "right" ? "text-right" : "text-left"}`}
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
  onAddToSip?: (target: SipPersistVariant, payload: { row: GapperRow; headlines: PythonNewsItem[]; catalyst: SipCatalyst | null }) => void;
  sipMembershipByTicker?: Record<string, { large: boolean; small: boolean }>;
  filters: GapperFilterState;
  setFilters: Dispatch<SetStateAction<GapperFilterState>>;
  /** After parent hydrates gapper filters from localStorage, child runs one initial TV fetch. */
  filtersHydrated: boolean;
};

export default function PremarketGappers({
  onOpenTickerInLists,
  onJumpToEarnings,
  onAddToSip,
  sipMembershipByTicker,
  filters,
  setFilters,
  filtersHydrated,
}: PremarketGappersProps) {
  const [rows, setRows] = useState<GapperRow[] | null>(null);
  const [news, setNews] = useState<Record<string, PythonNewsItem[]> | null>(null);
  const [pythonConfigured, setPythonConfigured] = useState(false);
  const [newsSearched, setNewsSearched] = useState(filters.includeNews !== false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [catalystByTicker, setCatalystByTicker] = useState<Record<string, SipCatalyst>>({});
  const [catalystLoadingByTicker, setCatalystLoadingByTicker] = useState<Record<string, boolean>>({});
  const [catalystErrorByTicker, setCatalystErrorByTicker] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const initialFetchDone = useRef(false);
  const [sortKey, setSortKey] = useState<GapperSortKey>("gapPct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  /** Wall time of the last completed `run()` (success or error), in seconds. */
  const [lastRefreshSeconds, setLastRefreshSeconds] = useState<number | null>(null);
  /** Row count from last successful scan (updates on Apply + Refresh). */
  const [resultsCount, setResultsCount] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [savedPresets, setSavedPresets] = useState<SavedGapperFilterPreset[]>(() => loadSavedGapperFilterPresetsFromStorage());
  const [selectedSavedPresetId, setSelectedSavedPresetId] = useState<string | null>(null);
  const filterControlsRef = useRef<GapperFilterControlsRef>(null);

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
    const includeNews = f.includeNews !== false;
    setNewsSearched(includeNews);
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
        setNews(null);
        setPythonConfigured(false);
        setNewsSearched(includeNews);
        setNewsError(null);
        setResultsCount(null);
        setError(json.error ?? res.statusText);
        return;
      }
      setRows(json.rows);
      setNews(json.news ?? null);
      setPythonConfigured(Boolean(json.pythonConfigured));
      setNewsSearched(json.newsSearched ?? includeNews);
      setNewsError(json.newsError ?? null);
      setResultsCount(json.rows?.length ?? 0);
    } catch (e) {
      setRows(null);
      setNews(null);
      setPythonConfigured(false);
      setNewsSearched(includeNews);
      setNewsError(null);
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

  useEffect(() => {
    if (!filtersHydrated) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (!isEtPremarketWindow()) return;
      void run(filters);
    };
    const id = window.setInterval(tick, PREMARKET_AUTO_REFRESH_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [filtersHydrated, filters, run]);

  const applyFilters = (next: GapperFilterState) => {
    setFilters(next);
    saveGapperFiltersToStorage(next);
    void run(next);
  };

  const applySavedPreset = useCallback((presetId: string) => {
    const preset = savedPresets.find((p) => p.id === presetId);
    if (!preset) return;
    setFilters(preset.filters);
    saveGapperFiltersToStorage(preset.filters);
    setSelectedSavedPresetId(preset.id);
    void run(preset.filters);
  }, [savedPresets, setFilters, run]);

  const saveCurrentPreset = useCallback((name: string, next: GapperFilterState) => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    const normalizedFilters: GapperFilterState = { ...next, capPreset: "custom" };
    const existing = savedPresets.find((p) => p.name.toLowerCase() === normalizedName.toLowerCase());
    const entry: SavedGapperFilterPreset = existing
      ? { ...existing, name: normalizedName, filters: normalizedFilters }
      : { id: makePresetId(), name: normalizedName, filters: normalizedFilters };
    const nextList = [entry, ...savedPresets.filter((p) => p.id !== entry.id)];
    setSavedPresets(nextList);
    saveSavedGapperFilterPresetsToStorage(nextList);
    setFilters(normalizedFilters);
    saveGapperFiltersToStorage(normalizedFilters);
    setSelectedSavedPresetId(entry.id);
  }, [savedPresets, setFilters]);

  const renameSavedPreset = useCallback((presetId: string, nextName: string) => {
    const normalizedName = nextName.trim();
    if (!normalizedName) return;
    const duplicate = savedPresets.find(
      (p) => p.id !== presetId && p.name.toLowerCase() === normalizedName.toLowerCase()
    );
    if (duplicate) {
      window.alert(`A preset named "${duplicate.name}" already exists.`);
      return;
    }
    const nextList = savedPresets.map((p) => (p.id === presetId ? { ...p, name: normalizedName } : p));
    setSavedPresets(nextList);
    saveSavedGapperFilterPresetsToStorage(nextList);
  }, [savedPresets]);

  const deleteSavedPreset = useCallback((presetId: string) => {
    const nextList = savedPresets.filter((p) => p.id !== presetId);
    setSavedPresets(nextList);
    saveSavedGapperFilterPresetsToStorage(nextList);
    setSelectedSavedPresetId((cur) => (cur === presetId ? null : cur));
  }, [savedPresets]);

  return (
    <div
      className="rounded border"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
    >
      <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="pm-site-caption tabular-nums" style={{ color: "var(--ws-text-dim)" }}>
          Results: {resultsCount === null ? "—" : resultsCount}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`pm-focus shrink-0 rounded border px-2 py-1 font-medium transition-colors duration-150 ${
              filtersOpen
                ? "border-[var(--ws-cyan)] bg-[rgba(0,229,204,0.12)] text-[var(--ws-cyan)] hover:bg-[rgba(0,229,204,0.18)]"
                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)]"
            }`}
            style={{
              fontFamily: "var(--ws-font-sans)",
              fontSize: "var(--ws-fs-label)",
            }}
            aria-expanded={filtersOpen}
            aria-pressed={filtersOpen}
          >
            Filters
          </button>
          <button
            type="button"
            onClick={() => {
              if (filtersOpen) {
                filterControlsRef.current?.applyFiltersAndRunPrimary();
              } else {
                applyFilters(filters);
              }
            }}
            disabled={loading}
            className="pm-focus shrink-0 rounded border border-[var(--border-default)] bg-transparent font-medium text-[var(--text-secondary)] transition-colors duration-150 ws-focus-ring hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)] disabled:opacity-50"
            style={{
              height: 30,
              padding: "4px 12px",
              fontFamily: "var(--ws-font-sans)",
              fontSize: "var(--ws-fs-label)",
            }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => void run(filters)}
            disabled={loading}
            className="pm-focus inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded border border-[var(--border-default)] bg-transparent text-[var(--text-secondary)] transition-colors duration-150 ws-focus-ring hover:border-[rgba(0,229,204,0.45)] hover:bg-[rgba(0,229,204,0.08)] hover:text-[var(--ws-cyan)] active:border-[var(--ws-cyan)] active:bg-[rgba(0,229,204,0.12)] active:text-[var(--ws-cyan)] disabled:opacity-50"
            title="Refresh scan"
            aria-label="Refresh scan"
          >
            ↻
          </button>
          {lastRefreshSeconds != null ? (
            <span
              className="shrink-0 tabular-nums"
              style={{
                fontFamily: "var(--ws-font-mono)",
                fontSize: "var(--ws-fs-caption)",
                color: "#8a8a8a",
              }}
              title="Duration of the last TradingView request"
            >
              {lastRefreshSeconds.toFixed(2)}s
            </span>
          ) : null}
        </div>
      </div>

      {filtersOpen ? (
      <GapperFilterControls
        ref={filterControlsRef}
        filters={filters}
        onFiltersChange={(next) => {
          setSelectedSavedPresetId(null);
          setFilters(next);
        }}
        onPrimaryAction={applyFilters}
        savedPresets={savedPresets}
        selectedSavedPresetId={selectedSavedPresetId}
        onSelectSavedPresetId={setSelectedSavedPresetId}
        onApplySavedPreset={applySavedPreset}
        onSaveCurrentPreset={saveCurrentPreset}
        onRenameSavedPreset={renameSavedPreset}
        onDeleteSavedPreset={deleteSavedPreset}
        primaryLabel="Apply"
        loading={loading}
        hidePrimaryButton
      />
      ) : null}

      {error ? (
        <div
          className="pm-site-prose rounded border px-3 py-2.5 leading-relaxed"
          role="alert"
          style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)" }}
        >
          <p className="font-semibold" style={{ color: "var(--ws-text)" }}>
            TradingView screener failed
          </p>
          <p className="pm-site-caption mt-1" style={{ color: "var(--ws-text-dim)" }}>
            {error}
          </p>
        </div>
      ) : null}

      {newsError ? (
        <div
          className="pm-site-prose rounded border px-3 py-2.5 leading-relaxed"
          role="alert"
          style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)" }}
        >
          <p className="font-semibold" style={{ color: "var(--ws-text)" }}>
            Headlines request failed
          </p>
          <p className="pm-site-caption mt-1" style={{ color: "var(--ws-text-dim)" }}>
            {newsError}
          </p>
        </div>
      ) : null}

      {!error && rows && rows.length === 0 && !loading ? (
        <p className="pm-site-prose" style={{ color: "var(--ws-text-dim)" }}>
          No rows match these filters (or market is closed / no pre-market data).
        </p>
      ) : null}

      {sortedRows && sortedRows.length > 0 ? (
        <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--ws-border)" }}>
          <table className="pm-site-caption w-full min-w-[58rem] border-collapse">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}>
                <th
                  className="pm-sip-col-head w-8 px-1 py-1.5 text-center"
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
                  label="Vol %"
                  col="volPct"
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
                <th className="pm-sip-col-head min-w-[16rem] px-2 py-1.5 text-left" style={{ color: "var(--ws-text-dim)" }}>
                  News
                </th>
                <th className="pm-sip-col-head w-16 px-2 py-1.5 text-center" style={{ color: "var(--ws-text-dim)" }}>
                  Add
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const ticker = r.ticker.toUpperCase();
                const rowNews = news?.[ticker] ?? [];
                const firstHeadline = rowNews[0]?.title?.trim() ?? "";
                const catalyst = catalystByTicker[ticker] ?? null;
                const rowLoading = Boolean(catalystLoadingByTicker[ticker]);
                const rowCatalystError = catalystErrorByTicker[ticker] ?? null;
                const inLarge = Boolean(sipMembershipByTicker?.[ticker]?.large);
                const inSmall = Boolean(sipMembershipByTicker?.[ticker]?.small);
                return (
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
                          fontFamily: "var(--ws-font-sans)",
                          fontSize: "var(--ws-fs-caption)",
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
                    style={{ color: r.volPct != null && r.volPct > 5 ? "#5bbd6e" : "var(--ws-text-dim)" }}
                  >
                    {fmtVolPct(r.volPct)}
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
                  <td className="max-w-[22rem] min-w-[16rem] px-2 py-1.5 align-top">
                    {catalyst ? (
                      <p className="m-0 leading-snug" style={{ color: "var(--ws-text)" }} title={catalyst.summary}>
                        {catalyst.summary}
                      </p>
                    ) : !newsSearched ? (
                      <p className="m-0 leading-snug" style={{ color: "var(--ws-text-dim)" }}>
                        No search done
                      </p>
                    ) : firstHeadline ? (
                      <div className="flex items-start justify-between gap-2">
                        <p className="m-0 min-w-0 flex-1 leading-snug" style={{ color: "var(--ws-text-dim)" }} title={firstHeadline}>
                          {truncateSipRationale(firstHeadline)}
                        </p>
                        <button
                          type="button"
                          className="pm-focus inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border"
                          style={{
                            borderColor: "var(--ws-border)",
                            color: "var(--ws-cyan)",
                            background: "transparent",
                          }}
                          disabled={rowLoading}
                          aria-label={rowLoading ? `Generating catalyst for ${ticker}` : `Expand catalyst for ${ticker}`}
                          title={rowLoading ? "Generating catalyst..." : "Expand catalyst"}
                          onClick={async () => {
                            if (rowLoading || rowNews.length === 0) return;
                            setCatalystLoadingByTicker((prev) => ({ ...prev, [ticker]: true }));
                            setCatalystErrorByTicker((prev) => ({ ...prev, [ticker]: null }));
                            try {
                              const res = await fetch("/api/premarket/catalyst", {
                                method: "POST",
                                headers: { "Content-Type": "application/json", Accept: "application/json" },
                                body: JSON.stringify({ row: r, headlines: rowNews }),
                                cache: "no-store",
                              });
                              const json = (await res.json()) as
                                | { ok: true; catalyst: SipCatalyst | null }
                                | { ok: false; error: string };
                              if (!res.ok || !json.ok) {
                                setCatalystErrorByTicker((prev) => ({
                                  ...prev,
                                  [ticker]: json.ok ? "Catalyst request failed" : json.error,
                                }));
                                return;
                              }
                              const catalyst = json.catalyst;
                              if (!catalyst) {
                                setCatalystErrorByTicker((prev) => ({
                                  ...prev,
                                  [ticker]: "No qualifying catalyst details were generated.",
                                }));
                                return;
                              }
                              setCatalystByTicker((prev) => ({ ...prev, [ticker]: catalyst }));
                            } catch (e) {
                              setCatalystErrorByTicker((prev) => ({
                                ...prev,
                                [ticker]: e instanceof Error ? e.message : "Catalyst request failed",
                              }));
                            } finally {
                              setCatalystLoadingByTicker((prev) => ({ ...prev, [ticker]: false }));
                            }
                          }}
                        >
                          {rowLoading ? (
                            <span
                              className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent"
                              aria-hidden="true"
                            />
                          ) : (
                            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true" focusable="false">
                              <path d="M6 2.25v7.5M2.25 6h7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                      </div>
                    ) : pythonConfigured ? (
                      <p className="m-0 leading-snug" style={{ color: "var(--ws-text-dim)" }}>
                        No News.
                      </p>
                    ) : (
                      <p className="m-0 leading-snug" style={{ color: "var(--ws-text-dim)" }}>
                        —
                      </p>
                    )}
                    {rowCatalystError ? (
                      <p className="m-0 mt-1 leading-snug" style={{ color: "var(--negative)" }}>
                        {rowCatalystError}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 align-middle text-center">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="pm-focus inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border px-1"
                        style={{
                          borderColor: inLarge ? "var(--ws-cyan)" : "var(--ws-border)",
                          color: inLarge ? "var(--ws-cyan)" : "var(--text-secondary)",
                          background: "transparent",
                          fontSize: "var(--ws-fs-caption)",
                          opacity: onAddToSip ? 1 : 0.5,
                        }}
                        disabled={!onAddToSip}
                        title={inLarge ? "In SIP Large Caps" : "Add to SIP Large Caps"}
                        aria-label={inLarge ? `Already in SIP Large Caps: ${ticker}` : `Add ${ticker} to SIP Large Caps`}
                        onClick={() => onAddToSip?.("mid-large", { row: r, headlines: rowNews, catalyst })}
                      >
                        L
                      </button>
                      <button
                        type="button"
                        className="pm-focus inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border px-1"
                        style={{
                          borderColor: inSmall ? "var(--ws-cyan)" : "var(--ws-border)",
                          color: inSmall ? "var(--ws-cyan)" : "var(--text-secondary)",
                          background: "transparent",
                          fontSize: "var(--ws-fs-caption)",
                          opacity: onAddToSip ? 1 : 0.5,
                        }}
                        disabled={!onAddToSip}
                        title={inSmall ? "In SIP Small Caps" : "Add to SIP Small Caps"}
                        aria-label={inSmall ? `Already in SIP Small Caps: ${ticker}` : `Add ${ticker} to SIP Small Caps`}
                        onClick={() => onAddToSip?.("small-cap", { row: r, headlines: rowNews, catalyst })}
                      >
                        S
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </div>
      ) : null}

      {loading && !rows?.length ? (
        <p className="pm-site-prose" style={{ color: "var(--ws-text-dim)" }}>
          Loading gappers…
        </p>
      ) : null}
      </div>
    </div>
  );
}
