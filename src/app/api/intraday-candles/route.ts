import { NextRequest, NextResponse } from "next/server";
import { fetchIntradayAggs, type IntradayBarInterval } from "@/lib/massive";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CacheEntry = {
  data: Candle[];
  expiresAt: number;
};

const TTL_MS = 20 * 1000;

const ALLOWED = new Set<IntradayBarInterval>([1, 5, 15, 30, 60, 240]);

/** Lookback per Polygon interval code (Polygon caps apply; tune if needed). */
function windowMsForInterval(interval: IntradayBarInterval): number {
  const h = 60 * 60 * 1000;
  const d = 24 * h;
  switch (interval) {
    case 1:
    case 5:
    case 15:
      return 48 * h;
    case 30:
      return 10 * d;
    case 60:
      return 14 * d;
    case 240:
      return 60 * d;
    default:
      return 48 * h;
  }
}

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    __stockToolIntradayCandlesCache?: Map<string, CacheEntry>;
  };
  if (!g.__stockToolIntradayCandlesCache) {
    g.__stockToolIntradayCandlesCache = new Map();
  }
  return g.__stockToolIntradayCandlesCache;
}

export async function GET(request: NextRequest) {
  if (!process.env.MASSIVE_API_KEY) {
    return NextResponse.json({ error: "MASSIVE_API_KEY is not set" }, { status: 503 });
  }

  const symbol = (request.nextUrl.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const intervalRaw = request.nextUrl.searchParams.get("interval") ?? "5";
  const interval = Number(intervalRaw) as IntradayBarInterval;
  if (!ALLOWED.has(interval)) {
    return NextResponse.json(
      { error: "interval must be 1, 5, 15, 30, 60 (1h), or 240 (4h)" },
      { status: 400 }
    );
  }

  const toMs = Date.now();
  const fromMs = toMs - windowMsForInterval(interval);
  const cacheKey = `${symbol}:${interval}:${Math.floor(toMs / TTL_MS)}`;
  const cache = getCache();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.data, {
      headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" },
    });
  }

  try {
    const data = await fetchIntradayAggs(symbol, interval, fromMs, toMs);
    cache.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Intraday candles error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
