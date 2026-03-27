"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export type StockData = {
  quote: {
    symbol: string;
    name: string;
    price: number;
    changesPercentage: number;
    change: number;
    volume: number;
    yearHigh?: number;
    yearLow?: number;
    avgVolume?: number;
    marketCap?: number;
    atrPct21d?: number | null;
    off52WHighPct?: number | null;
  };
  profile?: {
    companyName: string;
    description?: string;
    website?: string;
    sector: string;
    industry: string;
    exchange?: string;
    country?: string;
    ipoDate?: string;
    floatShares?: number;
    sharesOutstanding?: number;
    mktCap?: number;
  };
  nextEarnings?: string;
  rsRank?: {
    rs_pct_1w: number | null;
    rs_pct_1m: number | null;
    rs_pct_3m: number | null;
    rs_pct_6m: number | null;
    rs_pct_12m: number | null;
  } | null;
};

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1500, 3000, 5000];

export function useStockData(symbol: string) {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStock = useCallback(async (sym: string, attempt = 0) => {
    setLoading(true);
    if (attempt === 0) setError(null);
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load");
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdate(new Date());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      if (attempt < MAX_RETRIES) {
        retryRef.current = setTimeout(() => fetchStock(sym, attempt + 1), RETRY_DELAYS[attempt]);
        return;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    setData(null);
    fetchStock(symbol);
    return () => { if (retryRef.current) clearTimeout(retryRef.current); };
  }, [symbol, fetchStock]);

  return { data, loading, error, lastUpdate };
}
