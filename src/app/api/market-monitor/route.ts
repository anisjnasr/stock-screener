import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-path";
import {
  getLatestCompletedTradingDate,
  getPrecomputedMarketMonitor,
  getTopMarketMonitorUpMetricIndustries,
  type MarketMonitorDailyRow,
  type MarketMonitorTopUpIndustryRow,
} from "@/lib/screener-db-native";
import { recordPerf } from "@/lib/perf-monitor";

/** MM table row — values come from `market_monitor_daily` (precompute only on the request path). */
export type MarketMonitorRow = {
  date: string;
  up4pct: number;
  down4pct: number;
  ratio5d: number | null;
  ratio10d: number | null;
  up25pct_qtr: number;
  down25pct_qtr: number;
  up25pct_month: number;
  down25pct_month: number;
  up50pct_month: number;
  down50pct_month: number;
  universe: number;
  /** MM universe (cap ≥ $1B): % above50D / 200D EMA; absent in older cached payloads until recomputed. */
  universePctAbove50d?: number | null;
  universePctAbove200d?: number | null;
  nnh52wHighs: number;
  nnh52wLows: number;
  /** Present after `market_monitor_daily` backfill with new columns. */
  count7xAtr50d?: number;
  countEpisodicPivot?: number;
  /** Top non-biotech industry per up-metric (stacked under table cells). */
  topUpIndustries?: MarketMonitorTopUpIndustryRow;
};

export type MarketMonitorApiPayload = {
  version: number;
  rows: MarketMonitorRow[];
  /** Last completed trading day (EOD) from the calendar — may be newer than stored rows when stale. */
  latestDate: string | null;
  /** Last trading day actually present in `rows` (from precomputed DB). */
  dataAsOf: string | null;
  startDate: string | null;
  stale: boolean;
  /** Shown in UI when `stale` or when data is missing. */
  message?: string;
  /** Present on HTTP error responses. */
  error?: string;
  netNewHighs: {
    oneMonth: Array<{ date: string; highs: number; lows: number; net: number }>;
    threeMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    sixMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    fiftyTwoWeek: Array<{ date: string; highs: number; lows: number; net: number }>;
  };
};

const CACHE_PATH = join(getDataDir(), "market-monitor-cache.json");
const CACHE_VERSION = 26;
const RESPONSE_CACHE_TTL_MS = 30 * 1000;

const STALE_HINT =
  "Run `npm run compute-market-aggregates` after your daily data refresh to update `market_monitor_daily`.";

type CachedResponse = {
  expectedTradingDay: string;
  payload: MarketMonitorApiPayload;
  expiresAt: number;
};

function getResponseCacheState() {
  const g = globalThis as typeof globalThis & {
    __stockToolMmResponseCache?: CachedResponse;
  };
  return {
    get: () => g.__stockToolMmResponseCache,
    set: (next: CachedResponse) => {
      g.__stockToolMmResponseCache = next;
    },
  };
}

