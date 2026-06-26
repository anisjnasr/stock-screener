/**
 * Polygon ("Massive") helpers specific to the Small-Cap DD panel.
 * Self-contained fetch (reuses MASSIVE_API_KEY) so we can read fields the shared
 * massive.ts client does not expose (cik, splits, short interest, raw snapshot).
 */

import type { DDNewsItem, DDSplit } from "./types";

const BASE = "https://api.polygon.io";

function apiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("MASSIVE_API_KEY is not set");
  return key;
}

function buildUrl(path: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ ...params, apiKey: apiKey() });
  return `${BASE}${path}?${search}`;
}

const FETCH_TIMEOUT_MS = 15_000;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number; data: T | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export type DDSnapshot = {
  found: boolean;
  price: number | null;
  prev_close: number | null;
  gap_pct: number | null;
};

/** §5.1 — price & gap from the single-ticker snapshot (lastTrade.p vs prevDay.c). */
export async function fetchDDSnapshot(ticker: string, signal?: AbortSignal): Promise<DDSnapshot> {
  const { ok, data } = await getJson<{
    ticker?: {
      lastTrade?: { p?: number };
      prevDay?: { c?: number };
      day?: { c?: number };
    };
  }>(buildUrl(`/v2/snapshot/locale/us/markets/stocks/tickers/${ticker.toUpperCase()}`), signal);

  const t = data?.ticker;
  if (!ok || !t) return { found: false, price: null, prev_close: null, gap_pct: null };

  const last = typeof t.lastTrade?.p === "number" && t.lastTrade.p > 0 ? t.lastTrade.p : null;
  const prev = typeof t.prevDay?.c === "number" && t.prevDay.c > 0 ? t.prevDay.c : null;
  const dayClose = typeof t.day?.c === "number" && t.day.c > 0 ? t.day.c : null;
  const price = last ?? dayClose;
  const gap = price != null && prev != null && prev > 0 ? Math.round(((price - prev) / prev) * 100) : null;
  return { found: price != null || prev != null, price, prev_close: prev, gap_pct: gap };
}

export type DDTickerDetails = {
  found: boolean;
  name: string | null;
  cik: string | null;
  market_cap: number | null;
  shares_outstanding: number | null;
};

/** §5.2 — ticker details: market cap, shares outstanding, CIK (for EDGAR), name. */
export async function fetchDDTickerDetails(ticker: string, signal?: AbortSignal): Promise<DDTickerDetails> {
  const { ok, data } = await getJson<{
    results?: {
      name?: string;
      cik?: string;
      market_cap?: number;
      share_class_shares_outstanding?: number;
      weighted_shares_outstanding?: number;
    };
  }>(buildUrl(`/v3/reference/tickers/${ticker.toUpperCase()}`), signal);

  const r = data?.results;
  if (!ok || !r) return { found: false, name: null, cik: null, market_cap: null, shares_outstanding: null };

  return {
    found: true,
    name: r.name ?? null,
    cik: r.cik != null ? String(r.cik) : null,
    market_cap: typeof r.market_cap === "number" ? r.market_cap : null,
    shares_outstanding:
      typeof r.share_class_shares_outstanding === "number"
        ? r.share_class_shares_outstanding
        : typeof r.weighted_shares_outstanding === "number"
          ? r.weighted_shares_outstanding
          : null,
  };
}

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** §5.5 — stock splits in the last 12 months; reverse split = red flag. */
export async function fetchDDSplits(ticker: string, signal?: AbortSignal): Promise<DDSplit[]> {
  const { ok, data } = await getJson<{
    results?: Array<{ split_from?: number; split_to?: number; execution_date?: string }>;
  }>(
    buildUrl("/v3/reference/splits", {
      ticker: ticker.toUpperCase(),
      "execution_date.gte": isoMonthsAgo(12),
      limit: "50",
    }),
    signal
  );
  if (!ok || !Array.isArray(data?.results)) return [];

  return data.results
    .map((s): DDSplit | null => {
      const from = typeof s.split_from === "number" ? s.split_from : null;
      const to = typeof s.split_to === "number" ? s.split_to : null;
      const date = s.execution_date ?? null;
      if (from == null || to == null || from <= 0 || to <= 0 || !date) return null;
      const isReverse = from > to;
      const ratioLabel = isReverse
        ? `1-for-${trimNum(from / to)}`
        : `${trimNum(to / from)}-for-1`;
      return { split_from: from, split_to: to, execution_date: date, is_reverse: isReverse, ratio_label: ratioLabel };
    })
    .filter((s): s is DDSplit => s !== null)
    .sort((a, b) => b.execution_date.localeCompare(a.execution_date));
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export type DDShortInterest = {
  /** false when the endpoint is missing from the plan / errored → UI shows "unavailable". */
  available: boolean;
  short_interest: number | null;
  short_pct_float: number | null;
  settlement_date: string | null;
};

/**
 * §5.6 note — short interest (FINRA, ~bi-weekly + lag). Degrades gracefully:
 * a 403/404/missing-plan response returns { available: false } rather than throwing.
 */
export async function fetchDDShortInterest(ticker: string, signal?: AbortSignal): Promise<DDShortInterest> {
  const unavailable: DDShortInterest = {
    available: false,
    short_interest: null,
    short_pct_float: null,
    settlement_date: null,
  };
  try {
    const { ok, status, data } = await getJson<{
      results?: Array<{
        short_interest?: number;
        settlement_date?: string;
        avg_daily_volume?: number;
      }>;
    }>(
      buildUrl("/stocks/v1/short-interest", {
        ticker: ticker.toUpperCase(),
        limit: "1",
        sort: "settlement_date.desc",
      }),
      signal
    );
    if (!ok || status === 401 || status === 403 || status === 404) return unavailable;
    const row = data?.results?.[0];
    if (!row || typeof row.short_interest !== "number") return unavailable;
    return {
      available: true,
      short_interest: row.short_interest,
      short_pct_float: null, // computed against float in the metrics route
      settlement_date: row.settlement_date ?? null,
    };
  } catch {
    return unavailable;
  }
}

/** §5.6 fallback — Polygon Ticker News when Yahoo fails or returns nothing. */
export async function fetchDDPolygonNews(ticker: string, signal?: AbortSignal): Promise<DDNewsItem[]> {
  const { ok, data } = await getJson<{
    results?: Array<{
      title?: string;
      article_url?: string;
      published_utc?: string;
      publisher?: { name?: string };
    }>;
  }>(
    buildUrl("/v2/reference/news", {
      ticker: ticker.toUpperCase(),
      limit: "20",
      order: "descending",
      sort: "published_utc",
    }),
    signal
  );
  if (!ok || !Array.isArray(data?.results)) return [];
  return data.results
    .map((a): DDNewsItem | null => {
      if (!a.title || !a.article_url || !a.published_utc) return null;
      return {
        title: String(a.title),
        url: String(a.article_url),
        source: a.publisher?.name ?? "Polygon",
        published_utc: a.published_utc,
        provider: "polygon",
      };
    })
    .filter((n): n is DDNewsItem => n !== null);
}
