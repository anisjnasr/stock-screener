/**
 * Massive (formerly Polygon.io) API client for stock and market data.
 * Base URL: https://api.polygon.io
 *
 * We only collect/use data for CS (common stock), ADRC (ADR common), and ETF.
 */

import { isUSMarketOpen } from "@/lib/market-hours";

const BASE = "https://api.polygon.io";

/** Ticker types we include in all data: common stock, ADR common, ETF. All others are ignored. */
export const ALLOWED_TICKER_TYPES = new Set<string>(["CS", "ADRC", "ETF"]);

export function isAllowedTickerType(type: string | undefined | null): boolean {
  return type != null && ALLOWED_TICKER_TYPES.has(String(type).toUpperCase());
}

function getApiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("MASSIVE_API_KEY is not set");
  return key;
}

function url(path: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ ...params, apiKey: getApiKey() });
  return `${BASE}${path}?${search}`;
}

async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status === 429) {
        const waitMs = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted retries");
}

const _dedup = new Map<string, Promise<Response>>();

async function fetchDedup(input: string): Promise<Response> {
  const existing = _dedup.get(input);
  if (existing) return existing.then((r) => r.clone());
  const promise = fetchWithRetry(input).finally(() => {
    setTimeout(() => _dedup.delete(input), 500);
  });
  _dedup.set(input, promise);
  return promise;
}

export type Quote = {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  open: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  volume: number;
  avgVolume?: number;
  marketCap?: number;
  priceAvg50?: number;
  priceAvg200?: number;
  previousClose: number;
};

export type Profile = {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  /** Ticker type from Polygon (e.g. CS, ADRC, ETF). Used to filter to allowed types only. */
  type?: string;
  mktCap?: number;
  description?: string;
  beta?: number;
  volAvg?: number;
  website?: string;
  exchange?: string;
  country?: string;
  ipoDate?: string;
  isEtf?: boolean;
  isFund?: boolean;
  isAdr?: boolean;
  floatShares?: number;
  sharesOutstanding?: number;
};

export type IncomeStatementLine = {
  date: string;
  calendarYear?: string;
  period?: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
};

export type InstitutionalHolder = {
  holder: string;
  dateReported: string;
  shares: number;
  percentage?: number;
};

export type NewsItem = {
  title: string;
  publishedDate: string;
  publishedUtc?: string;
  url: string;
  text?: string;
  symbol?: string;
  tickers?: string[];
  source?: string;
};

export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SearchSymbolResult = {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  /** Ticker type from Polygon (e.g. CS, ADRC, ETF). */
  type?: string;
};

export type EarningsCalendarItem = {
  date: string;
  symbol: string;
  eps?: number;
  revenue?: number;
};

