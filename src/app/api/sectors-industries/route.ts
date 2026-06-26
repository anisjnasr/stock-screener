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
import {
  INDUSTRY_ETF_UNIVERSE,
  INDUSTRY_ETF_UNIVERSE_TICKERS,
} from "@/lib/industry-etf-universe";
import {
  MATRIX_PERF_TF,
  type MatrixPerfMap,
  type MatrixRow,
  type MatrixTfKey,
  type SectorsMatrixPayload,
} from "./matrix-shared";

const INDEX_ITEMS = [
  { id: "sp500", name: "S&P 500", ticker: "SPY" },
  { id: "nasdaq100", name: "Nasdaq 100", ticker: "QQQ" },
  { id: "russell2000", name: "Russell 2000", ticker: "IWM" },
  { id: "sp500-ew", name: "S&P 500 Equal Weight", ticker: "RSP" },
  { id: "nasdaq100-ew", name: "Nasdaq 100 Equal Weight", ticker: "QQQE" },
] as const;

const INDEX_TICKERS = INDEX_ITEMS.map((x) => x.ticker);

const SECTOR_ETF_MAP: Record<string, string> = {
  Technology: "XLK",
  "Financial Services": "XLF",
  Healthcare: "XLV",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  "Communication Services": "XLC",
  Industrials: "XLI",
  Energy: "XLE",
  "Basic Materials": "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU",
};

type TimeframeParam = "day" | "week" | "month" | "quarter" | "half_year" | "year" | "ytd";

type CachedValue =
  | ReturnType<typeof getWeightedCategoryPerformance>
  | ReturnType<typeof getTickerPerformance>;

type ResponseCacheEntry = { payload: unknown; createdAt: number };
const RESPONSE_CACHE_MAX_ITEMS = 120;
const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;

const globalForSiCache = globalThis as unknown as {
  _siCache?: Map<string, CachedValue>;
  _siResponseCache?: Map<string, ResponseCacheEntry>;
};

function getSiCache(): Map<string, CachedValue> {
  if (!globalForSiCache._siCache) globalForSiCache._siCache = new Map();
  return globalForSiCache._siCache;
}

function getSiResponseCache(): Map<string, ResponseCacheEntry> {
  if (!globalForSiCache._siResponseCache) globalForSiCache._siResponseCache = new Map();
  return globalForSiCache._siResponseCache;
}

function setResponseCache(
  cache: Map<string, ResponseCacheEntry>,
  key: string,
  payload: unknown
): void {
  cache.set(key, { payload, createdAt: Date.now() });
  if (cache.size <= RESPONSE_CACHE_MAX_ITEMS) return;
  const oldest = cache.keys().next().value;
  if (oldest) cache.delete(oldest);
}

const CACHE_PATH = join(getDataDir(), "sectors-industries-cache.json");
const CACHE_VERSION = 4;
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

function emptyPerf(): MatrixPerfMap {
  const o = {} as MatrixPerfMap;
  for (const tf of MATRIX_PERF_TF) o[tf as MatrixTfKey] = null;
  return o;
}

