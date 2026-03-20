"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Header, { HeaderPage } from "@/components/Header";
import StockChart, { type ChartTimeframe } from "@/components/StockChart";
import LeftSidebar from "@/components/LeftSidebar";
import QuarterlyBox from "@/components/QuarterlyBox";
import WatchlistPanel from "@/components/WatchlistPanel";
import MarketMonitorTable from "@/components/MarketMonitorTable";
import SectorsIndustriesPage from "@/components/SectorsIndustriesPage";
import BreadthPage from "@/components/BreadthPage";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import {
  savePanelHeightPx,
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
  const [page, setPage] = useState<HeaderPage>("home");
  const [searchValue, setSearchValue] = useState("");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("daily");
  const [dualChartMode, setDualChartMode] = useState(false);
  const [syncCrosshair, setSyncCrosshair] = useState(true);
  const [dualLeftTimeframe, setDualLeftTimeframe] = useState<ChartTimeframe>("weekly");
  const [dualRightTimeframe, setDualRightTimeframe] = useState<ChartTimeframe>("daily");
  const [dualLeftCandles, setDualLeftCandles] = useState<Candle[] | null>(null);
  const [dualRightCandles, setDualRightCandles] = useState<Candle[] | null>(null);
  const [dualLeftLoading, setDualLeftLoading] = useState(true);
  const [dualRightLoading, setDualRightLoading] = useState(true);
  const [relatedStocks, setRelatedStocks] = useState<Array<{ symbol: string; name: string }>>([]);
  const [latestDataDate, setLatestDataDate] = useState<string | null>(null);
  const [openToRelatedListTrigger, setOpenToRelatedListTrigger] = useState<number | null>(null);
  const [openToCollectionTrigger, setOpenToCollectionTrigger] = useState<{
    kind: "sector" | "industry" | "theme" | "index";
    value: string;
    nonce: number;
  } | null>(null);
  const [scanSymbols, setScanSymbols] = useState<string[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [flags, setFlags] = useState<Record<string, StockFlag>>(() => loadFlags());
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => loadWatchlists());
  const secondaryPagesPrefetchedRef = useRef(false);
  const { cycleTheme } = useTheme();

  const {
    watchlistHeightPx,
    setWatchlistHeightPx,
    leftSidebarHidden,
    quarterlyHidden,
    handleWatchlistHeightChange,
    handleLeftSidebarToggle,
    handleQuarterlyToggle,
  } = useLayoutPreferences();

  const { getCachedCandles, fetchCandlesFor } = useCandleCache();
  const { data, loading, error, lastUpdate } = useStockData(symbol);
  const { yearlyRows, quarterlyRows, sidebarLoading, quarterlyLoading } = useFundamentals(symbol);
  const { ownershipData, ownershipQuarters } = useOwnership(symbol);

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const res = await fetch("/api/health");
        const json = (await res.json()) as { latestScreenerDate?: string | null };
        if (cancelled) return;
        setLatestDataDate(json?.latestScreenerDate ?? null);
      } catch {
        if (!cancelled) setLatestDataDate(null);
      }
    };
    fetchHealth();
    return () => { cancelled = true; };
  }, []);

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
        fetch(url).catch(() => { /* ignore warmup failures */ });
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

  // Load dual left candles
  useEffect(() => {
    if (!dualChartMode || !symbol) return;
    let cancelled = false;
    const controller = new AbortController();
    const cached = getCachedCandles(symbol, dualLeftTimeframe);
    if (cached) {
      setDualLeftCandles(cached);
      setDualLeftLoading(false);
    } else {
      setDualLeftLoading(true);
    }
    fetchCandlesFor(symbol, dualLeftTimeframe, { signal: controller.signal })
      .then((rows) => { if (!cancelled && !controller.signal.aborted) setDualLeftCandles(rows); })
      .finally(() => { if (!cancelled && !controller.signal.aborted) setDualLeftLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [dualChartMode, symbol, dualLeftTimeframe, fetchCandlesFor, getCachedCandles]);

  // Load dual right candles
  useEffect(() => {
    if (!dualChartMode || !symbol) return;
    let cancelled = false;
    const controller = new AbortController();
    const cached = getCachedCandles(symbol, dualRightTimeframe);
    if (cached) {
      setDualRightCandles(cached);
      setDualRightLoading(false);
    } else {
      setDualRightLoading(true);
    }
    fetchCandlesFor(symbol, dualRightTimeframe, { signal: controller.signal })
      .then((rows) => { if (!cancelled && !controller.signal.aborted) setDualRightCandles(rows); })
      .finally(() => { if (!cancelled && !controller.signal.aborted) setDualRightLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [dualChartMode, symbol, dualRightTimeframe, fetchCandlesFor, getCachedCandles]);

  const handleToggleDualChartMode = useCallback(() => {
    setDualChartMode((prev) => {
      const next = !prev;
      if (next) {
        const canReuseMain = Array.isArray(candles) && candles.length > 0;
        if (canReuseMain && chartTimeframe === dualRightTimeframe) {
          setDualRightCandles(candles);
          setDualRightLoading(false);
        } else {
          setDualRightCandles(null);
          setDualRightLoading(true);
        }
        if (canReuseMain && chartTimeframe === dualLeftTimeframe) {
          setDualLeftCandles(candles);
          setDualLeftLoading(false);
        } else {
          setDualLeftCandles(null);
          setDualLeftLoading(true);
        }
      }
      return next;
    });
  }, [candles, chartTimeframe, dualLeftTimeframe, dualRightTimeframe]);

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
    { key: "b", description: "Toggle sidebar", category: "general" as const, action: handleLeftSidebarToggle },
    { key: "q", description: "Toggle quarterly", category: "general" as const, action: handleQuarterlyToggle },
    { key: "t", description: "Cycle theme", category: "general" as const, action: cycleTheme },
    { key: "?", shift: true, description: "Show shortcuts", category: "general" as const, action: () => setShortcutsOpen(true) },
    { key: "1", description: "Home", category: "navigation" as const, action: () => setPage("home") },
    { key: "2", description: "Sectors", category: "navigation" as const, action: () => setPage("market-breadth") },
    { key: "3", description: "Monitor", category: "navigation" as const, action: () => setPage("market-monitor") },
    { key: "4", description: "Breadth", category: "navigation" as const, action: () => setPage("breadth") },
    { key: "d", description: "Daily chart", category: "chart" as const, action: () => setChartTimeframe("daily") },
    { key: "w", description: "Weekly chart", category: "chart" as const, action: () => setChartTimeframe("weekly") },
    { key: "m", description: "Monthly chart", category: "chart" as const, action: () => setChartTimeframe("monthly") },
    { key: "s", description: "Toggle dual", category: "chart" as const, action: handleToggleDualChartMode },
  ], [shortcutsOpen, handleLeftSidebarToggle, handleQuarterlyToggle, cycleTheme, handleToggleDualChartMode]));

  const atrPctEffective = data?.quote?.atrPct21d ?? undefined;
  const computed52WHighEffective = data?.quote?.yearHigh ?? undefined;
  const avgVolume30dEffective = data?.quote?.avgVolume ?? undefined;

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
    if (page !== "home" || scanIndex < 0) return;
    const timeframes = dualChartMode
      ? Array.from(new Set<ChartTimeframe>([dualLeftTimeframe, dualRightTimeframe]))
      : [chartTimeframe];
    const neighbors = new Set<string>();
    for (let d = 1; d <= PREFETCH_NEIGHBOR_COUNT; d++) {
      const up = scanSymbols[scanIndex - d];
      const down = scanSymbols[scanIndex + d];
      if (up) neighbors.add(up);
      if (down) neighbors.add(down);
    }
    neighbors.forEach((sym) => {
      timeframes.forEach((tf) => { void fetchCandlesFor(sym, tf); });
    });
  }, [page, scanIndex, scanSymbols, dualChartMode, dualLeftTimeframe, dualRightTimeframe, chartTimeframe, fetchCandlesFor]);

  // Keyboard navigation
  useEffect(() => {
    if (page !== "home") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
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
  }, [page, scanSymbols, symbol, handleSymbolSelect]);

  // Fetch related stocks
  useEffect(() => {
    if (!symbol) return;
    fetch(`/api/related-stocks?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setRelatedStocks(d) : setRelatedStocks([])))
      .catch(() => setRelatedStocks([]));
  }, [symbol]);

  const handleSearchSubmit = () => {
    const s = searchValue.trim().toUpperCase();
    if (s) {
      setSymbol(s);
      setSearchValue("");
    }
  };

  if (error && !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-black p-4">
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Add MASSIVE_API_KEY to .env.local or check the symbol.
        </p>
        <button
          onClick={() => setSymbol(DEFAULT_SYMBOL)}
          className="rounded bg-zinc-700 text-white px-4 py-2 text-sm"
        >
          Try {DEFAULT_SYMBOL}
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen min-h-0 flex flex-col overflow-hidden bg-white dark:bg-zinc-900">
      <Header
        quote={data?.quote ?? null}
        profile={data?.profile}
        symbol={symbol}
        atrPct={atrPctEffective}
        avgVolume30d={avgVolume30dEffective}
        computed52WHigh={computed52WHighEffective}
        lastUpdate={lastUpdate}
        onSymbolChange={setSymbol}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={handleSearchSubmit}
        loading={loading}
        currentPage={page}
        onPageChange={setPage}
        latestDataDate={latestDataDate}
        leftSidebarHidden={leftSidebarHidden}
        onLeftSidebarToggle={handleLeftSidebarToggle}
      />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden p-0 gap-0 bg-white dark:bg-zinc-900">
        {page === "market-monitor" ? (
          <MarketMonitorTable />
        ) : page === "market-breadth" ? (
          <SectorsIndustriesPage
            onOpenCollection={(target) => {
              setWatchlistHeightPx((h) => {
                if (h <= 32) { savePanelHeightPx(320); return 320; }
                return h;
              });
              setPage("home");
              setOpenToCollectionTrigger({ kind: target.kind, value: target.value, nonce: Date.now() });
            }}
          />
        ) : page === "breadth" ? (
          <BreadthPage />
        ) : (
          <>
        <div className="min-w-0 flex-1 min-h-0 overflow-hidden border-b border-zinc-200 dark:border-zinc-800 flex flex-col">
          <div className="relative flex flex-1 min-h-0 min-w-0 gap-0 overflow-hidden">
            {/* Mobile overlay backdrop */}
            {!leftSidebarHidden && (
              <div
                className="md:hidden fixed inset-0 z-30 bg-black/40"
                onClick={handleLeftSidebarToggle}
                aria-hidden
              />
            )}
            <div
              className={`
                max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[min(22rem,85vw)] max-md:shadow-xl
                md:relative min-h-0 shrink-0 overflow-hidden border-r border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900
                transition-all duration-300 ease-in-out
                ${leftSidebarHidden ? "max-md:-translate-x-full md:w-0" : "max-md:translate-x-0 md:w-[22rem]"}
              `}
            >
              <div
                className={`h-full min-h-0 transition-transform duration-300 ease-in-out ${
                  leftSidebarHidden ? "max-md:translate-x-0 md:-translate-x-full" : "translate-x-0"
                }`}
              >
                <LeftSidebar
                  symbol={symbol}
                  profile={data?.profile ?? null}
                  nextEarnings={data?.nextEarnings}
                  yearly={yearlyRows}
                  ownership={{
                    quarters: ownershipQuarters,
                    latestFundCount: ownershipData?.latestFundCount ?? undefined,
                    latestReportDate: ownershipData?.latestReportDate ?? undefined,
                  }}
                  relatedStocks={relatedStocks}
                  onSymbolSelect={handleSymbolSelect}
                  onOpenRelatedStocksInWatchlist={
                    relatedStocks.length > 0
                      ? () => {
                          setWatchlistHeightPx((h) => {
                            if (h <= 32) { savePanelHeightPx(320); return 320; }
                            return h;
                          });
                          setOpenToRelatedListTrigger(Date.now());
                        }
                      : undefined
                  }
                  onOpenSectorInWatchlist={(sector) => {
                    const trimmed = String(sector ?? "").trim();
                    if (!trimmed) return;
                    setWatchlistHeightPx((h) => {
                      if (h <= 32) { savePanelHeightPx(320); return 320; }
                      return h;
                    });
                    setOpenToCollectionTrigger({ kind: "sector", value: trimmed, nonce: Date.now() });
                  }}
                  onOpenIndustryInWatchlist={(industry) => {
                    const trimmed = String(industry ?? "").trim();
                    if (!trimmed) return;
                    setWatchlistHeightPx((h) => {
                      if (h <= 32) { savePanelHeightPx(320); return 320; }
                      return h;
                    });
                    setOpenToCollectionTrigger({ kind: "industry", value: trimmed, nonce: Date.now() });
                  }}
                  loading={sidebarLoading}
                />
              </div>
            </div>
            <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
              <div className="relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
                {dualChartMode ? (
                  <div className="flex flex-1 min-h-0 min-w-0">
                    <div className="flex-1 min-w-0 min-h-0 border-r border-zinc-200 dark:border-zinc-700">
                      <StockChart
                        symbol={symbol}
                        data={dualLeftCandles}
                        loading={dualLeftLoading}
                        timeframe={dualLeftTimeframe}
                        onTimeframeChange={setDualLeftTimeframe}
                        dualModeEnabled={dualChartMode}
                        onToggleDualMode={handleToggleDualChartMode}
                        crosshairSyncEnabled={syncCrosshair}
                        onToggleCrosshairSync={() => setSyncCrosshair((v) => !v)}
                        showGlobalControls
                        chartInstanceId="dual-left"
                        stockFlag={currentStockFlag}
                        onFlagChange={handleFlagChange}
                        watchlists={chartWatchlists}
                        onAddToWatchlist={handleAddToWatchlist}
                      />
                    </div>
                    <div className="flex-1 min-w-0 min-h-0">
                      <StockChart
                        symbol={symbol}
                        data={dualRightCandles}
                        loading={dualRightLoading}
                        timeframe={dualRightTimeframe}
                        onTimeframeChange={setDualRightTimeframe}
                        dualModeEnabled={dualChartMode}
                        crosshairSyncEnabled={syncCrosshair}
                        chartInstanceId="dual-right"
                        stockFlag={currentStockFlag}
                        onFlagChange={handleFlagChange}
                        watchlists={chartWatchlists}
                        onAddToWatchlist={handleAddToWatchlist}
                      />
                    </div>
                  </div>
                ) : (
                  <StockChart
                    symbol={symbol}
                    data={candles}
                    loading={chartLoading}
                    timeframe={chartTimeframe}
                    onTimeframeChange={setChartTimeframe}
                    dualModeEnabled={dualChartMode}
                    onToggleDualMode={handleToggleDualChartMode}
                    crosshairSyncEnabled={syncCrosshair}
                    onToggleCrosshairSync={() => setSyncCrosshair((v) => !v)}
                    showGlobalControls
                    chartInstanceId="single"
                    stockFlag={currentStockFlag}
                    onFlagChange={handleFlagChange}
                    watchlists={chartWatchlists}
                    onAddToWatchlist={handleAddToWatchlist}
                  />
                )}
                <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={handleQuarterlyToggle}
                    className="w-full h-8 px-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 flex items-center"
                    aria-label={quarterlyHidden ? "Show quarterly box" : "Hide quarterly box"}
                    title={quarterlyHidden ? "Show quarterly box" : "Hide quarterly box"}
                  >
                    <div
                      className="flex-1 flex justify-center items-center gap-1.5 min-w-0 transition-transform duration-300 ease-in-out"
                      style={{
                        transform: leftSidebarHidden ? "translateX(0)" : "translateX(-11rem)",
                      }}
                    >
                      <svg
                        width="20"
                        height="12"
                        viewBox="0 0 20 12"
                        fill="currentColor"
                        className="text-zinc-400 dark:text-zinc-500 shrink-0"
                        aria-hidden
                      >
                        {[0, 1, 2, 3, 4, 5].map((col) => (
                          <g key={col}>
                            <rect x={1.5 + col * 3.2} y={1} width="1.5" height="1.5" rx="0.5" />
                            <rect x={1.5 + col * 3.2} y={5.25} width="1.5" height="1.5" rx="0.5" />
                            <rect x={1.5 + col * 3.2} y={9.5} width="1.5" height="1.5" rx="0.5" />
                          </g>
                        ))}
                      </svg>
                      <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide truncate">
                        Quarterly Revenue & EPS
                      </span>
                    </div>
                    <div className="hidden md:block w-[86px] shrink-0" aria-hidden />
                  </button>
                  <div
                    className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-in-out ${
                      quarterlyHidden ? "max-h-0 opacity-0 -translate-y-2" : "max-h-[360px] opacity-100 translate-y-0"
                    }`}
                  >
                    <QuarterlyBox rows={quarterlyRows} ownershipRows={ownershipQuarters} loading={quarterlyLoading} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className="min-w-0 flex flex-col shrink-0 overflow-hidden"
          style={{
            height: watchlistHeightPx,
            minHeight: 32,
          }}
        >
          <WatchlistPanel
            panelHeightPx={watchlistHeightPx}
            onHeightChange={handleWatchlistHeightChange}
            onSymbolSelect={handleSymbolSelect}
            selectedSymbol={symbol}
            onOrderedSymbolsChange={handleOrderedSymbolsChange}
            relatedStocksList={
              relatedStocks.length > 0 && symbol
                ? { title: `Related to ${symbol}`, symbols: relatedStocks.map((r) => r.symbol) }
                : null
            }
            openToRelatedListTrigger={openToRelatedListTrigger ?? undefined}
            openToCollectionTrigger={openToCollectionTrigger}
          />
        </div>
          </>
        )}
      </main>
      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
