"use client";

import { useState, useEffect, useMemo } from "react";

export type IncomeLine = {
  date: string;
  calendarYear?: string;
  period?: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
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
    if (!symbol) return;
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
      }))
      .filter((r) => r.year)
      .sort((a, b) => b.year.localeCompare(a.year));
    return byYear.map((row, i) => {
      const prev = byYear[i + 1];
      const epsGrowth =
        row.eps != null && prev?.eps != null && prev.eps !== 0
          ? ((row.eps - prev.eps) / Math.abs(prev.eps)) * 100
          : null;
      const salesGrowth =
        row.sales != null && prev?.sales != null && prev.sales !== 0
          ? ((row.sales - prev.sales) / Math.abs(prev.sales)) * 100
          : null;
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
      return { date: l.date, period, eps: l.eps ?? null, sales: l.revenue ?? null };
    });
    const sorted = withPeriod
      .filter((r) => r.period)
      .sort((a, b) => (b.date || b.period).localeCompare(a.date || a.period));
    const byYearMonth = new Map<string, (typeof sorted)[number]>();
    for (const r of sorted) {
      if (!r.date) continue;
      const key = `${r.date.slice(0, 4)}-${r.date.slice(5, 7)}`;
      if (!byYearMonth.has(key)) byYearMonth.set(key, r);
    }
    return sorted.map((row, i) => {
      const prev = sorted[i + 1];
      const priorYearSameQuarter = row.date
        ? byYearMonth.get(`${String(Number(row.date.slice(0, 4)) - 1)}-${row.date.slice(5, 7)}`)
        : undefined;
      const useYoY = i === 0 && priorYearSameQuarter;
      const compareRow = useYoY ? priorYearSameQuarter : prev;
      const epsGrowth =
        row.eps != null && compareRow?.eps != null && compareRow.eps !== 0
          ? ((row.eps - compareRow.eps) / Math.abs(compareRow.eps)) * 100
          : null;
      const salesGrowth =
        row.sales != null && compareRow?.sales != null && compareRow.sales !== 0
          ? ((row.sales - compareRow.sales) / Math.abs(compareRow.sales)) * 100
          : null;
      return { period: row.period, date: row.date, eps: row.eps, epsGrowth, sales: row.sales, salesGrowth };
    });
  }, [quarterlyFundamentals]);

  return { yearlyRows, quarterlyRows, sidebarLoading, quarterlyLoading };
}
