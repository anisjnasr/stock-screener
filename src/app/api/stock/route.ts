import { NextRequest, NextResponse } from "next/server";
import { fetchQuote, fetchProfile } from "@/lib/massive";
import { fetchNextEarningsDate } from "@/lib/yahoo-earnings";
import { getStockRecord } from "@/lib/stocks-db";
import {
  getCompanyClassification,
  getIndustryRankUniverseCounts,
  getComputedIndustryRanksForIndustry,
  getComputedRsPercentilesForSymbol,
  getLatestScreenerDate,
  getStockProfileDbMetrics,
  getScreenerSnapshot,
} from "@/lib/screener-db-native";
import { isUSMarketOpen } from "@/lib/market-hours";

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

type NormalizedProfile = {
  companyName?: string;
  description?: string;
  website?: string;
  exchange?: string;
  country?: string;
  industry?: string;
  sector?: string;
  ipoDate?: string;
  floatShares?: number;
  sharesOutstanding?: number;
  mktCap?: number;
};

function normalizeProfile(raw: Record<string, unknown> | null): NormalizedProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    companyName: pickStr(raw as Record<string, unknown>, "companyName", "Company Name", "name"),
    description: pickStr(raw as Record<string, unknown>, "description", "Description"),
    website: pickStr(raw as Record<string, unknown>, "website", "Website", "url"),
    exchange: pickStr(raw as Record<string, unknown>, "exchange", "Exchange", "exchangeShortName"),
    country: pickStr(raw as Record<string, unknown>, "country", "Country"),
    industry: pickStr(raw as Record<string, unknown>, "industry", "Industry"),
    sector: pickStr(raw as Record<string, unknown>, "sector", "Sector"),
    ipoDate: pickStr(raw as Record<string, unknown>, "ipoDate", "ipo date"),
    floatShares: typeof raw.floatShares === "number" ? raw.floatShares : typeof raw.sharesFloat === "number" ? raw.sharesFloat : undefined,
    sharesOutstanding: typeof raw.sharesOutstanding === "number" ? raw.sharesOutstanding : undefined,
    mktCap: typeof raw.mktCap === "number" ? raw.mktCap : typeof raw.marketCap === "number" ? raw.marketCap : undefined,
  };
}

type StockApiCacheEntry = {
  payload: {
    quote: Record<string, unknown>;
    profile?: Record<string, unknown>;
    nextEarnings?: string;
    rsRank?: unknown;
    industryRanks?: unknown;
    industryRankUniverse?: unknown;
    dbProfileMetrics?: unknown;
  };
  expiresAt: number;
  staleAt: number;
};

const STOCK_API_TTL_OPEN_MS = 60 * 1000;
const STOCK_API_TTL_CLOSED_MS = 5 * 60 * 1000;
const STOCK_API_STALE_BUFFER_MS = 30 * 1000;
const LATEST_SCREENER_DATE_TTL_MS = 30 * 1000;
const STOCK_API_CACHE_VERSION = "rs-fallback-v1";

function getStockApiCache(): Map<string, StockApiCacheEntry> {
  const g = globalThis as typeof globalThis & { __stockToolStockApiCache?: Map<string, StockApiCacheEntry> };
  if (!g.__stockToolStockApiCache) g.__stockToolStockApiCache = new Map();
  return g.__stockToolStockApiCache;
}

function getLatestDateCacheState() {
  const g = globalThis as typeof globalThis & {
    __stockToolLatestScreenerDateCache?: { value: string; expiresAt: number };
  };
  return {
    get: () => g.__stockToolLatestScreenerDateCache,
    set: (value: string, expiresAt: number) => {
      g.__stockToolLatestScreenerDateCache = { value, expiresAt };
    },
  };
}

function getLatestScreenerDateCached(): string {
  const now = Date.now();
  const state = getLatestDateCacheState();
  const cached = state.get();
  if (cached && cached.expiresAt > now) return cached.value;
  const latest = getLatestScreenerDate() ?? "none";
  state.set(latest, now + LATEST_SCREENER_DATE_TTL_MS);
  return latest;
}

