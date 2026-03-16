import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getLatestScreenerDate, getMarketMonitorBaseRows } from "@/lib/screener-db-native";

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
  up13pct_34d: number;
  down13pct_34d: number;
  universe: number;
};

type CachePayload = {
  version: number;
  rows: MarketMonitorRow[];
  latestDate: string | null;
  startDate: string | null;
};

const CACHE_PATH = join(process.cwd(), "data", "market-monitor-cache.json");
const CACHE_VERSION = 2;

export async function GET() {
  try {
    const latest = getLatestScreenerDate();
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

    const baseRows = getMarketMonitorBaseRows(startDate, latestDate);
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
      up13pct_34d: r.up13pct_34d,
      down13pct_34d: r.down13pct_34d,
      universe: r.universe,
    }));

    const rows = withRatiosAsc.sort((a, b) => b.date.localeCompare(a.date));

    const payload: CachePayload = { version: CACHE_VERSION, rows, latestDate, startDate };
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

