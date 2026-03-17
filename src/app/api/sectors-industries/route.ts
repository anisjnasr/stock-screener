import { NextRequest, NextResponse } from "next/server";
import {
  getLatestCompletedTradingDate,
  getTickerPerformance,
  getWeightedCategoryPerformance,
  type PerformanceTimeframe,
} from "@/lib/screener-db-native";
import { THEMATIC_ETFS } from "@/lib/thematic-etfs";

const INDEX_ITEMS = [
  { id: "sp500", name: "S&P 500", ticker: "SPY" },
  { id: "nasdaq100", name: "Nasdaq 100", ticker: "QQQ" },
  { id: "russell2000", name: "Russell 2000", ticker: "IWM" },
] as const;

type TimeframeParam = "day" | "week" | "month" | "quarter" | "year";

type CachedValue =
  | ReturnType<typeof getWeightedCategoryPerformance>
  | ReturnType<typeof getTickerPerformance>;

const globalForSiCache = globalThis as unknown as {
  _siCache?: Map<string, CachedValue>;
};

function getSiCache(): Map<string, CachedValue> {
  if (!globalForSiCache._siCache) globalForSiCache._siCache = new Map();
  return globalForSiCache._siCache;
}

function parseTimeframe(value: string | null): TimeframeParam {
  if (value === "day" || value === "week" || value === "month" || value === "quarter" || value === "year") {
    return value;
  }
  return "day";
}

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const defaultTimeframe = parseTimeframe(request.nextUrl.searchParams.get("timeframe"));
    const indicesTimeframe = parseTimeframe(
      request.nextUrl.searchParams.get("indicesTimeframe") ?? defaultTimeframe
    );
    const sectorsTimeframe = parseTimeframe(
      request.nextUrl.searchParams.get("sectorsTimeframe") ?? defaultTimeframe
    );
    const industriesTimeframe = parseTimeframe(
      request.nextUrl.searchParams.get("industriesTimeframe") ?? defaultTimeframe
    );
    const themesTimeframe = parseTimeframe(
      request.nextUrl.searchParams.get("themesTimeframe") ?? defaultTimeframe
    );
    const asOfDate = getLatestCompletedTradingDate();
    const cache = getSiCache();

    const getOrSet = <T extends CachedValue>(key: string, compute: () => T): T => {
      const existing = cache.get(key) as T | undefined;
      if (existing) return existing;
      const next = compute();
      cache.set(key, next);
      return next;
    };

    const sectorResult = getOrSet(
      `sector:${sectorsTimeframe}:${asOfDate ?? "na"}`,
      () =>
        getWeightedCategoryPerformance(
          "sector",
          sectorsTimeframe as PerformanceTimeframe,
          asOfDate ?? undefined
        )
    );
    const industryResult = getOrSet(
      `industry:${industriesTimeframe}:${asOfDate ?? "na"}`,
      () =>
        getWeightedCategoryPerformance(
          "industry",
          industriesTimeframe as PerformanceTimeframe,
          asOfDate ?? undefined
        )
    );
    const indexPerf = getOrSet(
      `indices:${indicesTimeframe}:${asOfDate ?? "na"}`,
      () =>
        getTickerPerformance(
          INDEX_ITEMS.map((x) => x.ticker),
          indicesTimeframe as PerformanceTimeframe,
          asOfDate ?? undefined
        )
    );
    const themePerf = getOrSet(
      `themes:${themesTimeframe}:${asOfDate ?? "na"}`,
      () =>
        getTickerPerformance(
          THEMATIC_ETFS.map((x) => x.ticker),
          themesTimeframe as PerformanceTimeframe,
          asOfDate ?? undefined
        )
    );

    const indexMap = new Map(indexPerf.rows.map((r) => [r.symbol, r]));
    const themeMap = new Map(themePerf.rows.map((r) => [r.symbol, r]));

    return NextResponse.json({
      timeframe: defaultTimeframe,
      timeframes: {
        indices: indicesTimeframe,
        sectors: sectorsTimeframe,
        industries: industriesTimeframe,
        themes: themesTimeframe,
      },
      date: asOfDate ?? sectorResult.date,
      indices: INDEX_ITEMS.map((item) => ({
        id: item.id,
        name: item.name,
        ticker: item.ticker,
        changePct: indexMap.get(item.ticker)?.change_pct ?? null,
      })),
      sectors: sectorResult.rows.map((r) => ({
        id: toSlug(r.name),
        name: r.name,
        changePct: r.change_pct,
        totalMarketCap: r.total_market_cap,
        stockCount: r.stock_count,
      })),
      industries: industryResult.rows.map((r) => ({
        id: toSlug(r.name),
        name: r.name,
        changePct: r.change_pct,
        totalMarketCap: r.total_market_cap,
        stockCount: r.stock_count,
      })),
      themes: THEMATIC_ETFS.map((item) => ({
        id: item.id,
        category: item.category,
        name: item.theme,
        ticker: item.ticker,
        changePct: themeMap.get(item.ticker)?.change_pct ?? null,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to compute sectors/industries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

