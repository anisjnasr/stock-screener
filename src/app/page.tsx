"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { type WorkspaceSection } from "@/types/workspace";
import WorkspaceHeader from "@/components/WorkspaceHeader";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import StockChart, { type ChartTimeframe } from "@/components/StockChart";
import NNHPanel from "@/components/NNHPanel";
import WatchlistPanel from "@/components/WatchlistPanel";
import MarketMonitorTable from "@/components/MarketMonitorTable";
import SectorsIndustriesPage from "@/components/SectorsIndustriesPage";
import RightRail from "@/components/RightRail";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import {
  loadFlags,
  saveFlags,
  loadWatchlists,
  saveWatchlists,
  type StockFlag,
  type Watchlist,
} from "@/lib/watchlist-storage";
import { useLayoutPreferences } from "@/hooks/useLayoutPreferences";
import { useCandleCache, type Candle } from "@/hooks/useCandleCache";
import { useStockData } from "@/hooks/useStockData";
import { useFundamentals } from "@/hooks/useFundamentals";
import { useOwnership } from "@/hooks/useOwnership";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/hooks/useTheme";

const DEFAULT_SYMBOL = "AAPL";
const PREFETCH_NEIGHBOR_COUNT = 3;

export default function Home() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [section, setSection] = useState<WorkspaceSection>("market");
  const [searchValue, setSearchValue] = useState("");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("daily");
  const [scanSymbols, setScanSymbols] = useState<string[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [visibleDateRange, setVisibleDateRange] = useState<{ from: string; to: string } | null>(null);
  const [nnhCollapsed, setNnhCollapsed] = useState(false);
  const [flags, setFlags] = useState<Record<string, StockFlag>>(() => loadFlags());
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => loadWatchlists());
  const secondaryPagesPrefetchedRef = useRef(false);
  const { cycleTheme } = useTheme();

  const {
    chartLeftPx,
    setChartLeftPx,
    railWidthPx,
    setRailWidthPx,
    rightRailHidden,
  } = useLayoutPreferences();

  const { getCachedCandles, fetchCandlesFor } = useCandleCache();
  const { data, loading, error } = useStockData(symbol);
  const { yearlyRows, quarterlyRows, sidebarLoading } = useFundamentals(symbol);
  const { ownershipQuarters } = useOwnership(symbol);

  // Prefetch secondary pages
  useEffect(() => {
    if (secondaryPagesPrefetchedRef.current) return;
    secondaryPagesPrefetchedRef.current = true;
    const timer = window.setTimeout(() => {
      const urls = [
        "/api/market-monitor",
        "/api/sectors-industries",
        "/api/breadth?index=sp500",
        "/api/breadth?index=nasdaq",
      ];
      for (const url of urls) {
        fetch(url).catch(() => {});
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);

  const handleSymbolSelect = useCallback((sym: string) => {
    setSymbol(sym.toUpperCase());
    setSearchValue("");
  }, []);

  const handleOrderedSymbolsChange = useCallback((symbols: string[]) => {
    setScanSymbols(symbols.map((s) => s.toUpperCase()).filter((s) => s.length > 0));
  }, []);

  const handleFlagChange = useCallback((flag: StockFlag | null) => {
    setFlags((prev) => {
      const next = { ...prev };
      const sym = symbol.toUpperCase();
      if (flag) next[sym] = flag;
      else delete next[sym];
      saveFlags(next);
      window.dispatchEvent(new CustomEvent("stock-flags-changed", { detail: next }));
      return next;
    });
  }, [symbol]);

  const handleAddToWatchlist = useCallback((watchlistId: string) => {
    setWatchlists((prev) => {
      const sym = symbol.toUpperCase();
      const next = prev.map((l) =>
        l.id === watchlistId && !l.symbols.includes(sym)
          ? { ...l, symbols: [...l.symbols, sym] }
          : l
      );
      saveWatchlists(next);
      window.dispatchEvent(new CustomEvent("stock-watchlists-changed", { detail: next }));
      return next;
    });
  }, [symbol]);

  useEffect(() => {
    const onFlagsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object") setFlags(detail);
    };
    const onWatchlistsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail)) setWatchlists(detail);
    };
    window.addEventListener("stock-flags-changed", onFlagsChanged);
    window.addEventListener("stock-watchlists-changed", onWatchlistsChanged);
    return () => {
      window.removeEventListener("stock-flags-changed", onFlagsChanged);
      window.removeEventListener("stock-watchlists-changed", onWatchlistsChanged);
    };
  }, []);

  // Load candles for current chart
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const controller = new AbortController();
    const cached = getCachedCandles(symbol, chartTimeframe);
    if (cached) {
      setCandles(cached);
      setChartLoading(false);
    } else {
      setChartLoading(true);
    }
    fetchCandlesFor(symbol, chartTimeframe, { signal: controller.signal })
      .then((rows) => {
        if (cancelled || controller.signal.aborted) return;
        setCandles(rows);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setChartLoading(false);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [symbol, chartTimeframe, fetchCandlesFor, getCachedCandles]);

  const handleSearchSubmit = () => {
    const s = searchValue.trim().toUpperCase();
    if (s) {
      setSymbol(s);
      setSearchValue("");
    }
  };

  const currentStockFlag = flags[symbol.toUpperCase()] ?? null;
  const chartWatchlists = useMemo(
    () => watchlists.map((l) => ({ id: l.id, name: l.name })),
    [watchlists]
  );

  const scanIndex = useMemo(
    () => scanSymbols.findIndex((s) => s === symbol.toUpperCase()),
    [scanSymbols, symbol]
  );

  // Prefetch neighboring candles
  useEffect(() => {
    if (scanIndex < 0) return;
    const neighbors = new Set<string>();
    for (let d = 1; d <= PREFETCH_NEIGHBOR_COUNT; d++) {
      const up = scanSymbols[scanIndex - d];
      const down = scanSymbols[scanIndex + d];
      if (up) neighbors.add(up);
      if (down) neighbors.add(down);
    }
    neighbors.forEach((sym) => { void fetchCandlesFor(sym, chartTimeframe); });
  }, [scanIndex, scanSymbols, chartTimeframe, fetchCandlesFor]);

  // Keyboard navigation (arrow up/down through scan results)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" || target.isContentEditable)
      ) return;
      if (scanSymbols.length === 0) return;
      const idx = scanSymbols.findIndex((s) => s === symbol.toUpperCase());
      if (idx < 0) return;
      const nextIdx = e.key === "ArrowDown" ? Math.min(scanSymbols.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (nextIdx === idx) return;
      e.preventDefault();
      handleSymbolSelect(scanSymbols[nextIdx]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scanSymbols, symbol, handleSymbolSelect]);

  useKeyboardShortcuts(useMemo(() => [
    { key: "/", description: "Focus search bar", category: "general" as const, action: () => {
      const el = document.querySelector<HTMLInputElement>('input[aria-label="Stock search"]');
      el?.focus();
      el?.select();
    }},
    { key: "Escape", description: "Unfocus / close", category: "general" as const, action: () => {
      if (shortcutsOpen) { setShortcutsOpen(false); return; }
      (document.activeElement as HTMLElement)?.blur?.();
    }},
    { key: "t", description: "Cycle theme", category: "general" as const, action: cycleTheme },
    { key: "?", shift: true, description: "Show shortcuts", category: "general" as const, action: () => setShortcutsOpen(true) },
    { key: "1", description: "Market", category: "navigation" as const, action: () => setSection("market") },
    { key: "2", description: "Sectors", category: "navigation" as const, action: () => setSection("sectors-industries") },
    { key: "3", description: "Scans", category: "navigation" as const, action: () => setSection("scans") },
    { key: "4", description: "Lists", category: "navigation" as const, action: () => setSection("lists") },
    { key: "d", description: "Daily chart", category: "chart" as const, action: () => setChartTimeframe("daily") },
    { key: "w", description: "Weekly chart", category: "chart" as const, action: () => setChartTimeframe("weekly") },
    { key: "m", description: "Monthly chart", category: "chart" as const, action: () => setChartTimeframe("monthly") },
  ], [shortcutsOpen, cycleTheme]));

  if (error && !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4" style={{ background: "var(--ws-bg)" }}>
        <p style={{ color: "var(--ws-red)" }}>{error}</p>
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>
          Add MASSIVE_API_KEY to .env.local or check the symbol.
        </p>
        <button
          onClick={() => setSymbol(DEFAULT_SYMBOL)}
          className="rounded px-4 py-2 text-sm"
          style={{ background: "var(--ws-bg3)", color: "var(--ws-text)" }}
        >
          Try {DEFAULT_SYMBOL}
        </button>
      </div>
    );
  }

  // ---- Panel contents ----

  const leftPanel = (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      {section === "market" ? (
        <MarketMonitorTable />
      ) : section === "sectors-industries" ? (
        <SectorsIndustriesPage
          onOpenCollection={() => {
            setSection("lists");
          }}
        />
      ) : (
        <WatchlistPanel
          panelHeightPx={9999}
          onHeightChange={() => {}}
          onSymbolSelect={handleSymbolSelect}
          selectedSymbol={symbol}
          onOrderedSymbolsChange={handleOrderedSymbolsChange}
        />
      )}
    </div>
  );

  const centerPanel = (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        <StockChart
          symbol={symbol}
          data={candles}
          loading={chartLoading}
          timeframe={chartTimeframe}
          onTimeframeChange={setChartTimeframe}
          onVisibleDateRangeChange={section === "market" ? setVisibleDateRange : undefined}
          dualModeEnabled={false}
          showGlobalControls
          chartInstanceId="single"
          stockFlag={currentStockFlag}
          onFlagChange={handleFlagChange}
          watchlists={chartWatchlists}
          onAddToWatchlist={handleAddToWatchlist}
        />
      </div>
      {section === "market" && (
        <NNHPanel
          visibleRange={visibleDateRange}
          collapsed={nnhCollapsed}
          onToggleCollapse={() => setNnhCollapsed((v) => !v)}
        />
      )}
    </div>
  );

  const rightPanel = (
    <RightRail
      section={section}
      symbol={symbol}
      profile={data?.profile ?? null}
      nextEarnings={data?.nextEarnings}
      yearlyRows={yearlyRows}
      quarterlyRows={quarterlyRows}
      ownershipQuarters={ownershipQuarters}
      loading={sidebarLoading}
    />
  );

  return (
    <div className="h-screen min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--ws-bg)" }}>
      <WorkspaceHeader
        section={section}
        onSectionChange={setSection}
        symbol={symbol}
        onSymbolChange={setSymbol}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={handleSearchSubmit}
        flags={flags}
      />
      <WorkspaceLayout
        chartLeftPx={chartLeftPx}
        onChartLeftChange={setChartLeftPx}
        railWidthPx={railWidthPx}
        onRailWidthChange={setRailWidthPx}
        rightRailHidden={rightRailHidden}
        leftPanel={leftPanel}
        centerPanel={centerPanel}
        rightPanel={rightPanel}
      />
      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