/** Snapshot (single ticker) gives day bar + prevDay + lastTrade */
export async function fetchQuote(symbol: string): Promise<Quote | null> {
  const sym = symbol.toUpperCase();
  const res = await fetchDedup(url(`/v2/snapshot/locale/us/markets/stocks/tickers/${sym}`));
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ticker?: {
      ticker?: string;
      day?: { o?: number; h?: number; l?: number; c?: number; v?: number };
      prevDay?: { o?: number; h?: number; l?: number; c?: number; v?: number };
      lastTrade?: { p?: number; s?: number };
      min?: { av?: number };
    };
  };
  const t = data.ticker;
  if (!t) return null;
  const day = t.day ?? {};
  const prev = t.prevDay ?? {};
  const pickPositive = (...values: Array<number | undefined>): number | undefined =>
    values.find((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  const marketOpen = isUSMarketOpen();
  const dayClose = (typeof day.c === "number" && Number.isFinite(day.c) && day.c > 0) ? day.c : undefined;
  const prevDayClose = (typeof prev.c === "number" && Number.isFinite(prev.c) && prev.c > 0) ? prev.c : undefined;
  const lastTradePrice = (typeof t.lastTrade?.p === "number" && Number.isFinite(t.lastTrade.p) && t.lastTrade.p > 0) ? t.lastTrade.p : undefined;

  let displayPrice: number;
  let prevClose: number;

  if (marketOpen) {
    displayPrice = dayClose ?? prevDayClose ?? lastTradePrice ?? 0;
    prevClose = prevDayClose ?? displayPrice;
  } else {
    // Market closed: day = last completed session, prevDay = session before that.
    // If day.c is available and differs from prev.c, use them directly.
    // If day.c is zero/missing (e.g. weekend), Polygon hasn't rotated: use
    // lastTrade or prev.c as the display price, but we can't distinguish the
    // two sessions, so use prev.c for both (changePct will be 0).
    if (dayClose && prevDayClose && dayClose !== prevDayClose) {
      displayPrice = dayClose;
      prevClose = prevDayClose;
    } else if (dayClose && prevDayClose) {
      // Same value -- likely the snapshot hasn't rotated yet.
      // Use lastTrade as tiebreaker for display, keep prev as baseline.
      displayPrice = lastTradePrice ?? dayClose;
      prevClose = prevDayClose;
    } else {
      displayPrice = dayClose ?? prevDayClose ?? lastTradePrice ?? 0;
      prevClose = prevDayClose ?? displayPrice;
    }
  }

  const change = prevClose > 0 && displayPrice > 0 ? displayPrice - prevClose : 0;
  const changePct = prevClose > 0 && displayPrice > 0 ? (change / prevClose) * 100 : 0;
  return {
    symbol: t.ticker ?? sym,
    name: sym,
    price: displayPrice,
    changesPercentage: changePct,
    change,
    open: pickPositive(day.o, prev.o) ?? displayPrice,
    dayLow: pickPositive(day.l, prev.l) ?? displayPrice,
    dayHigh: pickPositive(day.h, prev.h) ?? displayPrice,
    yearHigh: pickPositive(day.h, prev.h) ?? displayPrice,
    yearLow: pickPositive(day.l, prev.l) ?? displayPrice,
    volume: pickPositive(day.v, prev.v) ?? 0,
    avgVolume: t.min?.av,
    marketCap: undefined,
    priceAvg50: undefined,
    priceAvg200: undefined,
    previousClose: prevClose,
  };
}

/** Ticker search: /v3/reference/tickers with search and market=stocks */
export async function fetchSearchSymbol(query: string): Promise<SearchSymbolResult[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetchDedup(
    url("/v3/reference/tickers", {
      search: q,
      market: "stocks",
      active: "true",
      limit: "20",
      order: "ticker",
      sort: "ticker",
    })
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{ ticker?: string; name?: string; type?: string; primary_exchange?: string; currency_name?: string }>;
  };
  const results = data.results ?? [];
  return results.map((r) => ({
    symbol: String(r.ticker ?? ""),
    name: r.name != null ? String(r.name) : undefined,
    type: r.type,
    exchange: r.primary_exchange != null ? String(r.primary_exchange) : undefined,
    currency: r.currency_name != null ? String(r.currency_name) : undefined,
  }));
}

/** Related tickers: /v1/related-companies/{ticker}, resolves names from local DB first */
export async function fetchRelatedTickers(
  symbol: string
): Promise<Array<{ symbol: string; name: string }>> {
  const sym = symbol.toUpperCase();
  const res = await fetchDedup(url(`/v1/related-companies/${sym}`));
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{ ticker?: string }>;
    stock_symbol?: string;
  };
  const tickers = (data.results ?? [])
    .map((r) => (r.ticker ?? "").toUpperCase())
    .filter((t) => t && t !== sym)
    .slice(0, 12);
  if (tickers.length === 0) return [];

  // Resolve names from local companies table to avoid N+1 API calls
  try {
    const { getCompanyName, getCompanyClassification } = await import("@/lib/screener-db-native");
    return tickers
      .map((t) => {
        const name = getCompanyName(t);
        const classification = getCompanyClassification(t);
        if (!name && !classification) return null;
        return { symbol: t, name: name ?? t };
      })
      .filter((r): r is { symbol: string; name: string } => r !== null);
  } catch {
    // Fallback: use first ticker's profile to check type, batch others
    const withNames = await Promise.all(
      tickers.map(async (t) => {
        const profile = await fetchProfile(t);
        return { symbol: t, name: profile?.companyName ?? t, type: profile?.type };
      })
    );
    return withNames.filter((r) => isAllowedTickerType(r.type)).map(({ symbol, name }) => ({ symbol, name }));
  }
}