function cacheControlHeader(): string {
  const marketOpen = isUSMarketOpen();
  const httpMaxAge = marketOpen ? 30 : 120;
  return `public, max-age=${httpMaxAge}, stale-while-revalidate=120`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  const result = await Promise.race([promise, timeoutPromise]).catch(() => fallback);
  if (timeoutId) clearTimeout(timeoutId);
  return result;
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const symbolUpper = String(symbol).toUpperCase();
  try {
    const latestScreenerDate = getLatestScreenerDateCached();
    const cacheKey = `${STOCK_API_CACHE_VERSION}:${symbolUpper}:${latestScreenerDate}`;
    const cache = getStockApiCache();
    const cached = cache.get(cacheKey);
    const now = Date.now();
    const cacheHeader = cacheControlHeader();
    if (cached && cached.staleAt > now) {
      return NextResponse.json(cached.payload, {
        headers: { "Cache-Control": cacheHeader },
      });
    }
    if (cached && cached.expiresAt > now) {
      const staleResponse = NextResponse.json(cached.payload, {
        headers: { "Cache-Control": cacheHeader },
      });
      refreshStockCache(symbolUpper, latestScreenerDate, cache, cacheKey).catch(() => {});
      return staleResponse;
    }
    if (cached && cached.expiresAt <= now) cache.delete(cacheKey);

    const stockRecord = getStockRecord(symbolUpper);
    const companyClass = getCompanyClassification(symbolUpper);
    const dbSnapshot = getScreenerSnapshot({ symbols: [symbolUpper], limit: 1, includeFinancialExtras: false });
    const dbRow = dbSnapshot.rows[0] ?? null;
    const industryRankUniverse = getIndustryRankUniverseCounts(dbSnapshot.date ?? undefined).counts;
    const dbProfileMetrics = getStockProfileDbMetrics(symbolUpper, dbSnapshot.date ?? undefined).metrics;

    const [quote, profile, nextEarnings] = await Promise.all([
      withTimeout(fetchQuote(symbolUpper), 4000, null),
      withTimeout(fetchProfile(symbolUpper), 4000, null),
      withTimeout(fetchNextEarningsDate(symbolUpper), 3000, undefined),
    ]);
    if (!quote && !dbRow && !stockRecord && !profile)
      return NextResponse.json({ error: "Symbol not found" }, { status: 404 });

    const baseQuote = quote ?? {
      symbol: symbolUpper,
      name: dbRow?.name ?? stockRecord?.name ?? profile?.companyName ?? symbolUpper,
      price: dbRow?.last_price ?? 0,
      changesPercentage: dbRow?.change_pct ?? 0,
      change: 0,
      dayLow: dbRow?.last_price ?? 0,
      dayHigh: dbRow?.last_price ?? 0,
      yearHigh: dbRow?.high_52w ?? dbRow?.last_price ?? 0,
      yearLow: dbRow?.last_price ?? 0,
      volume: dbRow?.volume ?? 0,
      avgVolume: dbRow?.avg_volume_30d_shares ?? undefined,
      marketCap: dbRow?.market_cap ?? profile?.mktCap ?? undefined,
      priceAvg50: undefined,
      priceAvg200: undefined,
    };

    const name =
      (baseQuote as { name?: string; companyName?: string }).name ??
      (baseQuote as { companyName?: string }).companyName ??
      dbRow?.name ??
      profile?.companyName ??
      symbolUpper;
    const profileNorm = normalizeProfile(profile as Record<string, unknown> | null);

    const mergedProfile =
      profileNorm || profile || stockRecord
        ? {
            ...(profile ?? {}),
            ...(profileNorm ?? {}),
            ...(stockRecord ?? {}),
            sector:
              profileNorm?.sector ??
              companyClass?.sector ??
              stockRecord?.sector ??
              (profile as { sector?: string } | null | undefined)?.sector,
            industry:
              profileNorm?.industry ??
              companyClass?.industry ??
              stockRecord?.industry ??
              (profile as { industry?: string } | null | undefined)?.industry,
            exchange:
              profileNorm?.exchange ??
              companyClass?.exchange ??
              stockRecord?.exchange ??
              (profile as { exchange?: string } | null | undefined)?.exchange,
          }
        : undefined;

    const marketOpen = isUSMarketOpen();
    const quoteWithFallback = {
      ...baseQuote,
      name,
      price:
        typeof baseQuote.price === "number" && baseQuote.price > 0
          ? baseQuote.price
          : dbRow?.last_price ?? baseQuote.price,
      changesPercentage:
        !marketOpen && typeof dbRow?.change_pct === "number"
          ? dbRow.change_pct
          : typeof baseQuote.changesPercentage === "number"
            ? baseQuote.changesPercentage
            : dbRow?.change_pct ?? 0,
      change:
        !marketOpen && typeof dbRow?.change_pct === "number"
          ? ((dbRow.last_price ?? baseQuote.price ?? 0) * dbRow.change_pct) / 100
          : baseQuote.change,
      volume:
        typeof baseQuote.volume === "number" && baseQuote.volume > 0
          ? baseQuote.volume
          : dbRow?.volume ?? baseQuote.volume,
      avgVolume:
        typeof baseQuote.avgVolume === "number" && baseQuote.avgVolume > 0
          ? baseQuote.avgVolume
          : dbRow?.avg_volume_30d_shares ?? baseQuote.avgVolume,
      yearHigh:
        typeof dbRow?.high_52w === "number" && dbRow.high_52w > 0
          ? dbRow.high_52w
          : baseQuote.yearHigh,
      marketCap:
        typeof dbRow?.market_cap === "number" && dbRow.market_cap > 0
          ? dbRow.market_cap
          : typeof baseQuote.marketCap === "number" && baseQuote.marketCap > 0
            ? baseQuote.marketCap
            : (mergedProfile as { mktCap?: number } | undefined)?.mktCap,
      off52WHighPct: dbRow?.off_52w_high_pct ?? null,
      atrPct21d:
        typeof dbRow?.atr_pct_21d === "number" && dbRow.atr_pct_21d > 0 ? dbRow.atr_pct_21d : null,
    };

    const rowRsRank = dbRow ? {
      rs_pct_1m: dbRow.rs_pct_1m ?? null,
      rs_pct_3m: dbRow.rs_pct_3m ?? null,
      rs_pct_6m: dbRow.rs_pct_6m ?? null,
      rs_pct_12m: dbRow.rs_pct_12m ?? null,
    } : null;
    const computedRsRank =
      !rowRsRank ||
      rowRsRank.rs_pct_1m == null ||
      rowRsRank.rs_pct_3m == null ||
      rowRsRank.rs_pct_6m == null ||
      rowRsRank.rs_pct_12m == null
        ? getComputedRsPercentilesForSymbol(symbolUpper, dbSnapshot.date ?? undefined).rsRank
        : null;
    const rsRank =
      rowRsRank || computedRsRank
        ? {
            rs_pct_1m: rowRsRank?.rs_pct_1m ?? computedRsRank?.rs_pct_1m ?? null,
            rs_pct_3m: rowRsRank?.rs_pct_3m ?? computedRsRank?.rs_pct_3m ?? null,
            rs_pct_6m: rowRsRank?.rs_pct_6m ?? computedRsRank?.rs_pct_6m ?? null,
            rs_pct_12m: rowRsRank?.rs_pct_12m ?? computedRsRank?.rs_pct_12m ?? null,
          }
        : null;

    const rowIndustryRanks = dbRow
      ? {
          industry_rank_1m: dbRow.industry_rank_1m ?? null,
          industry_rank_3m: dbRow.industry_rank_3m ?? null,
          industry_rank_6m: dbRow.industry_rank_6m ?? null,
          industry_rank_12m: dbRow.industry_rank_12m ?? null,
        }
      : null;
    const profileIndustry =
      profileNorm?.industry ??
      companyClass?.industry ??
      stockRecord?.industry ??
      (profile as { industry?: string } | null | undefined)?.industry ??
      dbRow?.industry ??
      null;
    const computedIndustryRanks =
      !rowIndustryRanks ||
      rowIndustryRanks.industry_rank_1m == null ||
      rowIndustryRanks.industry_rank_3m == null ||
      rowIndustryRanks.industry_rank_6m == null ||
      rowIndustryRanks.industry_rank_12m == null
        ? getComputedIndustryRanksForIndustry(profileIndustry, dbSnapshot.date ?? undefined).ranks
        : null;
    const industryRanks =
      rowIndustryRanks || computedIndustryRanks
        ? {
            industry_rank_1m: rowIndustryRanks?.industry_rank_1m ?? computedIndustryRanks?.industry_rank_1m ?? null,
            industry_rank_3m: rowIndustryRanks?.industry_rank_3m ?? computedIndustryRanks?.industry_rank_3m ?? null,
            industry_rank_6m: rowIndustryRanks?.industry_rank_6m ?? computedIndustryRanks?.industry_rank_6m ?? null,
            industry_rank_12m: rowIndustryRanks?.industry_rank_12m ?? computedIndustryRanks?.industry_rank_12m ?? null,
          }
        : null;

    const payload = {
      quote: quoteWithFallback,
      profile: mergedProfile,
      nextEarnings,
      rsRank,
      industryRanks,
      industryRankUniverse,
      dbProfileMetrics,
    };
    const ttl = marketOpen ? STOCK_API_TTL_OPEN_MS : STOCK_API_TTL_CLOSED_MS;
    const staleAt = Date.now() + ttl;
    cache.set(cacheKey, { payload, staleAt, expiresAt: staleAt + STOCK_API_STALE_BUFFER_MS });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cacheHeader },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function refreshStockCache(
  symbolUpper: string,
  latestScreenerDate: string,
  cache: Map<string, StockApiCacheEntry>,
  cacheKey: string
): Promise<void> {
  try {
    const [quote, profile, nextEarnings] = await Promise.all([
      withTimeout(fetchQuote(symbolUpper), 3000, null),
      withTimeout(fetchProfile(symbolUpper), 3000, null),
      withTimeout(fetchNextEarningsDate(symbolUpper), 2000, undefined),
    ]);
    if (!quote) return;
    const existing = cache.get(cacheKey);
    if (!existing) return;
    const updated = {
      ...existing.payload,
      quote: { ...existing.payload.quote, ...quote },
      profile: profile ? { ...(existing.payload.profile ?? {}), ...profile } : existing.payload.profile,
      nextEarnings: nextEarnings ?? existing.payload.nextEarnings,
    };
    const marketOpen = isUSMarketOpen();
    const ttl = marketOpen ? STOCK_API_TTL_OPEN_MS : STOCK_API_TTL_CLOSED_MS;
    const staleAt = Date.now() + ttl;
    cache.set(cacheKey, { payload: updated, staleAt, expiresAt: staleAt + STOCK_API_STALE_BUFFER_MS });
  } catch {
    // Background refresh failure is non-critical
  }
}
