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

    const annualPromise = fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}&period=annual`, {
      cache: "no-store",
    })
      .then((r) => r.json().then((d) => (Array.isArray(d) ? d : [])))
      .then((fund) => {
        if (!cancelled) setAnnualFundamentals(fund);
      })
      .catch(() => {
        if (!cancelled) setAnnualFundamentals([]);
      });

    const quarterPromise = fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}&period=quarter`, {
      cache: "no-store",
    })
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
    return lines
      .map((l) => ({
        year: l.calendarYear ?? l.date?.slice(0, 4) ?? "",
        eps: l.eps ?? null,
        sales: l.revenue ?? null,
        epsGrowth: typeof l.epsGrowth === "number" ? l.epsGrowth : null,
        salesGrowth: typeof l.salesGrowth === "number" ? l.salesGrowth : null,
      }))
      .filter((r) => r.year)
      .sort((a, b) => b.year.localeCompare(a.year))
      .map((row) => ({
        year: row.year,
        eps: row.eps,
        epsGrowth: row.epsGrowth,
        sales: row.sales,
        salesGrowth: row.salesGrowth,
      }));
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
    // Rev % / EPS %: use DB YoY only (api/fundamentals maps eps_growth_yoy / sales_growth_yoy). No QoQ fallback.
    return sorted.map((row) => ({
      period: row.period,
      date: row.date,
      eps: row.eps,
      epsGrowth: row.epsGrowth,
      sales: row.sales,
      salesGrowth: row.salesGrowth,
    }));
  }, [quarterlyFundamentals]);

  return { yearlyRows, quarterlyRows, sidebarLoading, quarterlyLoading };
}
