"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { type WorkspaceSection } from "@/types/workspace";
import type { ChartTimeframe } from "@/components/StockChart";

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
import { type InsightInput } from "@/components/AIInsightFormCard";
import { DEFAULT_LISTS_OPEN_ID, FULL_UNIVERSE_ID } from "@/components/WatchlistPanel";
import {
  createCustomPage,
  deleteCustomPage,
  loadCustomPages,
  type CustomPage,
  updateCustomPage,
} from "@/lib/custom-pages-storage";
import {
  loadFlags,
  saveFlags,
  loadWatchlists,
  saveWatchlists,
  type StockFlag,
  type Watchlist,
} from "@/lib/watchlist-storage";
import { loadScreens, saveScreens, seedDefaultScreensIfEmpty, ensurePrebuiltScreensPresent, deleteScreen, loadFolders, type SavedScreen, type ScreenerFolder } from "@/lib/screener-storage";
import { DEFAULT_RAIL_WIDTH_PX } from "@/lib/layout-constants";
import { useLayoutPreferences } from "@/hooks/useLayoutPreferences";
import { useCandleCache, type Candle } from "@/hooks/useCandleCache";
import { useStockData } from "@/hooks/useStockData";
import { useFundamentals } from "@/hooks/useFundamentals";
import { useOwnership } from "@/hooks/useOwnership";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/hooks/useTheme";

const NNHPanel = dynamic(() => import("@/components/NNHPanel"), { ssr: false });
const WatchlistPanel = dynamic(() => import("@/components/WatchlistPanel"), { ssr: false });
const MarketLeftPanel = dynamic(() => import("@/components/MarketLeftPanel"), { ssr: false });
const SectorPerfPanel = dynamic(() => import("@/components/SectorPerfPanel"), { ssr: false });
const RightRail = dynamic(() => import("@/components/RightRail"), { ssr: false });
const MarketBreadthRail = dynamic(() => import("@/components/MarketBreadthRail"), { ssr: false });
const KeyboardShortcutsModal = dynamic(() => import("@/components/KeyboardShortcutsModal"), { ssr: false });
const StockChart = dynamic(() => import("@/components/StockChart"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[var(--ws-bg)]" />,
});

const DEFAULT_SYMBOL = "SPY";
const PREFETCH_NEIGHBOR_COUNT = 3;
const RIGHT_DIVIDER_PX = 2;
const CHART_HANDLE_PX = 8;
const MIN_CENTER_WIDTH_PX = 420;
const DEFAULT_INDEX_WATCHLISTS = [
  { id: "index:nasdaq100", name: "Nasdaq 100" },
  { id: "index:sp500", name: "S&P 500" },
];

function normalizeTicker(input: string): string {
  return input.trim().toUpperCase();
}

type HealthSnapshot = {
  status?: string;
  latestScreenerDate?: string | null;
  dbError?: string | null;
};

