import { NextRequest, NextResponse } from "next/server";
import { fetchQuote, fetchProfile } from "@/lib/massive";
import { fetchNextEarningsDate } from "@/lib/yahoo-earnings";
import { getStockRecord } from "@/lib/stocks-db";
import { getCompanyClassification, getLatestScreenerDate, getScreenerSnapshot } from "@/lib/screener-db-native";
import { isUSMarketOpen } from "@/lib/market-hours";

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

function normalizeProfile(raw: Record<string, unknown> | null): Record<string, unknown> | undefined {
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
    mktCap: raw.mktCap ?? raw.marketCap,
  };
}

type StockApiCacheEntry = {
  payload: {
    quote: Record<string, unknown>;
    profile?: Record<string, unknown>;
    nextEarnings?: string;
  };
  expiresAt: number;
};

const STOCK_API_TTL_MS = 60 * 1000;

function getStockApiCache(): Map<string, StockApiCacheEntry> {
  const g = globalThis as typeof globalThis & { __stockToolStockApiCache?: Map<string, StockApiCacheEntry> };
  if (!g.__stockToolStockApiCache) g.__stockToolStockApiCache = new Map();
  return g.__stockToolStockApiCache;
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
    const latestScreenerDate = getLatestScreenerDate() ?? "none";
    const cacheKey = `${symbolUpper}:${latestScreenerDate}`;
    const cache = getStockApiCache();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload);
    }
    if (cached && cached.expiresAt <= Date.now()) cache.delete(cacheKey);

    const stockRecord = getStockRecord(symbolUpper);
    const companyClass = getCompanyClassification(symbolUpper);
    const dbSnapshot = getScreenerSnapshot({ symbols: [symbolUpper], limit: 1 });
    const dbRow = dbSnapshot.rows[0] ?? null;

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

    const rsRank = dbRow ? {
      rs_pct_1w: dbRow.rs_pct_1w ?? null,
      rs_pct_1m: dbRow.rs_pct_1m ?? null,
      rs_pct_3m: dbRow.rs_pct_3m ?? null,
      rs_pct_6m: dbRow.rs_pct_6m ?? null,
      rs_pct_12m: dbRow.rs_pct_12m ?? null,
    } : null;

    const payload = {
      quote: quoteWithFallback,
      profile: mergedProfile,
      nextEarnings,
      rsRank,
    };
    cache.set(cacheKey, { payload, expiresAt: Date.now() + STOCK_API_TTL_MS });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
