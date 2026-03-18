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
import { loadPanelHeightPx, savePanelHeightPx } from "@/lib/watchlist-storage";

const DEFAULT_SYMBOL = "AAPL";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CachedCandlesEntry = {
  data: Candle[];
  expiresAt: number;
};

const CANDLE_CACHE_TTL_MS = 5 * 60 * 1000;
const CANDLE_CACHE_MAX_ENTRIES = 100;
const PREFETCH_NEIGHBOR_COUNT = 3;
const WATCHLIST_PANEL_USER_SET_KEY = "stock-research-watchlist-panel-user-set";

function candlesCacheKey(symbol: string, timeframe: ChartTimeframe): string {
  return `${symbol.toUpperCase()}:${timeframe}`;
}

type IncomeLine = {
  date: string;
  calendarYear?: string;
  period?: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
};
type OwnershipQuarter = {
  report_date: string;
  num_funds: number | null;
  num_funds_change: number | null;
  top_holders: Array<{ name: string; value?: number; shares?: number | null }>;
};

type StockData = {
  quote: {
    symbol: string;
    name: string;
    price: number;
    changesPercentage: number;
    change: number;
    volume: number;
    yearHigh?: number;
    yearLow?: number;
    avgVolume?: number;
    marketCap?: number;
    atrPct21d?: number | null;
    off52WHighPct?: number | null;
  };
  profile?: {
    companyName: string;
    sector: string;
    industry: string;
    mktCap?: number;
  };
  nextEarnings?: string;
};

