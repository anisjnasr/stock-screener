import { NextRequest, NextResponse } from "next/server";
import { fetchHistoricalDaily } from "@/lib/massive";

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

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const from = request.nextUrl.searchParams.get("from") || undefined;
  const to = request.nextUrl.searchParams.get("to") || undefined;
  const interval = request.nextUrl.searchParams.get("interval") || "daily";
  try {
    let data = await fetchHistoricalDaily(symbol, from, to);
    if (interval === "weekly" || interval === "monthly") {
      data = aggregateCandles(data, interval);
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