/** Ticker details: /v3/reference/tickers/{ticker} */
export async function fetchProfile(symbol: string): Promise<Profile | null> {
  const sym = symbol.toUpperCase();
  const res = await fetchDedup(url(`/v3/reference/tickers/${sym}`));
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: {
      ticker?: string;
      name?: string;
      type?: string;
      description?: string;
      market_cap?: number;
      list_date?: string;
      primary_exchange?: string;
      sic_code?: string;
      sic_description?: string;
      share_class_shares_outstanding?: number;
      weighted_shares_outstanding?: number;
      homepage_url?: string;
    };
  };
  const r = data.results;
  if (!r) return null;
  return {
    symbol: r.ticker ?? sym,
    companyName: r.name ?? sym,
    sector: "",
    industry: r.sic_description ?? "",
    type: r.type,
    mktCap: r.market_cap,
    description: r.description,
    exchange: r.primary_exchange,
    ipoDate: r.list_date,
    sharesOutstanding: r.share_class_shares_outstanding ?? r.weighted_shares_outstanding,
    website: r.homepage_url,
  };
}

/** Income statements: /stocks/financials/v1/income-statements */
export async function fetchIncomeStatement(
  symbol: string,
  period: "annual" | "quarter"
): Promise<IncomeStatementLine[]> {
  const timeframe = period === "annual" ? "annual" : "quarterly";
  const sym = symbol.toUpperCase();

  function mapRows(
    results: Array<{
      period_end?: string;
      fiscal_year?: number;
      fiscal_quarter?: number;
      revenue?: number;
      consolidated_net_income_loss?: number;
      diluted_earnings_per_share?: number;
      basic_earnings_per_share?: number;
      timeframe?: string;
    }>
  ): IncomeStatementLine[] {
    return results.map((row) => ({
      date: row.period_end ?? "",
      calendarYear: row.fiscal_year != null ? String(row.fiscal_year) : undefined,
      period: row.fiscal_quarter != null ? `Q${row.fiscal_quarter}` : row.timeframe,
      revenue: row.revenue,
      netIncome: row.consolidated_net_income_loss,
      eps: row.diluted_earnings_per_share ?? row.basic_earnings_per_share,
    }));
  }

  // Try with timeframe filter first
  let res = await fetchWithRetry(
    url("/stocks/financials/v1/income-statements", {
      tickers: sym,
      "timeframe.any_of": timeframe,
      limit: "50",
      sort: "period_end.desc",
    })
  );
  if (res.ok) {
    const data = (await res.json()) as {
      results?: Array<{
        period_end?: string;
        fiscal_year?: number;
        fiscal_quarter?: number;
        revenue?: number;
        consolidated_net_income_loss?: number;
        diluted_earnings_per_share?: number;
        basic_earnings_per_share?: number;
        timeframe?: string;
      }>;
    };
    const results = data.results ?? [];
    if (results.length > 0) return mapRows(results);
  }

  // Fallback: fetch without timeframe filter and filter client-side
  res = await fetchWithRetry(
    url("/stocks/financials/v1/income-statements", {
      tickers: sym,
      limit: "100",
      sort: "period_end.desc",
    })
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      period_end?: string;
      fiscal_year?: number;
      fiscal_quarter?: number;
      revenue?: number;
      consolidated_net_income_loss?: number;
      diluted_earnings_per_share?: number;
      basic_earnings_per_share?: number;
      timeframe?: string;
    }>;
  };
  const results = data.results ?? [];
  const filtered = results.filter((row) => (row.timeframe ?? "").toLowerCase() === timeframe);
  return mapRows(filtered.length > 0 ? filtered : results);
}

/**
 * Institutional holders: not provided by Massive/Polygon.
 * Use SEC EDGAR 13F for fund ownership (see PROJECT_PLAN.md).
 */
export async function fetchInstitutionalHolders(_symbol: string): Promise<InstitutionalHolder[]> {
  return [];
}

