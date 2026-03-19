"use client";

import { useCallback, useRef } from "react";
import type { ChartTimeframe } from "@/components/StockChart";

export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CachedCandlesEntry = {
  data: Candle[];
  expiresAt: number;
};

const CANDLE_CACHE_TTL_MS = 5 * 60 * 1000;
const CANDLE_CACHE_MAX_ENTRIES = 100;

function candlesCacheKey(symbol: string, timeframe: ChartTimeframe): string {
  return `${symbol.toUpperCase()}:${timeframe}`;
}

export function useCandleCache() {
  const cacheRef = useRef<Map<string, CachedCandlesEntry>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<Candle[] | null>>>(new Map());

  const getCachedCandles = useCallback((sym: string, tf: ChartTimeframe): Candle[] | null => {
    const key = candlesCacheKey(sym, tf);
    const entry = cacheRef.current.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      cacheRef.current.delete(key);
      return null;
    }
    cacheRef.current.delete(key);
    cacheRef.current.set(key, entry);
    return entry.data;
  }, []);

  const setCachedCandles = useCallback((sym: string, tf: ChartTimeframe, data: Candle[]) => {
    const key = candlesCacheKey(sym, tf);
    cacheRef.current.delete(key);
    cacheRef.current.set(key, {
      data,
      expiresAt: Date.now() + CANDLE_CACHE_TTL_MS,
    });
    while (cacheRef.current.size > CANDLE_CACHE_MAX_ENTRIES) {
      const oldest = cacheRef.current.keys().next().value;
      if (!oldest) break;
      cacheRef.current.delete(oldest);
    }
  }, []);

  const fetchCandlesFor = useCallback(
    async (
      sym: string,
      tf: ChartTimeframe,
      opts?: { signal?: AbortSignal }
    ): Promise<Candle[] | null> => {
      const key = candlesCacheKey(sym, tf);
      const cached = getCachedCandles(sym, tf);
      if (cached) return cached;
      if (!opts?.signal) {
        const inFlight = inFlightRef.current.get(key);
        if (inFlight) return inFlight;
      }
      const run = async (): Promise<Candle[] | null> => {
        try {
          const to = new Date();
          const from = new Date();
          from.setFullYear(from.getFullYear() - 20);
          const fromStr = from.toISOString().slice(0, 10);
          const toStr = to.toISOString().slice(0, 10);
          const res = await fetch(
            `/api/candles?symbol=${encodeURIComponent(sym)}&from=${fromStr}&to=${toStr}&interval=${tf}`,
            { signal: opts?.signal }
          );
          const d = await res.json();
          if (!Array.isArray(d)) return null;
          setCachedCandles(sym, tf, d);
          return d;
        } catch {
          return null;
        } finally {
          if (!opts?.signal) inFlightRef.current.delete(key);
        }
      };
      if (!opts?.signal) {
        const task = run();
        inFlightRef.current.set(key, task);
        return task;
      }
      try {
        return await run();
      } catch {
        return null;
      }
    },
    [getCachedCandles, setCachedCandles]
  );

  return { getCachedCandles, setCachedCandles, fetchCandlesFor };
}
