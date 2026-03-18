import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getLatestCompletedTradingDate,
  getMarketMonitorBaseRowsFromDailyBars,
  getIndexBreadthSeries,
  getNetNewHighSeries,
} from "@/lib/screener-db-native";

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
  sp500PctAbove50d: number | null;
  sp500PctAbove200d: number | null;
  nasdaqPctAbove50d: number | null;
  nasdaqPctAbove200d: number | null;
  universe: number;
};

type CachePayload = {
  version: number;
  rows: MarketMonitorRow[];
  latestDate: string | null;
  startDate: string | null;
  breadth: {
    sp500PctAbove50d: number | null;
    nasdaqPctAbove50d: number | null;
    sp500PctAbove200d: number | null;
    nasdaqPctAbove200d: number | null;
  };
  netNewHighs: {
    oneMonth: Array<{ date: string; highs: number; lows: number; net: number }>;
    threeMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    sixMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    fiftyTwoWeek: Array<{ date: string; highs: number; lows: number; net: number }>;
  };
};

const CACHE_PATH = join(process.cwd(), "data", "market-monitor-cache.json");
const CACHE_VERSION = 11;
const TRADING_DAYS_PER_YEAR = 252;
const TWO_YEARS_TRADING_DAYS = TRADING_DAYS_PER_YEAR * 2;

