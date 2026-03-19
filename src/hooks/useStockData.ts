"use client";

import { useState, useCallback, useEffect } from "react";

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
    sector: string;
    industry: string;
    mktCap?: number;
  };
  nextEarnings?: string;
};

export function useStockData(symbol: string) {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStock = useCallback(async (sym: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load");
      }
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStock(symbol);
  }, [symbol, fetchStock]);

  return { data, loading, error, lastUpdate };
}