function buildMatrixPayload(asOfDate: string | null, cache: Map<string, CachedValue>): SectorsMatrixPayload {
  const getOrSet = <T extends CachedValue>(key: string, compute: () => T): T => {
    const existing = cache.get(key) as T | undefined;
    if (existing) return existing;
    const next = compute();
    cache.set(key, next);
    return next;
  };

  const sectorRowByName = (tf: PerformanceTimeframe): Map<string, number | null> => {
    const cached = getPrecomputedPerformance("sector", tf, asOfDate ?? undefined);
    if (cached && cached.length > 0) {
      return new Map(cached.map((r) => [r.name, r.change_pct ?? null]));
    }
    const w = getOrSet(`sector:${tf}:${asOfDate ?? "na"}`, () =>
      getWeightedCategoryPerformance("sector", tf, asOfDate ?? undefined)
    );
    return new Map(w.rows.map((r) => [r.name, r.change_pct ?? null]));
  };

  const industryRowByName = (tf: PerformanceTimeframe): Map<string, number | null> => {
    const cached = getPrecomputedPerformance("industry", tf, asOfDate ?? undefined);
    if (cached && cached.length > 0) {
      return new Map(cached.map((r) => [r.name, r.change_pct ?? null]));
    }
    const w = getOrSet(`industry:${tf}:${asOfDate ?? "na"}`, () =>
      getWeightedCategoryPerformance("industry", tf, asOfDate ?? undefined)
    );
    return new Map(w.rows.map((r) => [r.name, r.change_pct ?? null]));
  };

  const etfPerfByTicker = (tf: PerformanceTimeframe): Map<string, number | null> => {
    const merged = getOrSet(`industry-etfs:${tf}:${asOfDate ?? "na"}`, () =>
      getTickerPerformance(INDUSTRY_ETF_UNIVERSE_TICKERS, tf, asOfDate ?? undefined)
    );
    return new Map(merged.rows.map((r) => [String(r.symbol).toUpperCase(), r.change_pct]));
  };

  const indexPerfByTicker = (tf: PerformanceTimeframe): Map<string, number | null> => {
    const merged = getOrSet(`indices:${tf}:${asOfDate ?? "na"}`, () =>
      getTickerPerformance(INDEX_TICKERS, tf, asOfDate ?? undefined)
    );
    return new Map(merged.rows.map((r) => [String(r.symbol).toUpperCase(), r.change_pct]));
  };

  const sectorDayCached = getPrecomputedPerformance("sector", "day", asOfDate ?? undefined);
  const sectorNamesTemplate =
    sectorDayCached && sectorDayCached.length > 0
      ? sectorDayCached.map((r) => r.name)
      : getOrSet(`sector:day:${asOfDate ?? "na"}`, () =>
          getWeightedCategoryPerformance("sector", "day", asOfDate ?? undefined)
        ).rows.map((r) => r.name);

  const indices: MatrixRow[] = INDEX_ITEMS.map((item) => {
    const perf = emptyPerf();
    for (const tf of MATRIX_PERF_TF) {
      perf[tf] = indexPerfByTicker(tf as PerformanceTimeframe).get(item.ticker.toUpperCase()) ?? null;
    }
    return {
      id: item.id,
      name: item.name,
      ticker: item.ticker,
      drillKind: "index",
      drillValue: item.id,
      perf,
    };
  });

  const sectors: MatrixRow[] = sectorNamesTemplate.map((name) => {
    const perf = emptyPerf();
    for (const tf of MATRIX_PERF_TF) {
      perf[tf] = sectorRowByName(tf as PerformanceTimeframe).get(name) ?? null;
    }
    return {
      id: toSlug(name),
      name,
      ticker: SECTOR_ETF_MAP[name] ?? "",
      drillKind: "sector",
      drillValue: name,
      perf,
    };
  });

  const industries: MatrixRow[] = INDUSTRY_ETF_UNIVERSE.map((row) => {
    const perf = emptyPerf();
    for (const tf of MATRIX_PERF_TF) {
      const tfP = tf as PerformanceTimeframe;
      const etfPct = etfPerfByTicker(tfP).get(row.ticker.toUpperCase()) ?? null;
      const stockIndustryPct = row.drillKind === "industry" ? industryRowByName(tfP).get(row.name) ?? null : null;
      perf[tf] = row.drillKind === "industry" ? (stockIndustryPct ?? etfPct) : etfPct;
    }
    return {
      id: row.id,
      name: row.name,
      ticker: row.ticker,
      drillKind: row.drillKind,
      drillValue: row.drillValue,
      perf,
    };
  });

  return {
    matrix: true,
    version: 1,
    date: asOfDate,
    indices,
    sectors,
    industries,
  };
}

