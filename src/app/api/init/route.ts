import { NextRequest, NextResponse } from "next/server";
import {
  getLatestScreenerDate,
  getLatestScreenerDates,
  getScreenerSnapshot,
  getCompanyClassification,
  getDailyBars,
  getIndustryRankUniverseCounts,
  getStockProfileDbMetrics,
} from "@/lib/screener-db-native";
import { getStockRecord } from "@/lib/stocks-db";
import { fetchQuote, fetchProfile } from "@/lib/massive";
import { fetchNextEarningsDate } from "@/lib/yahoo-earnings";
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
    companyName: pickStr(raw, "companyName", "Company Name", "name"),
    description: pickStr(raw, "description", "Description"),
    website: pickStr(raw, "website", "Website", "url"),
    exchange: pickStr(raw, "exchange", "Exchange", "exchangeShortName"),
    country: pickStr(raw, "country", "Country"),
    industry: pickStr(raw, "industry", "Industry"),
    sector: pickStr(raw, "sector", "Sector"),
    ipoDate: pickStr(raw, "ipoDate", "ipo date"),
    floatShares: typeof raw.floatShares === "number" ? raw.floatShares : typeof raw.sharesFloat === "number" ? raw.sharesFloat : undefined,
    sharesOutstanding: typeof raw.sharesOutstanding === "number" ? raw.sharesOutstanding : undefined,
    mktCap: raw.mktCap ?? raw.marketCap,
  };
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

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const jsonWithMetrics = (
    body: unknown,
    init?: { status?: number; headers?: Record<string, string> }
  ) => {
    const payload = JSON.stringify(body);
    const durationMs = Math.round(performance.now() - startedAt);
    const payloadBytes = new TextEncoder().encode(payload).length;
    return new NextResponse(payload, {
      status: init?.status,
      headers: {
        "Content-Type": "application/json",
        "Server-Timing": `total;dur=${durationMs}`,
        "X-Payload-Bytes": String(payloadBytes),
        ...(init?.headers ?? {}),
      },
    });
  };
  const symbol = (request.nextUrl.searchParams.get("symbol") || "SPY").toUpperCase();
  try {
    const latestDates = getLatestScreenerDates();
    const latestScreenerDate = latestDates.reliableDate ?? getLatestScreenerDate();

    const bars = latestScreenerDate ? getDailyBars(symbol, latestScreenerDate, 2500) : [];
    const candles: Candle[] = bars
      .slice()
      .reverse()
      .map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));

    const stockRecord = getStockRecord(symbol);
    const companyClass = getCompanyClassification(symbol);
    const dbSnapshot = getScreenerSnapshot({ symbols: [symbol], limit: 1, includeFinancialExtras: false });
    const dbRow = dbSnapshot.rows[0] ?? null;
    const industryRankUniverse = getIndustryRankUniverseCounts(dbSnapshot.date ?? undefined).counts;
    const dbProfileMetrics = getStockProfileDbMetrics(symbol, dbSnapshot.date ?? undefined).metrics;

    const [quote, profile, nextEarnings] = await Promise.all([
      withTimeout(fetchQuote(symbol), 3000, null),
      withTimeout(fetchProfile(symbol), 3000, null),
      withTimeout(fetchNextEarningsDate(symbol), 2000, undefined),
    ]);

    const baseQuote = quote ?? {
      symbol,
      name: dbRow?.name ?? stockRecord?.name ?? profile?.companyName ?? symbol,
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
      symbol;
    const profileNorm = normalizeProfile(profile as Record<string, unknown> | null);

    const mergedProfile =
      profileNorm || profile || stockRecord
        ? {
            ...(profile ?? {}),
            ...(profileNorm ?? {}),
            ...(stockRecord ?? {}),
            sector: profileNorm?.sector ?? companyClass?.sector ?? stockRecord?.sector ?? (profile as { sector?: string } | null | undefined)?.sector,
            industry: profileNorm?.industry ?? companyClass?.industry ?? stockRecord?.industry ?? (profile as { industry?: string } | null | undefined)?.industry,
            exchange: profileNorm?.exchange ?? companyClass?.exchange ?? stockRecord?.exchange ?? (profile as { exchange?: string } | null | undefined)?.exchange,
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
      atrPct21d: typeof dbRow?.atr_pct_21d === "number" && dbRow.atr_pct_21d > 0 ? dbRow.atr_pct_21d : null,
    };

    const rsRank = dbRow
      ? {
          rs_pct_1m: dbRow.rs_pct_1m ?? null,
          rs_pct_3m: dbRow.rs_pct_3m ?? null,
          rs_pct_6m: dbRow.rs_pct_6m ?? null,
          rs_pct_12m: dbRow.rs_pct_12m ?? null,
        }
      : null;

    const industryRanks = dbRow
      ? {
          industry_rank_1m: dbRow.industry_rank_1m ?? null,
          industry_rank_3m: dbRow.industry_rank_3m ?? null,
          industry_rank_6m: dbRow.industry_rank_6m ?? null,
          industry_rank_12m: dbRow.industry_rank_12m ?? null,
        }
      : null;

    const payload = {
      latestScreenerDate,
      latestScreenerDateRaw: latestDates.rawDate,
      latestScreenerDateSource: latestDates.source,
      stock: {
        quote: quoteWithFallback,
        profile: mergedProfile,
        nextEarnings,
        rsRank,
        industryRanks,
        industryRankUniverse,
        dbProfileMetrics,
      },
      candles,
    };

    return jsonWithMetrics(payload, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Init API error";
    return jsonWithMetrics({ error: message }, { status: 500 });
  }
}
