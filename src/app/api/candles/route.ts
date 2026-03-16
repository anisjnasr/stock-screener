import { NextRequest, NextResponse } from "next/server";
import { getBarsForSymbol } from "@/lib/nino-script";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

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

async function getLatestScreenerDateFromDb(): Promise<string | null> {
  try {
    const { getLatestScreenerDate } = await import("@/lib/screener-db-native");
    return getLatestScreenerDate();
  } catch {
    const { getLatestScreenerDate } = await import("@/lib/screener-db");
    return getLatestScreenerDate();
  }
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "AAPL").toUpperCase();
  const interval = request.nextUrl.searchParams.get("interval") || "daily";
  try {
    const latest = await getLatestScreenerDateFromDb();
    if (!latest) {
      return NextResponse.json({ error: "No screener date available" }, { status: 200 });
    }
    // Load up to ~10 years of daily history from screener DB (newest-first)
    const DAILY_LIMIT = 2500;
    const bars = await getBarsForSymbol(symbol, latest, DAILY_LIMIT);
    if (!bars.length) {
      return NextResponse.json([] as Candle[]);
    }
    const dailyChrono: Candle[] = bars
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
    let data: Candle[] = dailyChrono;
    if (interval === "weekly" || interval === "monthly") {
      data = aggregateCandles(dailyChrono, interval as "weekly" | "monthly");
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Candles error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
