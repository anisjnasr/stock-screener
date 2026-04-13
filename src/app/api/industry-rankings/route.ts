import { NextResponse } from "next/server";
import {
  getAllIndustryNames,
  getLatestCompletedTradingDate,
  getScreenerSnapshot,
  getWeightedCategoryPerformance,
  type PerformanceTimeframe,
} from "@/lib/screener-db-native";

type IndustryRankingRow = {
  industry: string;
  industry_rank_1m: number | null;
  industry_rank_3m: number | null;
  industry_rank_6m: number | null;
  industry_rank_12m: number | null;
  price_change_1m_pct: number | null;
  price_change_3m_pct: number | null;
  price_change_6m_pct: number | null;
  price_change_12m_pct: number | null;
};

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseIndustry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export async function GET() {
  try {
    const asOfDate = getLatestCompletedTradingDate() ?? undefined;
    const snapshot = getScreenerSnapshot({ date: asOfDate, limit: 20000, includeFinancialExtras: false });
    const byIndustry = new Map<string, IndustryRankingRow>();

    for (const row of snapshot.rows) {
      const industry = parseIndustry(row.industry);
      if (!industry) continue;
      const existing = byIndustry.get(industry);
      if (!existing) {
        byIndustry.set(industry, {
          industry,
          industry_rank_1m: toNumberOrNull(row.industry_rank_1m),
          industry_rank_3m: toNumberOrNull(row.industry_rank_3m),
          industry_rank_6m: toNumberOrNull(row.industry_rank_6m),
          industry_rank_12m: toNumberOrNull(row.industry_rank_12m),
          price_change_1m_pct: null,
          price_change_3m_pct: null,
          price_change_6m_pct: null,
          price_change_12m_pct: null,
        });
        continue;
      }

      if (existing.industry_rank_1m == null) existing.industry_rank_1m = toNumberOrNull(row.industry_rank_1m);
      if (existing.industry_rank_3m == null) existing.industry_rank_3m = toNumberOrNull(row.industry_rank_3m);
      if (existing.industry_rank_6m == null) existing.industry_rank_6m = toNumberOrNull(row.industry_rank_6m);
      if (existing.industry_rank_12m == null) existing.industry_rank_12m = toNumberOrNull(row.industry_rank_12m);
    }

    // Ensure the list covers the full yfinance-classified industry universe,
    // even if some industries currently have no ranked constituents.
    for (const industry of getAllIndustryNames()) {
      if (byIndustry.has(industry)) continue;
      byIndustry.set(industry, {
        industry,
        industry_rank_1m: null,
        industry_rank_3m: null,
        industry_rank_6m: null,
        industry_rank_12m: null,
        price_change_1m_pct: null,
        price_change_3m_pct: null,
        price_change_6m_pct: null,
        price_change_12m_pct: null,
      });
    }

    const loadChangeMap = (timeframe: PerformanceTimeframe): Map<string, number | null> => {
      const result = getWeightedCategoryPerformance("industry", timeframe, asOfDate);
      return new Map(
        result.rows.map((r) => [String(r.name), toNumberOrNull(r.change_pct)]),
      );
    };

    const change1m = loadChangeMap("month");
    const change3m = loadChangeMap("quarter");
    const change6m = loadChangeMap("half_year");
    const change12m = loadChangeMap("year");

    const rows: IndustryRankingRow[] = Array.from(byIndustry.values())
      .map((row) => ({
        ...row,
        price_change_1m_pct: change1m.get(row.industry) ?? null,
        price_change_3m_pct: change3m.get(row.industry) ?? null,
        price_change_6m_pct: change6m.get(row.industry) ?? null,
        price_change_12m_pct: change12m.get(row.industry) ?? null,
      }))
      .sort((a, b) => {
        const aRank = a.industry_rank_12m;
        const bRank = b.industry_rank_12m;
        if (aRank == null && bRank == null) return a.industry.localeCompare(b.industry);
        if (aRank == null) return 1;
        if (bRank == null) return -1;
        return aRank - bRank;
      });

    return NextResponse.json(
      {
        date: snapshot.date,
        asOfDate: asOfDate ?? snapshot.date,
        rows,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build industry rankings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

