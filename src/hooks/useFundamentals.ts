"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useMemo } from "react";

export type IncomeLine = {
  date: string;
  calendarYear?: string;
  period?: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
  epsGrowth?: number;
  salesGrowth?: number;
};

export type YearlyRow = {
  year: string;
  eps: number | null;
  epsGrowth: number | null;
  sales: number | null;
  salesGrowth: number | null;
};

export type QuarterlyRow = {
  period: string;
  date: string | undefined;
  eps: number | null;
  epsGrowth: number | null;
  sales: number | null;
  salesGrowth: number | null;
};

export function useFundamentals(symbol: string) {
  const [annualFundamentals, setAnnualFundamentals] = useState<IncomeLine[]>([]);
  const [quarterlyFundamentals, setQuarterlyFundamentals] = useState<IncomeLine[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [quarterlyLoading, setQuarterlyLoading] = useState(true);

  useEffect(() => {
    if (!symbol) {
      setAnnualFundamentals([]);
      setQuarterlyFundamentals([]);
      setSidebarLoading(false);
      setQuarterlyLoading(false);
      return;
    }
    let cancelled = false;
    setSidebarLoading(true);
    setQuarterlyLoading(true);

    const annualPromise = fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}&period=annual`)
      .then((r) => r.json().then((d) => (Array.isArray(d) ? d : [])))
      .then((fund) => {
        if (!cancelled) setAnnualFundamentals(fund);
      })
      .catch(() => {
        if (!cancelled) setAnnualFundamentals([]);
      });

    const quarterPromise = fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}&period=quarter`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setQuarterlyFundamentals(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (!cancelled) setQuarterlyFundamentals([]);
      });

    Promise.allSettled([annualPromise, quarterPromise]).finally(() => {
      if (!cancelled) {
        setSidebarLoading(false);
        setQuarterlyLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const yearlyRows = useMemo((): YearlyRow[] => {
    const lines = annualFundamentals as IncomeLine[];
    if (!lines.length) return [];
    const byYear = lines
      .map((l) => ({
        year: l.calendarYear ?? l.date?.slice(0, 4) ?? "",
        eps: l.eps ?? null,
        sales: l.revenue ?? null,
        epsGrowth: typeof l.epsGrowth === "number" ? l.epsGrowth : null,
        salesGrowth: typeof l.salesGrowth === "number" ? l.salesGrowth : null,
      }))
      .filter((r) => r.year)
      .sort((a, b) => b.year.localeCompare(a.year));
    return byYear.map((row, i) => {
      const prev = byYear[i + 1];
      const epsGrowth = row.epsGrowth ??
        (row.eps != null && prev?.eps != null && prev.eps !== 0
          ? ((row.eps - prev.eps) / Math.abs(prev.eps)) * 100
          : null);
      const salesGrowth = row.salesGrowth ??
        (row.sales != null && prev?.sales != null && prev.sales !== 0
          ? ((row.sales - prev.sales) / Math.abs(prev.sales)) * 100
          : null);
      return { year: row.year, eps: row.eps, epsGrowth, sales: row.sales, salesGrowth };
    });
  }, [annualFundamentals]);

  const quarterlyRows = useMemo((): QuarterlyRow[] => {
    const lines = quarterlyFundamentals as IncomeLine[];
    if (!lines.length) return [];
    const withPeriod = lines.map((l) => {
      const yr = l.calendarYear ?? l.date?.slice(0, 4) ?? "";
      const q = l.period ?? "";
      const period = q && yr ? `${q} ${yr}` : q || l.date || "";
      return {
        date: l.date,
        period,
        eps: l.eps ?? null,
        sales: l.revenue ?? null,
        epsGrowth: typeof l.epsGrowth === "number" ? l.epsGrowth : null,
        salesGrowth: typeof l.salesGrowth === "number" ? l.salesGrowth : null,
      };
    });
    const sorted = withPeriod
      .filter((r) => r.period)
      .sort((a, b) => (b.date || b.period).localeCompare(a.date || a.period));
    return sorted.map((row, i) => {
      const prev = sorted[i + 1];
      const epsGrowth = row.epsGrowth ??
        (row.eps != null && prev?.eps != null && prev.eps !== 0
          ? ((row.eps - prev.eps) / Math.abs(prev.eps)) * 100
          : null);
      const salesGrowth = row.salesGrowth ??
        (row.sales != null && prev?.sales != null && prev.sales !== 0
          ? ((row.sales - prev.sales) / Math.abs(prev.sales)) * 100
          : null);
      return { period: row.period, date: row.date, eps: row.eps, epsGrowth, sales: row.sales, salesGrowth };
    });
  }, [quarterlyFundamentals]);

  return { yearlyRows, quarterlyRows, sidebarLoading, quarterlyLoading };
}
