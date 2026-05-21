import { NextRequest, NextResponse } from "next/server";
import { getDailyBars, getLatestScreenerDate } from "@/lib/screener-db-native";
import { fetchHistoricalDaily } from "@/lib/massive";
import { addCalendarDaysYmd } from "@/lib/et-ymd";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CandleCacheEntry = {
  data: Candle[];
  expiresAt: number;
};

const API_CANDLES_TTL_MS = 60 * 1000;

async function backfillDailyBarsFromMassive(
  dailyChrono: Candle[],
  symbol: string,
  throughDate: string
): Promise<Candle[]> {
  if (!process.env.MASSIVE_API_KEY || dailyChrono.length === 0) return dailyChrono;

  const lastBarDate = dailyChrono[dailyChrono.length - 1]!.date;
  if (lastBarDate >= throughDate) return dailyChrono;

  try {
    const fromStr = addCalendarDaysYmd(lastBarDate, 1);
    const fetched = await fetchHistoricalDaily(symbol, fromStr, throughDate);
    if (fetched.length === 0) return dailyChrono;

    const byDate = new Map(dailyChrono.map((c) => [c.date, c]));
    for (const bar of fetched) {
      if (bar.date > lastBarDate && bar.date <= throughDate) {
        byDate.set(bar.date, bar);
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return dailyChrono;
  }
}

function getApiCandlesCache(): Map<string, CandleCacheEntry> {
  const globalWithCache = globalThis as typeof globalThis & {
    __stockToolCandlesCache?: Map<string, CandleCacheEntry>;
  };
  if (!globalWithCache.__stockToolCandlesCache) {
    globalWithCache.__stockToolCandlesCache = new Map();
  }
  return globalWithCache.__stockToolCandlesCache;
}

function weekKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return start.toISOString().slice(0, 10);
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function aggregateCandles(daily: Candle[], interval: "weekly" | "monthly"): Candle[] {
  if (daily.length === 0) return [];
  const keyFn = interval === "weekly" ? weekKey : monthKey;
  const map = new Map<string, Candle[]>();
  for (const c of daily) {
    const key = keyFn(c.date);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const result: Candle[] = [];
  for (const [, bars] of map.entries()) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const first = bars[0]!;
    const last = bars[bars.length - 1]!;
    result.push({
      date: last.date,
      open: first.open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: last.close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    });
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "SPY").trim().toUpperCase();
  const interval = request.nextUrl.searchParams.get("interval") || "daily";
  try {
    const latest = getLatestScreenerDate();
    if (!latest) {
      return NextResponse.json({ error: "No screener date available" }, { status: 200 });
    }
    const cacheKey = `${symbol}:${interval}:${latest}`;
    const cache = getApiCandlesCache();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data, {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      });
    }
    if (cached && cached.expiresAt <= Date.now()) {
      cache.delete(cacheKey);
    }
    const DAILY_LIMIT = 5000;
    let bars = getDailyBars(symbol, latest, DAILY_LIMIT);
    if (!bars.length && process.env.MASSIVE_API_KEY) {
      try {
        const from = new Date();
        from.setUTCFullYear(from.getUTCFullYear() - 15);
        const fromStr = from.toISOString().slice(0, 10);
        const live = await fetchHistoricalDaily(symbol, fromStr, latest);
        if (live.length > 0) {
          bars = live
            .filter((c) => c.date <= latest)
            .slice(-DAILY_LIMIT)
            .reverse()
            .map((b) => ({
              date: b.date,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              volume: b.volume,
            }));
        }
      } catch {
        /* fall through to empty */
      }
    }
    if (!bars.length) {
      return NextResponse.json([] as Candle[]);
    }
    let dailyChrono: Candle[] = bars
      .slice()
      .reverse()
      .map((b) => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }));

    if (process.env.MASSIVE_API_KEY) {
      dailyChrono = await backfillDailyBarsFromMassive(dailyChrono, symbol, latest);
    }

    dailyChrono = dailyChrono.filter((c) => c.date <= latest);

    let data: Candle[] = dailyChrono;
    if (interval === "weekly" || interval === "monthly") {
      data = aggregateCandles(dailyChrono, interval as "weekly" | "monthly");
    }
    cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + API_CANDLES_TTL_MS,
    });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Candles error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