function marketMonitorHeaders(): Record<string, string> {
  return { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" };
}

function marketMonitorRowFromPrecomputedDaily(r: MarketMonitorDailyRow): MarketMonitorRow {
  return {
    date: r.date,
    up4pct: r.up4pct,
    down4pct: r.down4pct,
    ratio5d: r.ratio5d,
    ratio10d: r.ratio10d,
    up25pct_qtr: r.up25pct_qtr,
    down25pct_qtr: r.down25pct_qtr,
    up25pct_month: r.up25pct_month,
    down25pct_month: r.down25pct_month,
    up50pct_month: r.up50pct_month,
    down50pct_month: r.down50pct_month,
    universe: r.universe,
    universePctAbove50d: r.universe_pct_above_50d,
    universePctAbove200d: r.universe_pct_above_200d,
    nnh52wHighs: r.nnh_52w_highs ?? 0,
    nnh52wLows: r.nnh_52w_lows ?? 0,
    count7xAtr50d: r.count_7x_atr_50d ?? 0,
    countEpisodicPivot: r.count_episodic_pivot ?? 0,
  };
}

function emptyTopUpIndustries(): MarketMonitorTopUpIndustryRow {
  return { up4pct: null, up25pct_qtr: null, up25pct_month: null, up50pct_month: null };
}

function buildNetNewHighsFromPrecomputed(precomputed: MarketMonitorDailyRow[]) {
  const sorted = [...precomputed].sort((a, b) => a.date.localeCompare(b.date));
  return {
    oneMonth: sorted.map((r) => ({
      date: r.date,
      highs: r.nnh_1m_highs ?? 0,
      lows: r.nnh_1m_lows ?? 0,
      net: r.nnh_1m_net ?? 0,
    })),
    threeMonths: sorted.map((r) => ({
      date: r.date,
      highs: r.nnh_3m_highs ?? 0,
      lows: r.nnh_3m_lows ?? 0,
      net: r.nnh_3m_net ?? 0,
    })),
    sixMonths: sorted.map((r) => ({
      date: r.date,
      highs: r.nnh_6m_highs ?? 0,
      lows: r.nnh_6m_lows ?? 0,
      net: r.nnh_6m_net ?? 0,
    })),
    fiftyTwoWeek: sorted.map((r) => {
      const highs = r.nnh_52w_highs ?? 0;
      const lows = r.nnh_52w_lows ?? 0;
      return {
        date: r.date,
        highs,
        lows,
        net: r.nnh_52w_net ?? highs - lows,
      };
    }),
  };
}

function buildPayloadFromPrecomputed(
  precomputed: MarketMonitorDailyRow[],
  expectedTradingDay: string,
  queryStartDate: string
): MarketMonitorApiPayload {
  const baseRowsDesc = precomputed.map(marketMonitorRowFromPrecomputedDaily).filter((r) => r.date >= queryStartDate);
  const topIndustriesByDate = getTopMarketMonitorUpMetricIndustries(queryStartDate, expectedTradingDay);
  const rowsDesc = baseRowsDesc.map((row) => ({
    ...row,
    topUpIndustries: topIndustriesByDate[row.date] ?? emptyTopUpIndustries(),
  }));
  const dataAsOf = rowsDesc.length > 0 ? rowsDesc[0].date : null;
  const startDate = rowsDesc.length > 0 ? rowsDesc[rowsDesc.length - 1].date : null;
  const stale = Boolean(dataAsOf && dataAsOf < expectedTradingDay);
  const message = stale
    ? `Market Monitor is stale: database rows end on ${dataAsOf}, but the last completed trading day is ${expectedTradingDay}. ${STALE_HINT}`
    : undefined;

  return {
    version: CACHE_VERSION,
    rows: rowsDesc,
    latestDate: expectedTradingDay,
    dataAsOf,
    startDate,
    stale,
    message,
    netNewHighs: buildNetNewHighsFromPrecomputed(precomputed),
  };
}

export async function GET() {
  const _perfStart = performance.now();
  const stageMs: Record<string, number> = {};
  const markStart = (label: string) => {
    stageMs[label] = performance.now();
  };
  const markEnd = (label: string) => {
    const started = stageMs[label];
    if (typeof started === "number") {
      stageMs[label] = Math.round(performance.now() - started);
    }
  };

  try {
    const expectedTradingDay = getLatestCompletedTradingDate();
    if (!expectedTradingDay) {
      return NextResponse.json({
        version: CACHE_VERSION,
        rows: [],
        latestDate: null,
        dataAsOf: null,
        startDate: null,
        stale: true,
        message: "No latest trading date in calendar.",
        netNewHighs: { oneMonth: [], threeMonths: [], sixMonths: [], fiftyTwoWeek: [] },
      } satisfies MarketMonitorApiPayload);
    }

    const responseCache = getResponseCacheState();
    const responseCached = responseCache.get();
    if (
      responseCached &&
      responseCached.expectedTradingDay === expectedTradingDay &&
      responseCached.expiresAt > Date.now()
    ) {
      recordPerf("api", "/api/market-monitor", Math.round(performance.now() - _perfStart), {
        meta: { source: "memory-cache", stageMs: { responseCacheHit: 1 } },
      });
      return NextResponse.json(responseCached.payload, {
        headers: marketMonitorHeaders(),
      });
    }

    const end = new Date(expectedTradingDay);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 2);
    const queryStartDate = start.toISOString().slice(0, 10);

    markStart("precomputedQuery");
    const precomputed = getPrecomputedMarketMonitor(queryStartDate, expectedTradingDay);
    markEnd("precomputedQuery");

    if (precomputed.length > 0) {
      const payload = buildPayloadFromPrecomputed(precomputed, expectedTradingDay, queryStartDate);
      responseCache.set({
        expectedTradingDay,
        payload,
        expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
      });
      try {
        writeFileSync(CACHE_PATH, JSON.stringify(payload), "utf8");
      } catch {
        /* ignore */
      }
      recordPerf("api", "/api/market-monitor", Math.round(performance.now() - _perfStart), {
        meta: {
          source: "precomputed",
          stale: payload.stale,
          stageMs,
        },
      });
      return NextResponse.json(payload, { headers: marketMonitorHeaders() });
    }

    // No DB rows: offer disk fallback if file exists from a prior successful run (older version or shape).
    if (existsSync(CACHE_PATH)) {
      try {
        const raw = readFileSync(CACHE_PATH, "utf8");
        const cached = JSON.parse(raw) as MarketMonitorApiPayload & { version?: number };
        if (cached.version === CACHE_VERSION && Array.isArray(cached.rows) && cached.rows.length > 0) {
          const dataAsOf = cached.dataAsOf ?? cached.rows[0]?.date ?? null;
          const stale = true;
          const payload: MarketMonitorApiPayload = {
            ...cached,
            latestDate: expectedTradingDay,
            dataAsOf,
            stale,
            message: `No rows in market_monitor_daily for the current window; showing cached file data through ${dataAsOf}. ${STALE_HINT}`,
          };
          responseCache.set({
            expectedTradingDay,
            payload,
            expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
          });
          recordPerf("api", "/api/market-monitor", Math.round(performance.now() - _perfStart), {
            meta: { source: "disk-fallback-empty-db", stageMs },
          });
          return NextResponse.json(payload, { headers: marketMonitorHeaders() });
        }
      } catch {
        /* ignore */
      }
    }

    const empty: MarketMonitorApiPayload = {
      version: CACHE_VERSION,
      rows: [],
      latestDate: expectedTradingDay,
      dataAsOf: null,
      startDate: null,
      stale: true,
      message: `No Market Monitor data in the database for this range. ${STALE_HINT}`,
      netNewHighs: { oneMonth: [], threeMonths: [], sixMonths: [], fiftyTwoWeek: [] },
    };
    recordPerf("api", "/api/market-monitor", Math.round(performance.now() - _perfStart), {
      meta: { source: "empty", stageMs },
    });
    return NextResponse.json(empty, { headers: marketMonitorHeaders() });
  } catch (e) {
    recordPerf("api", "/api/market-monitor", Math.round(performance.now() - _perfStart), { status: 500 });
    const message = e instanceof Error ? e.message : "Market monitor error";
    return NextResponse.json(
      {
        version: CACHE_VERSION,
        rows: [],
        latestDate: null,
        dataAsOf: null,
        startDate: null,
        stale: true,
        message: message,
        error: message,
        netNewHighs: { oneMonth: [], threeMonths: [], sixMonths: [], fiftyTwoWeek: [] },
      } satisfies MarketMonitorApiPayload,
      { status: 500 }
    );
  }
}
