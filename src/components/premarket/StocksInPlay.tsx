"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GapperRow, GappersRequestBody } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import type { SipCatalyst } from "@/types/sip-catalyst";
import {
  gapperFilterStateToRequestBody,
  loadSipGapperFiltersFromStorage,
  saveSipGapperFiltersToStorage,
  type GapperFilterState,
} from "@/components/premarket/gapper-filters-storage";
import CollapsibleSection from "@/components/premarket/CollapsibleSection";
import GapperFilterControls from "@/components/premarket/GapperFilterControls";
import { ymdInEt } from "@/lib/et-ymd";
import SipPlayRowsTable from "@/components/premarket/SipPlayRowsTable";
import { recordSipSnapshotForArchive } from "@/lib/premarket/sip-archive";
import { SIP_MAX_TICKERS } from "@/lib/premarket/sip-constants";

const SIP_FIRST_AUTO_YMD_KEY = "premarket-sip-first-auto-ymd";

type StocksInPlayProps = {
  sectionLabel?: string;
  collapsed: boolean;
  onToggle: () => void;
  peekText: string;
  onOpenTickerInLists?: (sym: string) => void;
};

export default function StocksInPlay({
  sectionLabel = "Stocks in Play",
  collapsed,
  onToggle,
  peekText,
  onOpenTickerInLists,
}: StocksInPlayProps) {
  const [rows, setRows] = useState<GapperRow[] | null>(null);
  const [news, setNews] = useState<Record<string, PythonNewsItem[]> | null>(null);
  const [catalyst, setCatalyst] = useState<Record<string, SipCatalyst> | null>(null);
  const [catalystError, setCatalystError] = useState<string | null>(null);
  const [pythonConfigured, setPythonConfigured] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sipFilters, setSipFilters] = useState<GapperFilterState>(() => loadSipGapperFiltersFromStorage());
  const filtersRef = useRef(sipFilters);
  filtersRef.current = sipFilters;

  const load = useCallback(async (signal: AbortSignal, scanBody: GappersRequestBody): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setNewsError(null);
    setCatalystError(null);
    try {
      const res = await fetch("/api/premarket/stocks-in-play", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(scanBody),
        cache: "no-store",
        signal,
      });
      const json = (await res.json()) as StocksInPlaySuccess | { ok?: false; error?: string };
      if (!res.ok || !json.ok) {
        setRows(null);
        setNews(null);
        setCatalyst(null);
        setPythonConfigured(false);
        setError((json as { error?: string }).error ?? res.statusText);
        return false;
      }
      const rowsCapped = (json.rows ?? []).slice(0, SIP_MAX_TICKERS);
      setRows(rowsCapped);
      setNews(json.news);
      setCatalyst(json.catalyst);
      setCatalystError(json.catalystError ?? null);
      setPythonConfigured(json.pythonConfigured);
      setNewsError(json.newsError ?? null);
      recordSipSnapshotForArchive({ ...json, rows: rowsCapped });
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      setRows(null);
      setNews(null);
      setCatalyst(null);
      setError(e instanceof Error ? e.message : "Failed to load");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (collapsed) return;
    const todayYmd = ymdInEt();
    if (typeof window !== "undefined" && window.localStorage.getItem(SIP_FIRST_AUTO_YMD_KEY) === todayYmd) {
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    void (async () => {
      const ok = await load(ac.signal, gapperFilterStateToRequestBody(filtersRef.current));
      if (cancelled || !ok) return;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIP_FIRST_AUTO_YMD_KEY, ymdInEt());
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [collapsed, load]);

  const updateSipFilters = useCallback((next: GapperFilterState) => {
    setSipFilters(next);
    saveSipGapperFiltersToStorage(next);
    window.dispatchEvent(new CustomEvent("premarket-sip-filters-changed"));
  }, []);

  const refreshSip = useCallback(() => {
    const ac = new AbortController();
    void load(ac.signal, gapperFilterStateToRequestBody(filtersRef.current));
  }, [load]);

  const refreshSipWithFilters = useCallback((next: GapperFilterState) => {
    updateSipFilters(next);
    const ac = new AbortController();
    void load(ac.signal, gapperFilterStateToRequestBody(next));
  }, [load, updateSipFilters]);

  return (
    <CollapsibleSection
      id="sip"
      label={sectionLabel}
      labelAccent="cyan"
      peekText={peekText}
      collapsed={collapsed}
      onToggle={onToggle}
      actions={
        !collapsed ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="pm-focus shrink-0 rounded border px-2 py-1 font-medium transition-opacity"
              style={{
                borderColor: "var(--border-default)",
                color: "var(--text-secondary)",
                fontFamily: "var(--ws-font-sans)",
                fontSize: "var(--ws-fs-label)",
              }}
              aria-expanded={filtersOpen}
            >
              <span aria-hidden style={{ display: "inline-block", transform: filtersOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
                ▸
              </span>{" "}
              Filters
            </button>
            <button
              type="button"
              onClick={refreshSip}
              disabled={loading}
              className="pm-focus shrink-0 rounded border px-2 py-1 font-medium transition-opacity disabled:opacity-50"
              style={{
                borderColor: "var(--border-default)",
                color: "var(--text-primary)",
                fontFamily: "var(--ws-font-sans)",
                fontSize: "var(--ws-fs-label)",
              }}
            >
              {loading ? "Loading…" : "Refresh SIP"}
            </button>
          </div>
        ) : undefined
      }
    >
      {!collapsed ? (
        <div className="space-y-3">
      {filtersOpen ? (
        <div className="rounded border" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
          <GapperFilterControls
            filters={sipFilters}
            onFiltersChange={updateSipFilters}
            onPrimaryAction={refreshSipWithFilters}
            primaryLabel="Refresh SIP"
            loading={loading}
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded border px-3 py-2.5" role="alert" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
          <p className="pm-site-prose font-semibold" style={{ color: "var(--text-primary)" }}>
            Could not load Stocks in Play
          </p>
          <p className="pm-site-caption mt-1" style={{ color: "var(--text-secondary)" }}>
            {error}
          </p>
        </div>
      ) : null}

      {loading && !rows?.length ? (
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          Loading gappers, headlines, and catalysts…
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <SipPlayRowsTable
          rows={rows}
          news={news}
          catalyst={catalyst}
          pythonConfigured={pythonConfigured}
          newsError={newsError}
          catalystError={catalystError}
          onOpenTickerInLists={onOpenTickerInLists}
          mode="live"
        />
      ) : null}
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
