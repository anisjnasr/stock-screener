"use client";

import { useState, useEffect, useMemo } from "react";

export type OwnershipQuarter = {
  report_date: string;
  num_funds: number | null;
  num_funds_change: number | null;
  top_holders: Array<{ name: string; value?: number; shares?: number | null }>;
};

type OwnershipState = {
  quarters?: OwnershipQuarter[];
  latestFundCount?: number;
  latestReportDate?: string | null;
  topHolders?: Array<{ name: string; value?: number; shares?: number | null }>;
} | { dateReported?: string }[];

export function useOwnership(symbol: string) {
  const [ownership, setOwnership] = useState<OwnershipState>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    fetch(`/api/ownership?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json().then((d) => (d && typeof d === "object" && "quarters" in d ? d : Array.isArray(d) ? d : {})))
      .then((own) => setOwnership(own ?? {}))
      .catch(() => setOwnership([]))
      .finally(() => setLoading(false));
  }, [symbol]);

  const ownershipData = ownership && typeof ownership === "object" && "quarters" in ownership ? ownership as {
    quarters?: OwnershipQuarter[];
    latestFundCount?: number;
    latestReportDate?: string | null;
    topHolders?: Array<{ name: string; value?: number; shares?: number | null }>;
  } : null;

  const fundCount = ownershipData?.latestFundCount ?? (Array.isArray(ownership) ? ownership.length : 0);
  const fundReportDate = ownershipData?.latestReportDate ?? (Array.isArray(ownership)
    ? (ownership as { dateReported?: string }[]).map((o) => o.dateReported).filter(Boolean).sort().reverse()[0] ?? null
    : null);
  const topHolders = ownershipData?.topHolders ?? [];

  const ownershipQuarters = useMemo(() => {
    const rows = (ownershipData?.quarters ?? []) as OwnershipQuarter[];
    return [...rows]
      .filter((r) => !!r?.report_date)
      .sort((a, b) => b.report_date.localeCompare(a.report_date))
      .slice(0, 8);
  }, [ownershipData]);

  return {
    ownershipData,
    fundCount,
    fundReportDate,
    topHolders,
    ownershipQuarters,
    loading,
  };
}