async function respondMatrix(): Promise<NextResponse> {
  const asOfDate = getLatestCompletedTradingDate();
  const responseKey = `matrix|${asOfDate ?? "na"}`;
  const responseCache = getSiResponseCache();
  const memCached = responseCache.get(responseKey);
  if (memCached && Date.now() - memCached.createdAt <= RESPONSE_CACHE_TTL_MS) {
    return NextResponse.json(memCached.payload, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  }
  if (memCached) responseCache.delete(responseKey);

  if (existsSync(CACHE_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as DiskCache;
      if (parsed && parsed.version === CACHE_VERSION && parsed.items?.[responseKey]) {
        setResponseCache(responseCache, responseKey, parsed.items[responseKey]);
        return NextResponse.json(parsed.items[responseKey], {
          headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
        });
      }
    } catch {
      /* ignore */
    }
  }

  ensurePerformanceCacheTable();
  const cache = getSiCache();
  const payload = buildMatrixPayload(asOfDate, cache);

  setResponseCache(responseCache, responseKey, payload);
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
    /* ignore */
  }

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
  });
}

export async function GET(request: NextRequest) {
  try {
    const view = request.nextUrl.searchParams.get("view");
    if (view === "matrix") {
      return respondMatrix();
    }

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
    const asOfDate = getLatestCompletedTradingDate();
    const responseKey = [
      asOfDate ?? "na",
      indicesTimeframe,
      sectorsTimeframe,
      industriesTimeframe,
    ].join("|");

    const responseCache = getSiResponseCache();
    const memCached = responseCache.get(responseKey);
    if (memCached && Date.now() - memCached.createdAt <= RESPONSE_CACHE_TTL_MS) {
      return NextResponse.json(memCached.payload);
    }
    if (memCached) responseCache.delete(responseKey);

    if (existsSync(CACHE_PATH)) {
      try {
        const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as DiskCache;
        if (
          parsed &&
          parsed.version === CACHE_VERSION &&
          parsed.items &&
          parsed.items[responseKey]
        ) {
          setResponseCache(responseCache, responseKey, parsed.items[responseKey]);
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

    const cachedSectors = getPrecomputedPerformance("sector", sectorsTimeframe as PerformanceTimeframe, asOfDate ?? undefined);
    const cachedIndustries = getPrecomputedPerformance("industry", industriesTimeframe as PerformanceTimeframe, asOfDate ?? undefined);
    const cachedIndices = getPrecomputedPerformance("index", indicesTimeframe as PerformanceTimeframe, asOfDate ?? undefined);

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
    const mergedEtfPerf = getOrSet(
      `industry-etfs:${industriesTimeframe}:${asOfDate ?? "na"}`,
      () =>
        getTickerPerformance(
          INDUSTRY_ETF_UNIVERSE_TICKERS,
          industriesTimeframe as PerformanceTimeframe,
          asOfDate ?? undefined
        )
    );

    const indexMap = new Map(indexPerf.rows.map((r) => [r.symbol, r]));
    const etfPerfByTicker = new Map(mergedEtfPerf.rows.map((r) => [String(r.symbol).toUpperCase(), r]));
    const industryPerfByName = new Map(industryResult.rows.map((r) => [r.name, r]));

    const payload = {
      timeframe: defaultTimeframe,
      timeframes: {
        indices: indicesTimeframe,
        sectors: sectorsTimeframe,
        industries: industriesTimeframe,
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
      industryEtfs: INDUSTRY_ETF_UNIVERSE.map((row) => {
        const etfPct = etfPerfByTicker.get(row.ticker.toUpperCase())?.change_pct ?? null;
        const stockIndustryPct =
          row.drillKind === "industry" ? (industryPerfByName.get(row.name)?.change_pct ?? null) : null;
        const changePct = row.drillKind === "industry" ? (stockIndustryPct ?? etfPct) : etfPct;
        return {
          id: row.id,
          name: row.name,
          ticker: row.ticker,
          drillKind: row.drillKind,
          drillValue: row.drillValue,
          changePct,
        };
      }),
    };

    setResponseCache(responseCache, responseKey, payload);
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
