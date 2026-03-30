import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-path";
import {
  getLatestCompletedTradingDate,
  getTickerPerformance,
  getWeightedCategoryPerformance,
  getPrecomputedPerformance,
  ensurePerformanceCacheTable,
  type PerformanceTimeframe,
} from "@/lib/screener-db-native";
import { THEMATIC_ETFS } from "@/lib/thematic-etfs";

const INDEX_ITEMS = [
  { id: "sp500", name: "S&P 500", ticker: "SPY" },
  { id: "nasdaq100", name: "Nasdaq 100", ticker: "QQQ" },
  { id: "russell2000", name: "Russell 2000", ticker: "IWM" },
] as const;

type TimeframeParam = "day" | "week" | "month" | "quarter" | "half_year" | "year" | "ytd";

type CachedValue =
  | ReturnType<typeof getWeightedCategoryPerformance>
  | ReturnType<typeof getTickerPerformance>;

const globalForSiCache = globalThis as unknown as {
  _siCache?: Map<string, CachedValue>;
  _siResponseCache?: Map<string, unknown>;
};

function getSiCache(): Map<string, CachedValue> {
  if (!globalForSiCache._siCache) globalForSiCache._siCache = new Map();
  return globalForSiCache._siCache;
}

function getSiResponseCache(): Map<string, unknown> {
  if (!globalForSiCache._siResponseCache) globalForSiCache._siResponseCache = new Map();
  return globalForSiCache._siResponseCache;
}

const CACHE_PATH = join(getDataDir(), "sectors-industries-cache.json");
const CACHE_VERSION = 1;
type DiskCache = {
  version: number;
  items: Record<string, unknown>;
};

function parseTimeframe(value: string | null): TimeframeParam {
  if (value === "day" || value === "week" || value === "month" || value === "quarter" || value === "half_year" || value === "year" || value === "ytd") {
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
    const responseKey = [
      asOfDate ?? "na",
      indicesTimeframe,
      sectorsTimeframe,
      industriesTimeframe,
      themesTimeframe,
    ].join("|");

    const responseCache = getSiResponseCache();
    const memCached = responseCache.get(responseKey);
    if (memCached) return NextResponse.json(memCached);

    if (existsSync(CACHE_PATH)) {
      try {
        const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as DiskCache;
        if (
          parsed &&
          parsed.version === CACHE_VERSION &&
          parsed.items &&
          parsed.items[responseKey]
        ) {
          responseCache.set(responseKey, parsed.items[responseKey]);
          return NextResponse.json(parsed.items[responseKey]);
        }
      } catch {
        /* ignore disk cache read errors */
      }
    }
    ensurePerformanceCacheTable();
    const cache = getSiCache();

    const getOrSet = <T extends CachedValue>(key: string, compute: () => T): T => {
      const existing = cache.get(key) as T | undefined;
      if (existing) return existing;
      const next = compute();
      cache.set(key, next);
      return next;
    };

    // Try pre-computed cache first (instant), fall back to live computation
    const cachedSectors = getPrecomputedPerformance("sector", sectorsTimeframe as PerformanceTimeframe, asOfDate ?? undefined);
    const cachedIndustries = getPrecomputedPerformance("industry", industriesTimeframe as PerformanceTimeframe, asOfDate ?? undefined);
    const cachedIndices = getPrecomputedPerformance("index", indicesTimeframe as PerformanceTimeframe, asOfDate ?? undefined);
    const cachedThemes = getPrecomputedPerformance("thematic", themesTimeframe as PerformanceTimeframe, asOfDate ?? undefined);

    const sectorResult = cachedSectors
      ? { rows: cachedSectors.map((r) => ({ name: r.name, change_pct: r.change_pct, total_market_cap: r.total_market_cap ?? 0, stock_count: r.stock_count ?? 0 })), date: asOfDate }
      : getOrSet(
          `sector:${sectorsTimeframe}:${asOfDate ?? "na"}`,
          () => getWeightedCategoryPerformance("sector", sectorsTimeframe as PerformanceTimeframe, asOfDate ?? undefined)
        );
    const industryResult = cachedIndustries
      ? { rows: cachedIndustries.map((r) => ({ name: r.name, change_pct: r.change_pct, total_market_cap: r.total_market_cap ?? 0, stock_count: r.stock_count ?? 0 })), date: asOfDate }
      : getOrSet(
          `industry:${industriesTimeframe}:${asOfDate ?? "na"}`,
          () => getWeightedCategoryPerformance("industry", industriesTimeframe as PerformanceTimeframe, asOfDate ?? undefined)
        );
    const indexPerf = cachedIndices
      ? { rows: cachedIndices.map((r) => ({ symbol: r.name, change_pct: r.change_pct, market_cap: null as number | null })), date: asOfDate }
      : getOrSet(
          `indices:${indicesTimeframe}:${asOfDate ?? "na"}`,
          () => getTickerPerformance(INDEX_ITEMS.map((x) => x.ticker), indicesTimeframe as PerformanceTimeframe, asOfDate ?? undefined)
        );
    const themePerf = cachedThemes
      ? { rows: cachedThemes.map((r) => ({ symbol: r.name, change_pct: r.change_pct, market_cap: null as number | null })), date: asOfDate }
      : getOrSet(
          `themes:${themesTimeframe}:${asOfDate ?? "na"}`,
          () => getTickerPerformance(THEMATIC_ETFS.map((x) => x.ticker), themesTimeframe as PerformanceTimeframe, asOfDate ?? undefined)
        );

    const indexMap = new Map(indexPerf.rows.map((r) => [r.symbol, r]));
    const themeMap = new Map(themePerf.rows.map((r) => [r.symbol, r]));

    const payload = {
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
    };

    responseCache.set(responseKey, payload);
    try {
      let disk: DiskCache = { version: CACHE_VERSION, items: {} };
      if (existsSync(CACHE_PATH)) {
        const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as DiskCache;
        if (parsed && parsed.version === CACHE_VERSION && parsed.items) disk = parsed;
      }
      disk.items[responseKey] = payload;
      const keys = Object.keys(disk.items);
      if (keys.length > 80) {
        for (const k of keys.slice(0, keys.length - 80)) delete disk.items[k];
      }
      writeFileSync(CACHE_PATH, JSON.stringify(disk), "utf8");
    } catch {
      /* ignore disk cache write errors */
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to compute sectors/industries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