export async function GET() {
  try {
    const latest = getLatestCompletedTradingDate();
    if (!latest) {
      return NextResponse.json({ rows: [], latestDate: null, startDate: null });
    }
    const latestDate = latest;
    const end = new Date(latestDate);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 2);
    const queryStartDate = start.toISOString().slice(0, 10);

    let cachedPayload: CachePayload | null = null;
    // Try cache first; if it matches the current [startDate, latestDate] window, return it.
    if (existsSync(CACHE_PATH)) {
      try {
        const raw = readFileSync(CACHE_PATH, "utf8");
        const cached = JSON.parse(raw) as CachePayload;
        cachedPayload = cached;
        if (
          cached.version === CACHE_VERSION &&
          cached.latestDate === latestDate &&
          Array.isArray(cached.rows)
        ) {
          return NextResponse.json(cached);
        }
      } catch {
        // ignore cache errors and recompute below
        cachedPayload = null;
      }
    }

    let baseRows: ReturnType<typeof getMarketMonitorBaseRowsFromDailyBars> = [];
    let cachedRowsAsc: MarketMonitorRow[] = [];
    let canIncremental = false;
    let incrementalStartDate: string | null = null;
    if (
      cachedPayload &&
      cachedPayload.version === CACHE_VERSION &&
      Array.isArray(cachedPayload.rows) &&
      cachedPayload.rows.length > 0
    ) {
      cachedRowsAsc = [...cachedPayload.rows].sort((a, b) => a.date.localeCompare(b.date));
      const cachedLatest = cachedRowsAsc[cachedRowsAsc.length - 1]?.date;
      if (cachedLatest && cachedLatest < latestDate) {
        const nextStart = new Date(`${cachedLatest}T00:00:00Z`);
        nextStart.setUTCDate(nextStart.getUTCDate() + 1);
        incrementalStartDate = nextStart.toISOString().slice(0, 10);
        const missing = getMarketMonitorBaseRowsFromDailyBars(incrementalStartDate, latestDate);
        baseRows = [...cachedRowsAsc, ...missing];
        canIncremental = true;
      } else if (cachedLatest === latestDate) {
        baseRows = cachedRowsAsc;
        canIncremental = true;
      }
    }
    if (!canIncremental) {
      baseRows = getMarketMonitorBaseRowsFromDailyBars(queryStartDate, latestDate);
    }
    baseRows = baseRows.filter((r) => r.date >= queryStartDate);
    if (baseRows.length === 0) {
      return NextResponse.json({ rows: [], latestDate, startDate: null });
    }

    // Compute 5-day and 10-day ratios using rolling sums of up4/down4.
    const rowsAsc = [...baseRows].sort((a, b) => a.date.localeCompare(b.date));
    const prefixUp: number[] = [];
    const prefixDown: number[] = [];
    for (let i = 0; i < rowsAsc.length; i++) {
      const prevUp = i > 0 ? prefixUp[i - 1] : 0;
      const prevDown = i > 0 ? prefixDown[i - 1] : 0;
      prefixUp[i] = prevUp + rowsAsc[i].up4pct;
      prefixDown[i] = prevDown + rowsAsc[i].down4pct;
    }

    function windowRatio(endIdx: number, window: number): number | null {
      const startIdx = Math.max(0, endIdx - window + 1);
      const up = prefixUp[endIdx] - (startIdx > 0 ? prefixUp[startIdx - 1] : 0);
      const down = prefixDown[endIdx] - (startIdx > 0 ? prefixDown[startIdx - 1] : 0);
      if (down <= 0) return null;
      return up / down;
    }

    const sp500ByDate = new Map<string, { pctAbove50d: number | null; pctAbove200d: number | null }>();
    const nasdaqByDate = new Map<string, { pctAbove50d: number | null; pctAbove200d: number | null }>();
    if (canIncremental && cachedRowsAsc.length > 0 && incrementalStartDate) {
      for (const r of cachedRowsAsc) {
        sp500ByDate.set(r.date, {
          pctAbove50d: r.sp500PctAbove50d ?? null,
          pctAbove200d: r.sp500PctAbove200d ?? null,
        });
        nasdaqByDate.set(r.date, {
          pctAbove50d: r.nasdaqPctAbove50d ?? null,
          pctAbove200d: r.nasdaqPctAbove200d ?? null,
        });
      }
      const sp500Missing = getIndexBreadthSeries("sp500", incrementalStartDate, latestDate);
      const nasdaqMissing = getIndexBreadthSeries("nasdaq", incrementalStartDate, latestDate);
      for (const r of sp500Missing.rows) {
        sp500ByDate.set(r.date, { pctAbove50d: r.pctAbove50d, pctAbove200d: r.pctAbove200d });
      }
      for (const r of nasdaqMissing.rows) {
        nasdaqByDate.set(r.date, { pctAbove50d: r.pctAbove50d, pctAbove200d: r.pctAbove200d });
      }
    } else {
      const sp500BreadthSeries = getIndexBreadthSeries("sp500", queryStartDate, latestDate);
      const nasdaqBreadthSeries = getIndexBreadthSeries("nasdaq", queryStartDate, latestDate);
      for (const r of sp500BreadthSeries.rows) {
        sp500ByDate.set(r.date, { pctAbove50d: r.pctAbove50d, pctAbove200d: r.pctAbove200d });
      }
      for (const r of nasdaqBreadthSeries.rows) {
        nasdaqByDate.set(r.date, { pctAbove50d: r.pctAbove50d, pctAbove200d: r.pctAbove200d });
      }
    }

    const withRatiosAsc: MarketMonitorRow[] = rowsAsc.map((r, idx) => ({
      date: r.date,
      up4pct: r.up4pct,
      down4pct: r.down4pct,
      ratio5d: windowRatio(idx, 5),
      ratio10d: windowRatio(idx, 10),
      up25pct_qtr: r.up25pct_qtr,
      down25pct_qtr: r.down25pct_qtr,
      up25pct_month: r.up25pct_month,
      down25pct_month: r.down25pct_month,
      up50pct_month: r.up50pct_month,
      down50pct_month: r.down50pct_month,
      sp500PctAbove50d: sp500ByDate.get(r.date)?.pctAbove50d ?? null,
      sp500PctAbove200d: sp500ByDate.get(r.date)?.pctAbove200d ?? null,
      nasdaqPctAbove50d: nasdaqByDate.get(r.date)?.pctAbove50d ?? null,
      nasdaqPctAbove200d: nasdaqByDate.get(r.date)?.pctAbove200d ?? null,
      universe: r.universe,
    }));

    const rows = withRatiosAsc.sort((a, b) => b.date.localeCompare(a.date));
    const latestRow = rows[0] ?? null;
    const responseStartDate = rows[rows.length - 1]?.date ?? null;

    const nnh1m = getNetNewHighSeries(21, 126, latestDate);
    const nnh3m = getNetNewHighSeries(63, 126, latestDate);
    const nnh6m = getNetNewHighSeries(126, 126, latestDate);
    // 52W NNH is a rolling daily metric; keep at least 2 years of points so
    // the MM mini-chart remains fully populated.
    const nnh52w = getNetNewHighSeries(252, TWO_YEARS_TRADING_DAYS, latestDate);

    const payload: CachePayload = {
      version: CACHE_VERSION,
      rows,
      latestDate,
      startDate: responseStartDate,
      breadth: {
        sp500PctAbove50d: latestRow?.sp500PctAbove50d ?? null,
        nasdaqPctAbove50d: latestRow?.nasdaqPctAbove50d ?? null,
        sp500PctAbove200d: latestRow?.sp500PctAbove200d ?? null,
        nasdaqPctAbove200d: latestRow?.nasdaqPctAbove200d ?? null,
      },
      netNewHighs: {
        oneMonth: nnh1m.rows,
        threeMonths: nnh3m.rows,
        sixMonths: nnh6m.rows,
        fiftyTwoWeek: nnh52w.rows,
      },
    };
    try {
      writeFileSync(CACHE_PATH, JSON.stringify(payload), "utf8");
    } catch {
      // ignore cache write errors
    }

    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Market monitor error";
    return NextResponse.json({ rows: [], error: message }, { status: 500 });
  }
}

