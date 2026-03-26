"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { type WorkspaceSection } from "@/types/workspace";

class PanelErrorBoundary extends React.Component<
  { name: string; children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { name: string; children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[PanelError:${this.props.name}]`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, background: "var(--ws-bg2)", color: "var(--ws-red)", fontSize: 11, overflow: "auto" }}>
          <strong>{this.props.name} error:</strong>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 4, fontSize: 10, color: "var(--ws-text-dim)" }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
import WorkspaceHeader, { type MarketSubTab, type SectorSubTab, type SectorTimeframe } from "@/components/WorkspaceHeader";
import WorkspaceLayout from "@/components/WorkspaceLayout";
import StockChart, { type ChartTimeframe } from "@/components/StockChart";
import NNHPanel from "@/components/NNHPanel";
import WatchlistPanel from "@/components/WatchlistPanel";
import MarketLeftPanel from "@/components/MarketLeftPanel";
import SectorPerfPanel from "@/components/SectorPerfPanel";
import RightRail from "@/components/RightRail";
import MarketBreadthRail from "@/components/MarketBreadthRail";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import {
  loadFlags,
  saveFlags,
  loadWatchlists,
  saveWatchlists,
  type StockFlag,
  type Watchlist,
} from "@/lib/watchlist-storage";
import { loadScreens, seedDefaultScreensIfEmpty, type SavedScreen } from "@/lib/screener-storage";
import { useLayoutPreferences } from "@/hooks/useLayoutPreferences";
import { useCandleCache, type Candle } from "@/hooks/useCandleCache";
import { useStockData } from "@/hooks/useStockData";
import { useFundamentals } from "@/hooks/useFundamentals";
import { useOwnership } from "@/hooks/useOwnership";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/hooks/useTheme";

const DEFAULT_SYMBOL = "SPY";
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

  // Market contextual state
  const [marketSubTab, setMarketSubTab] = useState<MarketSubTab>("indices");

  // Sectors contextual state
  const [sectorSubTab, setSectorSubTab] = useState<SectorSubTab>("sectors");
  const [sectorTimeframe, setSectorTimeframe] = useState<SectorTimeframe>("1w");

  // Scans contextual state
  const [activeFlagFilter, setActiveFlagFilter] = useState<StockFlag | null>(null);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [activeScanName, setActiveScanName] = useState("");
  const [openToScreenerTrigger, setOpenToScreenerTrigger] = useState<{ name: string; nonce: number } | null>(null);

  // Collection drill-down
  const [openToCollectionTrigger, setOpenToCollectionTrigger] = useState<
    | { kind: "sector" | "industry"; value: string; nonce: number }
    | { kind: "theme"; value: string; nonce: number }
    | { kind: "index"; value: string; nonce: number }
    | null
  >(null);

  const [flags, setFlags] = useState<Record<string, StockFlag>>(() => loadFlags());
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => loadWatchlists());
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);
  const secondaryPagesPrefetchedRef = useRef(false);
  const { cycleTheme } = useTheme();

  const {
    chartLeftPx,
    setChartLeftPx,
    railWidthPx,
    setRailWidthPx,
    rightRailHidden,
    setRightRailHidden,
    handleRightRailToggle,
  } = useLayoutPreferences();

  const chartHidden = section === "market" && marketSubTab === "monitor";

  const prevSectionRef = useRef(section);
  const savedChartLeftRef = useRef<{ sectors: number | null; other: number | null }>({ sectors: null, other: null });

  useEffect(() => {
    if (section === "market") {
      setRightRailHidden(true);
    } else if (section === "sectors-industries") {
      setRightRailHidden(true);
    } else if (section === "scans" || section === "lists") {
      setRightRailHidden(false);
    }

    const prev = prevSectionRef.current;
    if (prev !== section) {
      const isSectorNow = section === "sectors-industries";
      const wasSector = prev === "sectors-industries";
      if (isSectorNow && !wasSector) {
        savedChartLeftRef.current.other = chartLeftPx;
        const saved = savedChartLeftRef.current.sectors;
        const minSectorLeft = Math.round(Math.max(500, window.innerWidth * 0.5));
        setChartLeftPx(saved != null ? saved : Math.max(chartLeftPx, minSectorLeft));
      } else if (!isSectorNow && wasSector) {
        savedChartLeftRef.current.sectors = chartLeftPx;
        const saved = savedChartLeftRef.current.other;
        setChartLeftPx(saved != null ? saved : 340);
      }
      prevSectionRef.current = section;
    }
  }, [section, marketSubTab, setRightRailHidden, chartLeftPx, setChartLeftPx]);

  const { getCachedCandles, fetchCandlesFor } = useCandleCache();
  const { data, loading, error } = useStockData(symbol);
  const { yearlyRows, quarterlyRows, sidebarLoading } = useFundamentals(symbol);
  const { ownershipQuarters, fundCount } = useOwnership(symbol);

  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    seedDefaultScreensIfEmpty();
    const loaded = loadScreens();
    setScreens(loaded);
    if (loaded.length > 0) setActiveScanName(loaded[0].name);
    fetch("/api/health").then((r) => r.json()).then((d) => {
      const raw = d.latestScreenerDate ?? d.dbUpdatedAt;
      if (raw) {
        const dt = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
        if (!isNaN(dt.getTime())) {
          const day = dt.getDate();
          const suffix = [11,12,13].includes(day) ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
          const month = dt.toLocaleDateString("en-US", { month: "long" });
          setLastUpdated(`${day}${suffix} ${month} ${dt.getFullYear()}`);
        }
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (secondaryPagesPrefetchedRef.current) return;
    secondaryPagesPrefetchedRef.current = true;
    const timer = window.setTimeout(() => {
      for (const url of ["/api/market-monitor", "/api/sectors-industries", "/api/breadth?index=sp500"]) {
        fetch(url).catch(() => {});
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);

  const handleSymbolSelect = useCallback((sym: string) => {
    if (!sym) return;
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

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const controller = new AbortController();
    const cached = getCachedCandles(symbol, chartTimeframe);
    if (cached) { setCandles(cached); setChartLoading(false); }
    else { setChartLoading(true); }
    fetchCandlesFor(symbol, chartTimeframe, { signal: controller.signal })
      .then((rows) => { if (!cancelled && !controller.signal.aborted) setCandles(rows); })
      .finally(() => { if (!cancelled && !controller.signal.aborted) setChartLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [symbol, chartTimeframe, fetchCandlesFor, getCachedCandles]);

  const handleSearchSubmit = () => {
    const s = searchValue.trim().toUpperCase();
    if (s) { setSymbol(s); setSearchValue(""); }
  };

  const currentStockFlag = flags[symbol.toUpperCase()] ?? null;
  const chartWatchlists = useMemo(() => watchlists.map((l) => ({ id: l.id, name: l.name })), [watchlists]);
  const scanIndex = useMemo(() => scanSymbols.findIndex((s) => s === symbol.toUpperCase()), [scanSymbols, symbol]);

  useEffect(() => {
    if (scanIndex < 0) return;
    const neighbors = new Set<string>();
    for (let d = 1; d <= PREFETCH_NEIGHBOR_COUNT; d++) {
      if (scanSymbols[scanIndex - d]) neighbors.add(scanSymbols[scanIndex - d]);
      if (scanSymbols[scanIndex + d]) neighbors.add(scanSymbols[scanIndex + d]);
    }
    neighbors.forEach((sym) => { void fetchCandlesFor(sym, chartTimeframe); });
  }, [scanIndex, scanSymbols, chartTimeframe, fetchCandlesFor]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
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
      el?.focus(); el?.select();
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
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>Add MASSIVE_API_KEY to .env.local or check the symbol.</p>
        <button onClick={() => setSymbol(DEFAULT_SYMBOL)} className="rounded px-4 py-2 text-sm" style={{ background: "var(--ws-bg3)", color: "var(--ws-text)" }}>
          Try {DEFAULT_SYMBOL}
        </button>
      </div>
    );
  }

  // ---- Panel contents ----

  const leftPanel = (
    <PanelErrorBoundary name="LeftPanel">
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      {section === "market" ? (
        <MarketLeftPanel onSymbolSelect={handleSymbolSelect} selectedSymbol={symbol} activeTab={marketSubTab} />
      ) : section === "sectors-industries" ? (
        <SectorPerfPanel
          subTab={sectorSubTab}
          timeframe={sectorTimeframe}
          onTimeframeChange={setSectorTimeframe}
          onSymbolSelect={handleSymbolSelect}
          onDrillDown={(kind, value) => {
            setOpenToCollectionTrigger({ kind, value, nonce: Date.now() } as typeof openToCollectionTrigger);
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
          openToCollectionTrigger={openToCollectionTrigger}
          openToScreenerTrigger={section === "scans" ? openToScreenerTrigger : null}
          hideSidebar
          activeWatchlistIdSync={activeWatchlistId}
          onActiveWatchlistIdChange={setActiveWatchlistId}
        />
      )}
    </div>
    </PanelErrorBoundary>
  );

  const centerPanel = (
    <PanelErrorBoundary name="CenterPanel">
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
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
    </PanelErrorBoundary>
  );

  const rightPanel = (
    <PanelErrorBoundary name="RightPanel">
    {section === "market" ? (
      <MarketBreadthRail selectedSymbol={symbol} />
    ) : (
      <RightRail
        section={section}
        symbol={symbol}
        profile={data?.profile ?? null}
        marketCap={data?.quote?.marketCap}
        nextEarnings={data?.nextEarnings}
        yearlyRows={yearlyRows}
        quarterlyRows={quarterlyRows}
        ownershipQuarters={ownershipQuarters}
        fundCount={fundCount}
        rsRank={data?.rsRank}
        loading={sidebarLoading}
      />
    )}
    </PanelErrorBoundary>
  );

  return (
    <div className="h-screen min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--ws-bg)" }}>
      <WorkspaceHeader
        section={section}
        onSectionChange={(s) => {
          setSection(s);
          if (s === "scans" && activeScanName && !openToScreenerTrigger) {
            setOpenToScreenerTrigger({ name: activeScanName, nonce: Date.now() });
          }
        }}
        symbol={symbol}
        onSymbolChange={setSymbol}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={handleSearchSubmit}
        flags={flags}
        activeFlagFilter={activeFlagFilter}
        onFlagFilter={setActiveFlagFilter}
        onFlagListOpen={(flag) => {
          const flagListId = `__flag_${flag}__`;
          setSection("lists");
          setOpenToCollectionTrigger({ kind: "index", value: flagListId, nonce: Date.now() });
        }}
        marketSubTab={marketSubTab}
        onMarketSubTabChange={setMarketSubTab}
        sectorSubTab={sectorSubTab}
        onSectorSubTabChange={setSectorSubTab}
        sectorTimeframe={sectorTimeframe}
        onSectorTimeframeChange={setSectorTimeframe}
        scanList={screens.map((s) => s.name)}
        activeScan={activeScanName}
        onScanChange={(name) => {
          setActiveScanName(name);
          setOpenToScreenerTrigger({ name, nonce: Date.now() });
        }}
        onNewScan={() => {
          setSection("scans");
          setOpenToScreenerTrigger({ name: "__new__", nonce: Date.now() });
        }}
        watchlistNames={chartWatchlists}
        activeWatchlistId={activeWatchlistId}
        onWatchlistChange={setActiveWatchlistId}
        lastUpdated={lastUpdated ? `Updated ${lastUpdated}` : null}
        railWidthPx={rightRailHidden ? 0 : railWidthPx}
        onNewList={() => {
          const name = prompt("New watchlist name:");
          if (!name?.trim()) return;
          const newList: Watchlist = { id: `wl-${Date.now()}`, name: name.trim(), symbols: [] };
          const updated = [...watchlists, newList];
          setWatchlists(updated);
          saveWatchlists(updated);
          window.dispatchEvent(new CustomEvent("stock-watchlists-changed", { detail: updated }));
          setActiveWatchlistId(newList.id);
          setSection("lists");
        }}
      />
      <WorkspaceLayout
        chartLeftPx={chartHidden ? 99999 : chartLeftPx}
        onChartLeftChange={chartHidden ? undefined : setChartLeftPx}
        railWidthPx={railWidthPx}
        onRailWidthChange={setRailWidthPx}
        rightRailHidden={rightRailHidden}
        onToggleRightRail={handleRightRailToggle}
        leftPanel={leftPanel}
        centerPanel={centerPanel}
        rightPanel={rightPanel}
      />
      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