export default function Home() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [page, setPage] = useState<HeaderPage>("home");
  const [searchValue, setSearchValue] = useState("");
  const [data, setData] = useState<StockData | null>(null);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [annualFundamentals, setAnnualFundamentals] = useState<IncomeLine[]>([]);
  const [quarterlyFundamentals, setQuarterlyFundamentals] = useState<IncomeLine[]>([]);
  const [ownership, setOwnership] = useState<{
    quarters?: Array<{ report_date: string; num_funds: number | null; num_funds_change: number | null; top_holders: Array<{ name: string; value?: number; shares?: number | null }> }>;
    latestFundCount?: number;
    latestReportDate?: string | null;
    topHolders?: Array<{ name: string; value?: number; shares?: number | null }>;
  } | { dateReported?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [quarterlyLoading, setQuarterlyLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlistHeightPx, setWatchlistHeightPx] = useState(32);
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("daily");
  const [dualChartMode, setDualChartMode] = useState(false);
  const [syncCrosshair, setSyncCrosshair] = useState(true);
  const [dualLeftTimeframe, setDualLeftTimeframe] = useState<ChartTimeframe>("weekly");
  const [dualRightTimeframe, setDualRightTimeframe] = useState<ChartTimeframe>("daily");
  const [dualLeftCandles, setDualLeftCandles] = useState<Candle[] | null>(null);
  const [dualRightCandles, setDualRightCandles] = useState<Candle[] | null>(null);
  const [dualLeftLoading, setDualLeftLoading] = useState(true);
  const [dualRightLoading, setDualRightLoading] = useState(true);
  const [dailyCandlesForAvg, setDailyCandlesForAvg] = useState<Candle[] | null>(null);
  const [relatedStocks, setRelatedStocks] = useState<Array<{ symbol: string; name: string }>>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [dbUpdateCompletedAt, setDbUpdateCompletedAt] = useState<Date | null>(null);
  const [openToRelatedListTrigger, setOpenToRelatedListTrigger] = useState<number | null>(null);
  const [openToCollectionTrigger, setOpenToCollectionTrigger] = useState<{
    kind: "sector" | "industry" | "theme" | "index";
    value: string;
    nonce: number;
  } | null>(null);
  const [leftSidebarHidden, setLeftSidebarHidden] = useState(false);
  const [quarterlyHidden, setQuarterlyHidden] = useState(false);
  const [scanSymbols, setScanSymbols] = useState<string[]>([]);
  const candlesCacheRef = useRef<Map<string, CachedCandlesEntry>>(new Map());
  const prefetchInFlightRef = useRef<Map<string, Promise<Candle[] | null>>>(new Map());
  const secondaryPagesPrefetchedRef = useRef(false);

  useEffect(() => {
    try {
      const userSet = localStorage.getItem(WATCHLIST_PANEL_USER_SET_KEY) === "true";
      setWatchlistHeightPx(userSet ? loadPanelHeightPx() : 32);
      const storedLeft = localStorage.getItem("stock-research-left-sidebar-hidden");
      if (storedLeft !== null) setLeftSidebarHidden(storedLeft === "true");
      const storedQuarterly = localStorage.getItem("stock-research-quarterly-hidden");
      if (storedQuarterly !== null) setQuarterlyHidden(storedQuarterly === "true");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const res = await fetch("/api/health");
        const json = (await res.json()) as { dbUpdatedAt?: string | null };
        if (cancelled) return;
        if (json?.dbUpdatedAt) {
          const d = new Date(String(json.dbUpdatedAt));
          setDbUpdateCompletedAt(Number.isNaN(d.getTime()) ? null : d);
        } else {
          setDbUpdateCompletedAt(null);
        }
      } catch {
        if (!cancelled) setDbUpdateCompletedAt(null);
      }
    };
    fetchHealth();
    return () => {
      cancelled = true;
    };
  }, []);

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
        fetch(url).catch(() => {
          /* ignore warmup failures */
        });
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);
  const handleWatchlistHeightChange = useCallback((px: number) => {
    setWatchlistHeightPx(px);
    savePanelHeightPx(px);
    try {
      localStorage.setItem(WATCHLIST_PANEL_USER_SET_KEY, "true");
    } catch {
      /* ignore */
    }
  }, []);
  const handleLeftSidebarToggle = useCallback(() => {
    setLeftSidebarHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("stock-research-left-sidebar-hidden", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const handleQuarterlyToggle = useCallback(() => {
    setQuarterlyHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("stock-research-quarterly-hidden", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const getCachedCandles = useCallback((sym: string, tf: ChartTimeframe): Candle[] | null => {
    const key = candlesCacheKey(sym, tf);
    const entry = candlesCacheRef.current.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      candlesCacheRef.current.delete(key);
      return null;
    }
    // Refresh LRU order.
    candlesCacheRef.current.delete(key);
    candlesCacheRef.current.set(key, entry);
    return entry.data;
  }, []);

  const setCachedCandles = useCallback((sym: string, tf: ChartTimeframe, data: Candle[]) => {
    const key = candlesCacheKey(sym, tf);
    candlesCacheRef.current.delete(key);
    candlesCacheRef.current.set(key, {
      data,
      expiresAt: Date.now() + CANDLE_CACHE_TTL_MS,
    });
    while (candlesCacheRef.current.size > CANDLE_CACHE_MAX_ENTRIES) {
      const oldest = candlesCacheRef.current.keys().next().value;
      if (!oldest) break;
      candlesCacheRef.current.delete(oldest);
    }
  }, []);

  const handleSymbolSelect = useCallback((sym: string) => {
    setSymbol(sym.toUpperCase());
    setSearchValue("");
  }, []);

  const handleOrderedSymbolsChange = useCallback((symbols: string[]) => {
    const next = symbols
      .map((s) => s.toUpperCase())
      .filter((s) => s.length > 0);
    setScanSymbols(next);
  }, []);

  const fetchStock = useCallback(async (sym: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load");
      }
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStock(symbol);
  }, [symbol, fetchStock]);

  const fetchCandlesFor = useCallback(
    async (
      sym: string,
      tf: ChartTimeframe,
      opts?: { signal?: AbortSignal }
    ): Promise<Candle[] | null> => {
      const key = candlesCacheKey(sym, tf);
      const cached = getCachedCandles(sym, tf);
      if (cached) return cached;
      if (!opts?.signal) {
        const inFlight = prefetchInFlightRef.current.get(key);
        if (inFlight) return inFlight;
      }
      const run = async (): Promise<Candle[] | null> => {
        try {
          const to = new Date();
          const from = new Date();
          from.setFullYear(from.getFullYear() - 20);
          const fromStr = from.toISOString().slice(0, 10);
          const toStr = to.toISOString().slice(0, 10);
          const res = await fetch(
            `/api/candles?symbol=${encodeURIComponent(sym)}&from=${fromStr}&to=${toStr}&interval=${tf}`,
            { signal: opts?.signal }
          );
          const d = await res.json();
          if (!Array.isArray(d)) return null;
          setCachedCandles(sym, tf, d);
          return d;
        } catch {
          return null;
        } finally {
          if (!opts?.signal) prefetchInFlightRef.current.delete(key);
        }
      };
      if (!opts?.signal) {
        const task = run();
        prefetchInFlightRef.current.set(key, task);
        return task;
      }
      try {
        return await run();
      } catch {
        return null;
      }
    },
    [getCachedCandles, setCachedCandles]
  );

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
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, chartTimeframe, fetchCandlesFor, getCachedCandles]);

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
      .then((rows) => {
        if (!cancelled && !controller.signal.aborted) setDualLeftCandles(rows);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setDualLeftLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dualChartMode, symbol, dualLeftTimeframe, fetchCandlesFor, getCachedCandles]);

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
      .then((rows) => {
        if (!cancelled && !controller.signal.aborted) setDualRightCandles(rows);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setDualRightLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dualChartMode, symbol, dualRightTimeframe, fetchCandlesFor, getCachedCandles]);

  const handleToggleDualChartMode = useCallback(() => {
    setDualChartMode((prev) => {
      const next = !prev;
      if (next) {
        // Prime dual panes so chart area never looks "blank" while fetches resolve.
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

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const controller = new AbortController();
    fetchCandlesFor(symbol, "daily", { signal: controller.signal })
      .then((rows) => {
        if (!cancelled && !controller.signal.aborted) setDailyCandlesForAvg(rows);
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setDailyCandlesForAvg(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, fetchCandlesFor]);

  const avgVolume30d = useMemo(() => {
    if (!dailyCandlesForAvg || dailyCandlesForAvg.length === 0) return undefined;
    const sorted = [...dailyCandlesForAvg].sort((a, b) => a.date.localeCompare(b.date));
    const last30 = sorted.slice(-30);
    const sum = last30.reduce((s, c) => s + c.volume, 0);
    return last30.length > 0 ? Math.round(sum / last30.length) : undefined;
  }, [dailyCandlesForAvg]);

  const scanIndex = useMemo(
    () => scanSymbols.findIndex((s) => s === symbol.toUpperCase()),
    [scanSymbols, symbol]
  );

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
      timeframes.forEach((tf) => {
        void fetchCandlesFor(sym, tf);
      });
    });
  }, [
    page,
    scanIndex,
    scanSymbols,
    dualChartMode,
    dualLeftTimeframe,
    dualRightTimeframe,
    chartTimeframe,
    fetchCandlesFor,
  ]);

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

  useEffect(() => {
    if (!symbol) return;
    setSidebarLoading(true);
    Promise.all([
      fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}&period=annual`).then((r) =>
        r.json().then((d) => (Array.isArray(d) ? d : []))
      ),
      fetch(`/api/ownership?symbol=${encodeURIComponent(symbol)}`).then((r) =>
        r.json().then((d) => (d && typeof d === "object" && "quarters" in d ? d : Array.isArray(d) ? d : {}))
      ),
    ])
      .then(([fund, own]) => {
        setAnnualFundamentals(fund);
        setOwnership(own ?? {});
      })
      .catch(() => {
        setAnnualFundamentals([]);
        setOwnership([]);
      })
      .finally(() => setSidebarLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    setQuarterlyLoading(true);
    fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}&period=quarter`)
      .then((r) => r.json())
      .then((d) => setQuarterlyFundamentals(Array.isArray(d) ? d : []))
      .catch(() => setQuarterlyFundamentals([]))
      .finally(() => setQuarterlyLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    fetch(`/api/related-stocks?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setRelatedStocks(d) : setRelatedStocks([])))
      .catch(() => setRelatedStocks([]));
  }, [symbol]);

  const yearlyRows = useMemo(() => {
    const lines = annualFundamentals as IncomeLine[];
    if (!lines.length) return [];
    const byYear = lines
      .map((l) => ({
        year: l.calendarYear ?? l.date?.slice(0, 4) ?? "",
        eps: l.eps ?? null,
        sales: l.revenue ?? null,
      }))
      .filter((r) => r.year)
      .sort((a, b) => b.year.localeCompare(a.year));
    return byYear.map((row, i) => {
      const prev = byYear[i + 1];
      const epsGrowth =
        row.eps != null && prev?.eps != null && prev.eps !== 0
          ? ((row.eps - prev.eps) / Math.abs(prev.eps)) * 100
          : null;
      const salesGrowth =
        row.sales != null && prev?.sales != null && prev.sales !== 0
          ? ((row.sales - prev.sales) / Math.abs(prev.sales)) * 100
          : null;
      return {
        year: row.year,
        eps: row.eps,
        epsGrowth,
        sales: row.sales,
        salesGrowth,
      };
    });
  }, [annualFundamentals]);

  const quarterlyRows = useMemo(() => {
    const lines = quarterlyFundamentals as IncomeLine[];
    if (!lines.length) return [];
    const withPeriod = lines.map((l) => ({
      date: l.date,
      period: l.period ?? l.date ?? "",
      eps: l.eps ?? null,
      sales: l.revenue ?? null,
    }));
    const sorted = withPeriod
      .filter((r) => r.period)
      .sort((a, b) => (b.date || b.period).localeCompare(a.date || a.period));
    return sorted.map((row, i) => {
      const prev = sorted[i + 1];
      // For the most recent quarter (i === 0), use YoY growth vs same quarter prior year
      const priorYearSameQuarter =
        row.date &&
        sorted.find(
          (s) =>
            s.date &&
            s.date !== row.date &&
            s.date.startsWith(String(Number(row.date.slice(0, 4)) - 1)) &&
            s.date.slice(5, 7) === row.date.slice(5, 7)
        );
      const useYoY = i === 0 && priorYearSameQuarter;
      const compareRow = useYoY ? priorYearSameQuarter : prev;
      const epsGrowth =
        row.eps != null && compareRow?.eps != null && compareRow.eps !== 0
          ? ((row.eps - compareRow.eps) / Math.abs(compareRow.eps)) * 100
          : null;
      const salesGrowth =
        row.sales != null && compareRow?.sales != null && compareRow.sales !== 0
          ? ((row.sales - compareRow.sales) / Math.abs(compareRow.sales)) * 100
          : null;
      return {
        period: row.period,
        date: row.date,
        eps: row.eps,
        epsGrowth,
        sales: row.sales,
        salesGrowth,
      };
    });
  }, [quarterlyFundamentals]);

  const computed52WHigh = useMemo(() => {
    if (!candles || candles.length === 0) return undefined;
    const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
    const n = chartTimeframe === "daily" ? 252 : chartTimeframe === "weekly" ? 52 : 12;
    const slice = sorted.slice(-n);
    if (slice.length === 0) return undefined;
    return Math.max(...slice.map((c) => c.high));
  }, [candles, chartTimeframe]);

  const atrPct = useMemo(() => {
    const list = candles;
    if (!list || list.length < 22) return undefined;
    const byDate = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const last22 = byDate.slice(-22);
    const trs: number[] = [];
    for (let i = 1; i < last22.length; i++) {
      const high = last22[i].high;
      const low = last22[i].low;
      const prevClose = last22[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }
    const atr21 = trs.slice(-21).reduce((s, t) => s + t, 0) / 21;
    const latestClose = last22[last22.length - 1].close;
    if (!latestClose) return undefined;
    return (atr21 / latestClose) * 100;
  }, [candles]);
  const computed52WHighEffective = data?.quote?.yearHigh ?? computed52WHigh;
  const avgVolume30dEffective = data?.quote?.avgVolume ?? avgVolume30d;
  const atrPctEffective = data?.quote?.atrPct21d ?? atrPct;

  const ownershipData = ownership && typeof ownership === "object" && "quarters" in ownership ? ownership : null;
  const fundCount = ownershipData?.latestFundCount ?? (Array.isArray(ownership) ? ownership.length : 0);
  const fundReportDate = ownershipData?.latestReportDate ?? (Array.isArray(ownership)
    ? (ownership as { dateReported?: string }[]).map((o) => o.dateReported).filter(Boolean).sort().reverse()[0] ?? null
    : null);
  const topHolders = ownershipData?.topHolders ?? [];
  const ownershipQuarters = useMemo(() => {
    const rows = (ownershipData?.quarters ?? []) as OwnershipQuarter[];
    return [...rows]
      .filter((r) => !!r?.report_date)
      .sort((a, b) => b.report_date.localeCompare(a.report_date))
      .slice(0, 8);
  }, [ownershipData]);

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
        dbUpdateCompletedAt={dbUpdateCompletedAt}
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
                if (h <= 32) {
                  savePanelHeightPx(320);
                  return 320;
                }
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
            <div
              className={`relative min-h-0 shrink-0 overflow-hidden border-r border-zinc-200 dark:border-zinc-700 transition-[width] duration-300 ease-in-out ${
                leftSidebarHidden ? "w-0" : "w-[22rem]"
              }`}
            >
              <div
                className={`h-full min-h-0 transition-transform duration-300 ease-in-out ${
                  leftSidebarHidden ? "-translate-x-full" : "translate-x-0"
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
                            if (h <= 32) {
                              savePanelHeightPx(320);
                              return 320;
                            }
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
                      if (h <= 32) {
                        savePanelHeightPx(320);
                        return 320;
                      }
                      return h;
                    });
                    setOpenToCollectionTrigger({ kind: "sector", value: trimmed, nonce: Date.now() });
                  }}
                  onOpenIndustryInWatchlist={(industry) => {
                    const trimmed = String(industry ?? "").trim();
                    if (!trimmed) return;
                    setWatchlistHeightPx((h) => {
                      if (h <= 32) {
                        savePanelHeightPx(320);
                        return 320;
                      }
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
                    <div className="w-[86px] shrink-0" aria-hidden />
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
    </div>
  );
}