/** News: /v2/reference/news */
export async function fetchStockNews(symbol: string, limit = 15): Promise<NewsItem[]> {
  const res = await fetchDedup(
    url("/v2/reference/news", {
      ticker: symbol.toUpperCase(),
      limit: String(Math.min(limit, 100)),
      order: "descending",
      sort: "published_utc",
    })
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      published_utc?: string;
      article_url?: string;
      description?: string;
      tickers?: string[];
      publisher?: { name?: string };
    }>;
  };
  const results = data.results ?? [];
  const sym = symbol.toUpperCase();
  return results
    .slice(0, limit * 2)
    .filter((a) => {
      const tickers = (a.tickers ?? []).map((t) => String(t).toUpperCase());
      return tickers.length === 0 || tickers.includes(sym);
    })
    .slice(0, limit)
    .map((a) => ({
      title: String(a.title ?? ""),
      publishedDate: a.published_utc ?? "",
      publishedUtc: a.published_utc ?? "",
      url: a.article_url ?? "#",
      text: a.description,
      symbol: a.tickers?.[0],
      tickers: a.tickers?.map((t) => String(t).toUpperCase()),
      source: a.publisher?.name,
    }));
}

/**
 * Earnings calendar: Benzinga partner API GET /benzinga/v1/earnings
 */
export async function fetchEarningsCalendar(
  symbol: string,
  from: string,
  to: string
): Promise<EarningsCalendarItem[]> {
  const res = await fetchDedup(
    url("/benzinga/v1/earnings", {
      ticker: symbol.toUpperCase(),
      "date.gte": from,
      "date.lte": to,
      limit: "20",
      sort: "date.asc",
    })
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      date?: string;
      ticker?: string;
      actual_eps?: number;
      actual_revenue?: number;
    }>;
  };
  const results = data.results ?? [];
  return results.map((e) => ({
    date: e.date ?? "",
    symbol: e.ticker ?? symbol.toUpperCase(),
    eps: e.actual_eps,
    revenue: e.actual_revenue,
  }));
}

/** Daily aggregates: /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to} */
/** Fetches in chunks to get full history (API returns max 5000 bars per request). */
export async function fetchHistoricalDaily(
  symbol: string,
  from?: string,
  to?: string
): Promise<Candle[]> {
  const sym = symbol.toUpperCase();
  const toDate = to ?? new Date().toISOString().slice(0, 10);
  const fromDate = from ?? (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const parseResponse = (data: {
    results?: Array<{ t?: number; o?: number; h?: number; l?: number; c?: number; v?: number }>;
  }): Candle[] => {
    const results = data.results ?? [];
    return results.map((bar) => ({
      date: new Date(bar.t!).toISOString().slice(0, 10),
      open: bar.o ?? 0,
      high: bar.h ?? 0,
      low: bar.l ?? 0,
      close: bar.c ?? 0,
      volume: bar.v ?? 0,
    }));
  };

  const allBars: Candle[] = [];
  const chunkYears = 2;
  let chunkStart = new Date(fromDate + "T12:00:00Z");
  const endDate = new Date(toDate + "T12:00:00Z");

  while (chunkStart.getTime() < endDate.getTime()) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCFullYear(chunkEnd.getUTCFullYear() + chunkYears);
    if (chunkEnd.getTime() > endDate.getTime()) chunkEnd.setTime(endDate.getTime());
    const chunkFromStr = chunkStart.toISOString().slice(0, 10);
    const chunkToStr = chunkEnd.toISOString().slice(0, 10);

    const res = await fetchWithRetry(
      url(`/v2/aggs/ticker/${sym}/range/1/day/${chunkFromStr}/${chunkToStr}`, {
        adjusted: "true",
        sort: "asc",
        limit: "5000",
      })
    );
    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{ t?: number; o?: number; h?: number; l?: number; c?: number; v?: number }>;
      };
      const chunk = parseResponse(data);
      for (const bar of chunk) allBars.push(bar);
    }
    chunkStart = new Date(chunkEnd.getTime());
    chunkStart.setUTCDate(chunkStart.getUTCDate() + 1);
  }

  allBars.sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set<string>();
  return allBars.filter((b) => {
    if (seen.has(b.date)) return false;
    seen.add(b.date);
    return true;
  });
}
