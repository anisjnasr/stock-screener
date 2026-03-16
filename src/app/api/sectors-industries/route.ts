import { NextRequest, NextResponse } from "next/server";
import {
  getTickerPerformance,
  getWeightedCategoryPerformance,
  type PerformanceTimeframe,
} from "@/lib/screener-db-native";
import { THEMATIC_ETFS } from "@/lib/thematic-etfs";

const INDEX_ITEMS = [
  { id: "sp500", name: "S&P 500", ticker: "SPY" },
  { id: "nasdaq100", name: "Nasdaq 100", ticker: "QQQ" },
  { id: "russell2000", name: "Russell 2000", ticker: "IWM" },
] as const;

type TimeframeParam = "day" | "week" | "month" | "quarter" | "year";

function parseTimeframe(value: string | null): TimeframeParam {
  if (value === "day" || value === "week" || value === "month" || value === "quarter" || value === "year") {
    return value;
  }
  return "day";
}

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const timeframe = parseTimeframe(request.nextUrl.searchParams.get("timeframe"));
    const sectorResult = getWeightedCategoryPerformance("sector", timeframe as PerformanceTimeframe);
    const industryResult = getWeightedCategoryPerformance("industry", timeframe as PerformanceTimeframe, sectorResult.date ?? undefined);

    const indexPerf = getTickerPerformance(
      INDEX_ITEMS.map((x) => x.ticker),
      timeframe as PerformanceTimeframe,
      sectorResult.date ?? undefined
    );
    const themePerf = getTickerPerformance(
      THEMATIC_ETFS.map((x) => x.ticker),
      timeframe as PerformanceTimeframe,
      sectorResult.date ?? undefined
    );

    const indexMap = new Map(indexPerf.rows.map((r) => [r.symbol, r]));
    const themeMap = new Map(themePerf.rows.map((r) => [r.symbol, r]));

    return NextResponse.json({
      timeframe,
      date: sectorResult.date,
      indices: INDEX_ITEMS.map((item) => ({
        id: item.id,
        name: item.name,
        ticker: item.ticker,
        changePct: indexMap.get(item.ticker)?.change_pct ?? null,
      })),
      sectors: sectorResult.rows.map((r) => ({
        id: toSlug(r.name),
        name: r.name,
        changePct: r.change_pct,
        totalMarketCap: r.total_market_cap,
        stockCount: r.stock_count,
      })),
      industries: industryResult.rows.map((r) => ({
        id: toSlug(r.name),
        name: r.name,
        changePct: r.change_pct,
        totalMarketCap: r.total_market_cap,
        stockCount: r.stock_count,
      })),
      themes: THEMATIC_ETFS.map((item) => ({
        id: item.id,
        category: item.category,
        name: item.theme,
        ticker: item.ticker,
        changePct: themeMap.get(item.ticker)?.change_pct ?? null,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to compute sectors/industries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

