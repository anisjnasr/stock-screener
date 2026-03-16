import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getLatestCompletedTradingDate,
  getMarketMonitorBaseRowsFromDailyBars,
  getIndexBreadthSnapshot,
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
const CACHE_VERSION = 5;

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
    const startDate = start.toISOString().slice(0, 10);

    // Try cache first; if it matches the current [startDate, latestDate] window, return it.
    if (existsSync(CACHE_PATH)) {
      try {
        const raw = readFileSync(CACHE_PATH, "utf8");
        const cached = JSON.parse(raw) as CachePayload;
        if (
          cached.version === CACHE_VERSION &&
          cached.latestDate === latestDate &&
          cached.startDate === startDate &&
          Array.isArray(cached.rows)
        ) {
          return NextResponse.json(cached);
        }
      } catch {
        // ignore cache errors and recompute below
      }
    }

    let baseRows: ReturnType<typeof getMarketMonitorBaseRowsFromDailyBars> = [];
    let cachedRowsAsc: MarketMonitorRow[] = [];
    let canIncremental = false;
    if (existsSync(CACHE_PATH)) {
      try {
        const raw = readFileSync(CACHE_PATH, "utf8");
        const cached = JSON.parse(raw) as CachePayload;
        if (
          cached.version === CACHE_VERSION &&
          cached.startDate === startDate &&
          Array.isArray(cached.rows) &&
          cached.rows.length > 0
        ) {
          cachedRowsAsc = [...cached.rows].sort((a, b) => a.date.localeCompare(b.date));
          const cachedLatest = cachedRowsAsc[cachedRowsAsc.length - 1]?.date;
          if (cachedLatest && cachedLatest < latestDate) {
            const nextStart = new Date(`${cachedLatest}T00:00:00Z`);
            nextStart.setUTCDate(nextStart.getUTCDate() + 1);
            const nextStartDate = nextStart.toISOString().slice(0, 10);
            const missing = getMarketMonitorBaseRowsFromDailyBars(nextStartDate, latestDate);
            baseRows = [...cachedRowsAsc, ...missing];
            canIncremental = true;
          } else if (cachedLatest === latestDate) {
            baseRows = cachedRowsAsc;
            canIncremental = true;
          }
        }
      } catch {
        // ignore and full recompute below
      }
    }
    if (!canIncremental) {
      baseRows = getMarketMonitorBaseRowsFromDailyBars(startDate, latestDate);
    }
    if (baseRows.length === 0) {
      return NextResponse.json({ rows: [], latestDate, startDate });
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
      universe: r.universe,
    }));

    const rows = withRatiosAsc.sort((a, b) => b.date.localeCompare(a.date));

    const breadthSnapshot = getIndexBreadthSnapshot(latestDate);
    const breadthById = new Map(breadthSnapshot.rows.map((r) => [r.indexId, r]));

    const nnh1m = getNetNewHighSeries(21, 126, latestDate);
    const nnh3m = getNetNewHighSeries(63, 126, latestDate);
    const nnh6m = getNetNewHighSeries(126, 126, latestDate);
    const nnh52w = getNetNewHighSeries(252, 126, latestDate);

    const payload: CachePayload = {
      version: CACHE_VERSION,
      rows,
      latestDate,
      startDate,
      breadth: {
        sp500PctAbove50d: breadthById.get("sp500")?.pctAbove50d ?? null,
        nasdaqPctAbove50d: breadthById.get("nasdaq100")?.pctAbove50d ?? null,
        sp500PctAbove200d: breadthById.get("sp500")?.pctAbove200d ?? null,
        nasdaqPctAbove200d: breadthById.get("nasdaq100")?.pctAbove200d ?? null,
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

