"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Header, { HeaderPage } from "@/components/Header";
import StockChart from "@/components/StockChart";
import LeftSidebar from "@/components/LeftSidebar";
import QuarterlyBox from "@/components/QuarterlyBox";
import NewsSidebar from "@/components/NewsSidebar";
import WatchlistPanel from "@/components/WatchlistPanel";
import MarketMonitorTable from "@/components/MarketMonitorTable";
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

type IncomeLine = {
  date: string;
  calendarYear?: string;
  period?: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
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
  const [newsOpen, setNewsOpen] = useState(true);
  const [watchlistHeightPx, setWatchlistHeightPx] = useState(32);
  const [chartTimeframe, setChartTimeframe] = useState<"daily" | "weekly" | "monthly">("daily");
  const [dailyCandlesForAvg, setDailyCandlesForAvg] = useState<Candle[] | null>(null);
  const [relatedStocks, setRelatedStocks] = useState<Array<{ symbol: string; name: string }>>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [openToRelatedListTrigger, setOpenToRelatedListTrigger] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("stock-research-news-sidebar-open");
      if (stored !== null) setNewsOpen(stored === "true");
      setWatchlistHeightPx(loadPanelHeightPx());
    } catch {
      /* ignore */
    }
  }, []);
  const handleWatchlistHeightChange = useCallback((px: number) => {
    setWatchlistHeightPx(px);
    savePanelHeightPx(px);
  }, []);
  const handleNewsToggle = useCallback(() => {
    setNewsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("stock-research-news-sidebar-open", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
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

  useEffect(() => {
    if (!symbol) return;
    setChartLoading(true);
    const to = new Date();
    const from = new Date();
    // Request full history (API returns up to 5000 bars): ~20 years for daily, same range for weekly/monthly
    const yearsBack = 20;
    from.setFullYear(from.getFullYear() - yearsBack);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    fetch(
      `/api/candles?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&interval=${chartTimeframe}`
    )
      .then((res) => res.json())
      .then((d) => {
        setCandles(Array.isArray(d) ? d : null);
      })
      .catch(() => setCandles(null))
      .finally(() => setChartLoading(false));
  }, [symbol, chartTimeframe]);

  useEffect(() => {
    if (!symbol) return;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 45);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    fetch(
      `/api/candles?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&interval=daily`
    )
      .then((res) => res.json())
      .then((d) => {
        setDailyCandlesForAvg(Array.isArray(d) ? d : null);
      })
      .catch(() => setDailyCandlesForAvg(null));
  }, [symbol]);

  const avgVolume30d = useMemo(() => {
    if (!dailyCandlesForAvg || dailyCandlesForAvg.length === 0) return undefined;
    const sorted = [...dailyCandlesForAvg].sort((a, b) => a.date.localeCompare(b.date));
    const last30 = sorted.slice(-30);
    const sum = last30.reduce((s, c) => s + c.volume, 0);
    return last30.length > 0 ? Math.round(sum / last30.length) : undefined;
  }, [dailyCandlesForAvg]);

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

  const ownershipData = ownership && typeof ownership === "object" && "quarters" in ownership ? ownership : null;
  const fundCount = ownershipData?.latestFundCount ?? (Array.isArray(ownership) ? ownership.length : 0);
  const fundReportDate = ownershipData?.latestReportDate ?? (Array.isArray(ownership)
    ? (ownership as { dateReported?: string }[]).map((o) => o.dateReported).filter(Boolean).sort().reverse()[0] ?? null
    : null);
  const topHolders = ownershipData?.topHolders ?? [];

  const handleSearchSubmit = () => {
    const s = searchValue.trim().toUpperCase();
    if (s) setSymbol(s);
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
        atrPct={atrPct}
        avgVolume30d={avgVolume30d}
        computed52WHigh={computed52WHigh}
        lastUpdate={lastUpdate}
        onSymbolChange={setSymbol}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={handleSearchSubmit}
        loading={loading}
        currentPage={page}
        onPageChange={setPage}
      />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden p-0 gap-0 bg-white dark:bg-zinc-900">
        {page === "market-monitor" ? (
          <MarketMonitorTable />
        ) : (
          <>
        <div className="min-w-0 flex-1 min-h-0 overflow-hidden border-b border-zinc-200 dark:border-zinc-800 flex flex-col">
          <div className="flex flex-1 min-h-0 min-w-0 gap-0 overflow-hidden">
            <LeftSidebar
              profile={data?.profile ?? null}
              nextEarnings={data?.nextEarnings}
              yearly={yearlyRows}
              relatedStocks={relatedStocks}
              onSymbolSelect={(sym) => {
                setSymbol(sym);
                setSearchValue(sym);
              }}
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
              loading={sidebarLoading}
            />
            <div className="flex flex-1 min-w-0 min-h-0 border-l border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
                <StockChart
                  symbol={symbol}
                  data={candles}
                  loading={chartLoading}
                  timeframe={chartTimeframe}
                  onTimeframeChange={setChartTimeframe}
                />
                <QuarterlyBox rows={quarterlyRows} loading={quarterlyLoading} />
              </div>
              <div
                className={`flex min-h-0 shrink-0 border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 ${newsOpen ? "w-[18rem]" : "w-6"}`}
              >
                <button
                  type="button"
                  onClick={handleNewsToggle}
                  className="w-6 shrink-0 flex items-center justify-center border-r border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 self-stretch"
                  aria-expanded={newsOpen}
                  aria-label={newsOpen ? "Collapse news" : "Expand news"}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    className={`${newsOpen ? "" : "rotate-180"}`}
                    aria-hidden
                  >
                    <path
                      d="M3 3.5L13 8l-10 4.5V3.5z"
                      fill="none"
                      stroke="#9ca3af"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {newsOpen && (
                  <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
                    <NewsSidebar symbol={symbol} />
                  </div>
                )}
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
            onSymbolSelect={(sym) => {
              setSymbol(sym);
              setSearchValue(sym);
            }}
            relatedStocksList={
              relatedStocks.length > 0 && symbol
                ? { title: `Related to ${symbol}`, symbols: relatedStocks.map((r) => r.symbol) }
                : null
            }
            openToRelatedListTrigger={openToRelatedListTrigger ?? undefined}
          />
        </div>
          </>
        )}
      </main>
    </div>
  );
}