export default function Home() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [section, setSection] = useState<WorkspaceSection>("market");
  const [searchValue, setSearchValue] = useState("");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartReloadNonce, setChartReloadNonce] = useState(0);
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
  const [scanFolders, setScanFolders] = useState<ScreenerFolder[]>([]);
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
  const [customPages, setCustomPages] = useState<CustomPage[]>(() => loadCustomPages());
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [dbHealthBanner, setDbHealthBanner] = useState<string | null>(null);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(DEFAULT_LISTS_OPEN_ID);
  const [newListDraft, setNewListDraft] = useState<{ id: string; name: string; nonce: number } | null>(null);
  const [focusTickerTrigger, setFocusTickerTrigger] = useState(0);
  const [headerSlotEl, setHeaderSlotEl] = useState<HTMLDivElement | null>(null);
  const [tableRowCountDisplay, setTableRowCountDisplay] = useState("");
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const secondaryPagesPrefetchedRef = useRef(false);
  const priorRailWidthBeforeInsightsRef = useRef<number | null>(null);
  const railWidthPxRef = useRef(0);
  const sectionHistoryRef = useRef<Record<string, string | null>>({});
  const lastScanOrListSymbolRef = useRef<string | null>(null);
  const pendingAutoSelectRef = useRef(false);
  const prevSectionRef = useRef<WorkspaceSection | null>(null);
  const { cycleTheme } = useTheme();

  const {
    chartLeftPx,
    setChartLeftPx,
    chartLeftSectorsPx,
    setChartLeftSectorsPx,
    railWidthPx,
    setRailWidthPx,
    rightRailHidden,
    setRightRailHidden,
    handleRightRailToggle,
  } = useLayoutPreferences();
  const chartHidden = section === "market" && marketSubTab === "monitor";
  const isSectorSection = section === "sectors-industries";
  const railSupportedSection = section === "scans" || section === "lists";
  const effectiveRightRailHidden = railSupportedSection ? rightRailHidden : true;

  const leftPanelMeasureRef = useRef<HTMLDivElement>(null);
  const sectionLayoutKeyRef = useRef<string>("");

  useLayoutEffect(() => {
    if (chartHidden) return;
    const key = `${section}:${marketSubTab}:${sectorSubTab}`;
    if (sectionLayoutKeyRef.current === key) return;
    sectionLayoutKeyRef.current = key;

    const railTotal = effectiveRightRailHidden ? 0 : RIGHT_DIVIDER_PX + railWidthPx;
    const run = () => {
      const el = leftPanelMeasureRef.current;
      const cw = typeof window !== "undefined" ? window.innerWidth : 1200;
      const maxLeft = Math.max(0, cw - railTotal - CHART_HANDLE_PX - MIN_CENTER_WIDTH_PX);
      let target = 520;
      if (el) {
        const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
        target = Math.ceil(w + 24);
      }
      if (section === "market") {
        if (marketSubTab === "monitor") target = Math.max(target, 720);
        target = Math.min(maxLeft, Math.max(380, target));
        setChartLeftPx(target);
      } else if (section === "sectors-industries") {
        target = Math.min(maxLeft, Math.max(520, Math.max(target, Math.round(cw * 0.44))));
        setChartLeftSectorsPx(target);
      } else {
        // Scans/lists table can report large intrinsic width; cap target to keep chart usable.
        target = Math.min(target, Math.round(cw * 0.58));
        target = Math.min(maxLeft, Math.max(260, target));
        setChartLeftPx(target);
      }
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(run));
    return () => cancelAnimationFrame(id);
  }, [
    section,
    marketSubTab,
    sectorSubTab,
    chartHidden,
    effectiveRightRailHidden,
    railWidthPx,
    setChartLeftPx,
    setChartLeftSectorsPx,
  ]);

  const activeChartLeft = isSectorSection
    ? (chartLeftSectorsPx < 0
        ? Math.round(Math.max(500, typeof window !== "undefined" ? window.innerWidth * 0.5 : 600))
        : chartLeftSectorsPx)
    : chartLeftPx;

  useEffect(() => {
    railWidthPxRef.current = railWidthPx;
  }, [railWidthPx]);

  const handleInsightsTabActiveChange = useCallback((active: boolean) => {
    if (!railSupportedSection) return;
    const maxByViewport = typeof window !== "undefined" ? Math.floor(window.innerWidth / 2) : 500;
    if (active) {
      if (priorRailWidthBeforeInsightsRef.current == null) {
        priorRailWidthBeforeInsightsRef.current = railWidthPxRef.current;
      }
      const expanded = Math.min(maxByViewport, Math.max(railWidthPxRef.current, 465));
      if (expanded !== railWidthPxRef.current) {
        setRailWidthPx(expanded);
      }
      return;
    }
    if (priorRailWidthBeforeInsightsRef.current == null) return;
    const restore = Math.max(DEFAULT_RAIL_WIDTH_PX, Math.min(maxByViewport, priorRailWidthBeforeInsightsRef.current));
    priorRailWidthBeforeInsightsRef.current = null;
    if (railWidthPxRef.current !== restore) {
      setRailWidthPx(restore);
    }
  }, [railSupportedSection, setRailWidthPx]);

  const handleChartLeftChange = useCallback(
    (px: number) => {
      if (isSectorSection) {
        setChartLeftSectorsPx(px);
      } else {
        setChartLeftPx(px);
      }
    },
    [isSectorSection, setChartLeftPx, setChartLeftSectorsPx]
  );

  useEffect(() => {
    const prev = prevSectionRef.current;
    prevSectionRef.current = section;
    if (section === "market" && prev != null && prev !== "market") {
      setSymbol(DEFAULT_SYMBOL);
    }
  }, [section]);

  useEffect(() => {
    if (section === "market") {
      setRightRailHidden(true);
    } else if (section === "sectors-industries") {
      setRightRailHidden(true);
    } else if (section === "scans" || section === "lists") {
      setRightRailHidden(false);
    }
  }, [section, setRightRailHidden]);

  useEffect(() => {
    if (section === "scans" && activeScanName) {
      sectionHistoryRef.current.scans = activeScanName;
    }
  }, [activeScanName, section]);

  useEffect(() => {
    if (section === "lists" && activeWatchlistId) {
      sectionHistoryRef.current.lists = activeWatchlistId;
    }
  }, [activeWatchlistId, section]);

  useEffect(() => {
    if ((section === "scans" || section === "lists") && symbol.trim()) {
      lastScanOrListSymbolRef.current = normalizeTicker(symbol);
    }
  }, [section, symbol]);

  useEffect(() => {
    if (!selectedInsightId) return;
    if (customPages.some((p) => p.id === selectedInsightId)) return;
    setSelectedInsightId(null);
  }, [customPages, selectedInsightId]);

  const { getCachedCandles, setCachedCandles, fetchCandlesFor } = useCandleCache();
  const shouldLoadRightRailData = section === "scans" || section === "lists";
  const rightRailSymbol = shouldLoadRightRailData ? symbol : "";
  const { data } = useStockData(rightRailSymbol);
  const { yearlyRows, quarterlyRows, sidebarLoading } = useFundamentals(rightRailSymbol);
  const { ownershipQuarters, fundCount } = useOwnership(rightRailSymbol);

  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const initFetchedRef = useRef(false);
  useEffect(() => {
    seedDefaultScreensIfEmpty();
    ensurePrebuiltScreensPresent();
    const loaded = loadScreens();
    setScreens(loaded);
    setScanFolders(loadFolders());
    if (loaded.length > 0) setActiveScanName(loaded[0].name);

    if (initFetchedRef.current) return;
    initFetchedRef.current = true;
    fetch(`/api/init?symbol=${encodeURIComponent(DEFAULT_SYMBOL)}`)
      .then((r) => r.json())
      .then((d) => {
        const raw = d.latestScreenerDate;
        if (raw) {
          const dt = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
          if (!isNaN(dt.getTime())) {
            const day = dt.getDate();
            const suffix = [11, 12, 13].includes(day) ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
            const month = dt.toLocaleDateString("en-US", { month: "long" });
            setLastUpdated(`${day}${suffix} ${month} ${dt.getFullYear()}`);
          }
        }
        if (d.candles && Array.isArray(d.candles) && d.candles.length > 0) {
          setCachedCandles(DEFAULT_SYMBOL, "daily", d.candles);
          setCandles(d.candles);
          setChartLoading(false);
        }
        if (d.stock) {
          window.__initStockData = d.stock;
          window.dispatchEvent(new CustomEvent("init-stock-data", { detail: d.stock }));
        }
      })
      .catch(() => {});
  }, [setCachedCandles]);

  useEffect(() => {
    if (secondaryPagesPrefetchedRef.current) return;
    secondaryPagesPrefetchedRef.current = true;

    const sectorTimeframes = ["week", "month", "quarter", "half_year", "year", "ytd", "day"];
    const sectorUrls = sectorTimeframes.map(
      (tf) => `/api/sectors-industries?indicesTimeframe=${tf}&sectorsTimeframe=${tf}&industriesTimeframe=${tf}`
    );
    const phase1Urls = ["/api/market-monitor"];
    const phase2Urls = sectorUrls;

    const prefetchPhase1 = () => {
      for (const url of phase1Urls) fetch(url).catch(() => {});
    };
    const prefetchPhase2 = () => {
      for (const url of phase2Urls) fetch(url).catch(() => {});
    };

    if (typeof window.requestIdleCallback === "function") {
      const id1 = window.requestIdleCallback(prefetchPhase1, { timeout: 2000 });
      const id2 = window.requestIdleCallback(prefetchPhase2, { timeout: 5000 });
      return () => { window.cancelIdleCallback(id1); window.cancelIdleCallback(id2); };
    }
    const t1 = window.setTimeout(prefetchPhase1, 1000);
    const t2 = window.setTimeout(prefetchPhase2, 2500);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);

  const handleSymbolSelect = useCallback((sym: string) => {
    if (!sym) return;
    const upper = normalizeTicker(sym);
    if (!upper) return;
    setSymbol(upper);
    setSearchValue("");
  }, []);

  const handleOrderedSymbolsChange = useCallback((symbols: string[]) => {
    const upper = symbols.map((s) => normalizeTicker(s)).filter((s) => s.length > 0);
    setScanSymbols(upper);
    if (pendingAutoSelectRef.current && upper.length > 0) {
      pendingAutoSelectRef.current = false;
      setSymbol(upper[0]);
    }
  }, []);

  const handleFlagChange = useCallback((flag: StockFlag | null) => {
    setFlags((prev) => {
      const next = { ...prev };
      const sym = symbol.toUpperCase();
      if (flag) next[sym] = flag;
      else delete next[sym];
      saveFlags(next);
      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent("stock-flags-changed", { detail: next }));
      });
      return next;
    });
  }, [symbol]);

  const handleDeleteWatchlist = useCallback((id: string) => {
    if (id === FULL_UNIVERSE_ID || id.startsWith("index:")) return;
    setWatchlists((prev) => {
      const next = prev.filter((l) => l.id !== id);
      queueMicrotask(() => saveWatchlists(next));
      return next;
    });
    if (activeWatchlistId === id) setActiveWatchlistId(DEFAULT_LISTS_OPEN_ID);
  }, [activeWatchlistId]);

  const handleReorderScans = useCallback((names: string[]) => {
    const current = loadScreens();
    const byName = new Map(current.map((sc) => [sc.name, sc]));
    const reordered: SavedScreen[] = [];
    const used = new Set<string>();
    for (const n of names) {
      const sc = byName.get(n);
      if (sc) {
        reordered.push(sc);
        used.add(sc.id);
      }
    }
    for (const sc of current) {
      if (!used.has(sc.id)) reordered.push(sc);
    }
    saveScreens(reordered);
  }, []);

  const handleReorderLists = useCallback((ids: string[]) => {
    const current = loadWatchlists();
    const byId = new Map(current.map((w) => [w.id, w]));
    const reordered: Watchlist[] = [];
    const used = new Set<string>();
    for (const id of ids) {
      if (id === FULL_UNIVERSE_ID) continue;
      const w = byId.get(id);
      if (w) {
        reordered.push(w);
        used.add(w.id);
      }
    }
    for (const w of current) {
      if (!used.has(w.id)) reordered.push(w);
    }
    saveWatchlists(reordered);
  }, []);

  const handleWatchlistMembershipSave = useCallback(
    (changes: { id: string; add: boolean }[]) => {
      if (changes.length === 0) return;
      setWatchlists((prev) => {
        const sym = symbol.toUpperCase();
        let next = prev;
        for (const { id, add } of changes) {
          next = next.map((l) => {
            if (l.id !== id) return l;
            const has = l.symbols.map((s) => s.toUpperCase()).includes(sym);
            if (add && !has) return { ...l, symbols: [...l.symbols, sym] };
            if (!add && has) return { ...l, symbols: l.symbols.filter((s) => s.toUpperCase() !== sym) };
            return l;
          });
        }
        saveWatchlists(next);
        window.dispatchEvent(new CustomEvent("stock-watchlists-changed", { detail: next }));
        return next;
      });
    },
    [symbol]
  );

  const watchlistPickerLists = useMemo(
    () =>
      watchlists.map((l) => ({
        id: l.id,
        name: l.name,
        hasSymbol: l.symbols.map((s) => s.toUpperCase()).includes(symbol.toUpperCase()),
      })),
    [watchlists, symbol]
  );

  const handleCreateInsight = useCallback((input: InsightInput) => {
    const created = createCustomPage(input);
    const refreshed = loadCustomPages();
    setCustomPages(refreshed);
    setSelectedInsightId(created.id);
  }, []);

  const handleUpdateInsight = useCallback((id: string, input: InsightInput) => {
    updateCustomPage(id, input);
    setCustomPages(loadCustomPages());
    setSelectedInsightId(id);
  }, []);

  const handleDeleteInsight = useCallback((id: string) => {
    deleteCustomPage(id);
    const refreshed = loadCustomPages();
    setCustomPages(refreshed);
    if (selectedInsightId === id) {
      setSelectedInsightId(null);
    }
  }, [selectedInsightId]);

  useEffect(() => {
    const onFlagsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object") setFlags(detail);
    };
    const onWatchlistsChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail)) setWatchlists(detail);
    };
    const onScreensChanged = (e: Event) => {
      const detail = (e as CustomEvent<SavedScreen[]>).detail;
      if (Array.isArray(detail)) setScreens(detail);
    };
    const onCustomPagesChanged = (e: Event) => {
      const detail = (e as CustomEvent<CustomPage[]>).detail;
      if (Array.isArray(detail)) setCustomPages(detail);
    };
    const onActiveScan = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string }>).detail;
      if (detail && typeof detail.name === "string") setActiveScanName(detail.name);
    };
    const onHydrationFallback = () => {
      setSyncNotice("Kept local scans/folders because cloud data was empty. Your local organization was preserved.");
    };
    window.addEventListener("stock-flags-changed", onFlagsChanged);
    window.addEventListener("stock-watchlists-changed", onWatchlistsChanged);
    window.addEventListener("stock-screens-changed", onScreensChanged);
    window.addEventListener("stock-custom-pages-changed", onCustomPagesChanged);
    window.addEventListener("stock-active-scan", onActiveScan);
    window.addEventListener("stock-hydration-fallback", onHydrationFallback);
    return () => {
      window.removeEventListener("stock-flags-changed", onFlagsChanged);
      window.removeEventListener("stock-watchlists-changed", onWatchlistsChanged);
      window.removeEventListener("stock-screens-changed", onScreensChanged);
      window.removeEventListener("stock-custom-pages-changed", onCustomPagesChanged);
      window.removeEventListener("stock-active-scan", onActiveScan);
      window.removeEventListener("stock-hydration-fallback", onHydrationFallback);
    };
  }, []);

  useEffect(() => {
    if (!syncNotice) return;
    const t = window.setTimeout(() => setSyncNotice(null), 7000);
    return () => window.clearTimeout(t);
  }, [syncNotice]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const controller = new AbortController();
    const cached = getCachedCandles(symbol, chartTimeframe);
    if (cached) {
      setCandles(cached);
      setChartLoading(false);
      return () => { cancelled = true; controller.abort(); };
    }
    setChartLoading(true);
    fetchCandlesFor(symbol, chartTimeframe, { signal: controller.signal })
      .then(async (rows) => {
        if (cancelled || controller.signal.aborted) return;
        if (Array.isArray(rows)) {
          setCandles(rows);
          return;
        }
        // One retry without abort-signal coupling to recover from transient fetch failures.
        const retryRows = await fetchCandlesFor(symbol, chartTimeframe);
        if (cancelled || controller.signal.aborted) return;
        if (Array.isArray(retryRows)) {
          setCandles(retryRows);
          return;
        }
        setCandles([]);
      })
      .finally(() => { if (!cancelled && !controller.signal.aborted) setChartLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [symbol, chartTimeframe, chartReloadNonce, fetchCandlesFor, getCachedCandles]);

  useEffect(() => {
    if (chartLoading) return;
    if (Array.isArray(candles) && candles.length > 0) {
      setDbHealthBanner(null);
      return;
    }
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((health: HealthSnapshot) => {
        if (cancelled) return;
        const degraded = health?.status === "degraded" || !health?.latestScreenerDate;
        if (!degraded) {
          setDbHealthBanner(null);
          return;
        }
        const detail = health?.dbError ? ` (${health.dbError})` : "";
        setDbHealthBanner(`Database on server is unhealthy. Chart data may be unavailable${detail}.`);
      })
      .catch(() => {
        if (!cancelled) {
          setDbHealthBanner("Unable to verify server database health. Chart data may be unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [candles, chartLoading, section]);

  const handleSearchSubmit = () => {
    const s = normalizeTicker(searchValue);
    if (s) {
      setSymbol(s);
      setSearchValue("");
    }
  };

  const currentStockFlag = flags[normalizeTicker(symbol)] ?? null;
  const chartWatchlists = useMemo(() => [
    { id: FULL_UNIVERSE_ID, name: "Full Universe" },
    ...DEFAULT_INDEX_WATCHLISTS,
    ...watchlists.map((l) => ({ id: l.id, name: l.name })),
  ], [watchlists]);
  const scanIndex = useMemo(() => scanSymbols.findIndex((s) => s === normalizeTicker(symbol)), [scanSymbols, symbol]);

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
      const idx = scanSymbols.findIndex((s) => s === normalizeTicker(symbol));
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
    { key: "d", description: "Daily chart", category: "chart" as const, action: () => setChartTimeframe("daily") },
    { key: "w", description: "Weekly chart", category: "chart" as const, action: () => setChartTimeframe("weekly") },
    { key: "m", description: "Monthly chart", category: "chart" as const, action: () => setChartTimeframe("monthly") },
  ], [shortcutsOpen, cycleTheme]));

  /* Stock data errors no longer block the full UI — the workspace, chart,
     and panels can still render. The right rail already handles missing data
     gracefully. Only show a non-blocking toast-style banner. */

  // ---- Panel contents ----

  const leftPanel = (
    <PanelErrorBoundary name="LeftPanel">
    <div
      ref={leftPanelMeasureRef}
      className="h-full min-h-0 flex flex-col overflow-hidden max-w-[min(92vw,1600px)] w-full"
      style={{ background: "var(--ws-bg2)" }}
    >
      {section === "market" ? (
        <MarketLeftPanel onSymbolSelect={handleSymbolSelect} selectedSymbol={symbol} activeTab={marketSubTab} />
      ) : section === "sectors-industries" ? (
        <SectorPerfPanel
          subTab={sectorSubTab}
          timeframe={sectorTimeframe}
          onTimeframeChange={setSectorTimeframe}
          onSymbolSelect={handleSymbolSelect}
          onDrillDown={(kind, value) => {
            pendingAutoSelectRef.current = true;
            setOpenToCollectionTrigger({ kind, value, nonce: Date.now() } as typeof openToCollectionTrigger);
            setSection("lists");
          }}
          headerActionsSlot={headerSlotEl}
          onRowCountChange={setTableRowCountDisplay}
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
          focusTickerTrigger={focusTickerTrigger}
          suppressAutoTickerFocus={newListDraft != null}
          onActiveWatchlistIdChange={setActiveWatchlistId}
          sectionMode={section === "scans" ? "scans" : "lists"}
          headerActionsSlot={headerSlotEl}
          onRowCountChange={setTableRowCountDisplay}
          rightRailHidden={effectiveRightRailHidden}
          setRightRailHidden={setRightRailHidden}
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
          onRetryLoad={() => {
            setChartLoading(true);
            setChartReloadNonce((n) => n + 1);
          }}
          timeframe={chartTimeframe}
          onTimeframeChange={setChartTimeframe}
          onVisibleDateRangeChange={section === "market" ? setVisibleDateRange : undefined}
          dualModeEnabled={false}
          showGlobalControls
          chartInstanceId="single"
          stockFlag={currentStockFlag}
          onFlagChange={handleFlagChange}
          watchlistPickerLists={watchlistPickerLists}
          onWatchlistMembershipSave={handleWatchlistMembershipSave}
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
    ) : railSupportedSection ? (
      <RightRail
        section={section}
        symbol={symbol}
        profile={data?.profile ?? null}
        nextEarnings={data?.nextEarnings}
        yearlyRows={yearlyRows}
        quarterlyRows={quarterlyRows}
        ownershipQuarters={ownershipQuarters}
        fundCount={fundCount}
        rsRank={data?.rsRank}
        industryRanks={data?.industryRanks}
        industryRankUniverse={data?.industryRankUniverse}
        dbProfileMetrics={data?.dbProfileMetrics}
        loading={sidebarLoading}
        insightPages={customPages}
        selectedInsightId={selectedInsightId}
        onInsightSelect={setSelectedInsightId}
        onInsightCreate={handleCreateInsight}
        onInsightUpdate={handleUpdateInsight}
        onInsightDelete={handleDeleteInsight}
        onInsightsTabActiveChange={handleInsightsTabActiveChange}
      />
    ) : (
      <div className="h-full" />
    )}
    </PanelErrorBoundary>
  );

  return (
    <div className="h-screen min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--ws-bg)" }}>
      <WorkspaceHeader
        section={section}
        onSectionChange={(s) => {
          setOpenToScreenerTrigger(null);
          setOpenToCollectionTrigger(null);
          setSection(s);

          if (s === "scans") {
            const restored = sectionHistoryRef.current.scans || activeScanName || screens[0]?.name || "";
            if (restored) {
              pendingAutoSelectRef.current = true;
              setActiveScanName(restored);
              setOpenToScreenerTrigger({ name: restored, nonce: Date.now() });
            }
          } else if (s === "lists") {
            const restored = sectionHistoryRef.current.lists || activeWatchlistId || DEFAULT_LISTS_OPEN_ID;
            pendingAutoSelectRef.current = true;
            setActiveWatchlistId(restored);
          }
        }}
        symbol={symbol}
        onSymbolChange={(next) => {
          const upper = normalizeTicker(next);
          if (!upper) return;
          setSymbol(upper);
        }}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={handleSearchSubmit}
        flags={flags}
        activeFlagFilter={activeFlagFilter}
        onFlagFilter={setActiveFlagFilter}
        onFlagListOpen={(flag) => {
          pendingAutoSelectRef.current = true;
          const flagListId = `__flag_${flag}__`;
          setActiveWatchlistId(flagListId);
          setOpenToScreenerTrigger(null);
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
        screens={screens}
        scanFolders={scanFolders}
        onScreensChange={(updated) => { setScreens(updated); saveScreens(updated); }}
        onFoldersChange={setScanFolders}
        activeScan={activeScanName}
        onScanChange={(name) => {
          pendingAutoSelectRef.current = true;
          setActiveScanName(name);
          setOpenToScreenerTrigger({ name, nonce: Date.now() });
        }}
        onNewScan={() => {
          setSection("scans");
          setOpenToScreenerTrigger({ name: "__new__", nonce: Date.now() });
        }}
        onEditScan={(name) => {
          setSection("scans");
          setOpenToScreenerTrigger({ name: `__edit__:${name}`, nonce: Date.now() });
        }}
        onCloneScan={(name) => {
          setSection("scans");
          setOpenToScreenerTrigger({ name: `__clone__:${name}`, nonce: Date.now() });
        }}
        onDeleteScan={(name) => {
          const screen = screens.find((s) => s.name === name);
          if (!screen) return;
          deleteScreen(screen.id);
          const updated = loadScreens();
          setScreens(updated);
          if (activeScanName === name) {
            setActiveScanName(updated[0]?.name ?? "");
          }
        }}
        watchlistNames={chartWatchlists}
        activeWatchlistId={activeWatchlistId}
        onWatchlistChange={(id) => {
          pendingAutoSelectRef.current = true;
          setActiveWatchlistId(id);
        }}
        onDeleteWatchlist={handleDeleteWatchlist}
        onReorderScans={handleReorderScans}
        onReorderLists={handleReorderLists}
        onRenameList={(id, newName) => {
          const updated = watchlists.map((w) => w.id === id ? { ...w, name: newName } : w);
          setWatchlists(updated);
          saveWatchlists(updated);
          window.dispatchEvent(new CustomEvent("stock-watchlists-changed", { detail: updated }));
        }}
        newListDraft={newListDraft}
        onNewListNameCommitted={() => {
          setNewListDraft(null);
          setFocusTickerTrigger((n) => n + 1);
        }}
        onNewListNameCancelled={() => {
          setNewListDraft(null);
        }}
        onCloneList={(id) => {
          const source = watchlists.find((w) => w.id === id);
          if (!source) return;
          pendingAutoSelectRef.current = true;
          const newList: Watchlist = { id: crypto.randomUUID(), name: `Copy of ${source.name}`, symbols: [...source.symbols] };
          const updated = [...watchlists, newList];
          setWatchlists(updated);
          saveWatchlists(updated);
          window.dispatchEvent(new CustomEvent("stock-watchlists-changed", { detail: updated }));
          setActiveWatchlistId(newList.id);
          setSection("lists");
        }}
        lastUpdated={lastUpdated ? `Updated ${lastUpdated}` : null}
        railWidthPx={effectiveRightRailHidden ? 0 : railWidthPx}
        rowCountDisplay={tableRowCountDisplay}
        headerActionsSlotRef={setHeaderSlotEl}
        onNewList={() => {
          const existing = new Set(watchlists.map((w) => w.name));
          let num = 1;
          while (existing.has(`List ${num}`)) num++;
          const newList: Watchlist = { id: crypto.randomUUID(), name: `List ${num}`, symbols: [] };
          const updated = [...watchlists, newList];
          setWatchlists(updated);
          saveWatchlists(updated);
          window.dispatchEvent(new CustomEvent("stock-watchlists-changed", { detail: updated }));
          setActiveWatchlistId(newList.id);
          setSection("lists");
          setNewListDraft({ id: newList.id, name: newList.name, nonce: Date.now() });
        }}
      />
      {dbHealthBanner && (
        <div
          className="px-3 py-1.5 text-xs"
          style={{
            background: "rgba(239,68,68,0.12)",
            borderTop: "1px solid rgba(239,68,68,0.35)",
            borderBottom: "1px solid rgba(239,68,68,0.35)",
            color: "var(--ws-red)",
          }}
        >
          {dbHealthBanner}
        </div>
      )}
      <WorkspaceLayout
        chartLeftPx={chartHidden ? 99999 : activeChartLeft}
        onChartLeftChange={chartHidden ? undefined : handleChartLeftChange}
        railWidthPx={railWidthPx}
        onRailWidthChange={setRailWidthPx}
        rightRailHidden={effectiveRightRailHidden}
        onToggleRightRail={railSupportedSection ? handleRightRailToggle : undefined}
        leftPanel={leftPanel}
        centerPanel={centerPanel}
        rightPanel={rightPanel}
      />
      {syncNotice && (
        <div
          className="fixed right-4 bottom-4 z-[12000] max-w-[420px] rounded-lg px-3 py-2 text-xs shadow-xl"
          style={{
            background: "rgba(0,229,204,0.12)",
            border: "1px solid rgba(0,229,204,0.4)",
            color: "var(--ws-text)",
            backdropFilter: "blur(6px)",
          }}
        >
          {syncNotice}
        </div>
      )}
      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
