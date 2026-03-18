import { NextRequest, NextResponse } from "next/server";
import { fetchIncomeStatement } from "@/lib/massive";
import { getFinancialsNative, getLatestScreenerDate } from "@/lib/screener-db-native";

type IncomeStatementLine = {
  date: string;
  calendarYear?: string;
  period?: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
};

type FundamentalsCacheEntry = {
  data: IncomeStatementLine[];
  expiresAt: number;
};

const FUNDAMENTALS_TTL_MS = 5 * 60 * 1000;

function getFundamentalsCache(): Map<string, FundamentalsCacheEntry> {
  const g = globalThis as typeof globalThis & {
    __stockToolFundamentalsCache?: Map<string, FundamentalsCacheEntry>;
  };
  if (!g.__stockToolFundamentalsCache) g.__stockToolFundamentalsCache = new Map();
  return g.__stockToolFundamentalsCache;
}

function quarterFromDate(date: string): string {
  const month = Number(String(date).slice(5, 7));
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const period = (request.nextUrl.searchParams.get("period") || "annual") as "annual" | "quarter";
  const symbolUpper = String(symbol).toUpperCase();
  const periodType = period === "annual" ? "annual" : "quarterly";
  try {
    const latest = getLatestScreenerDate() ?? "none";
    const cacheKey = `${symbolUpper}:${periodType}:${latest}`;
    const cache = getFundamentalsCache();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }
    if (cached && cached.expiresAt <= Date.now()) cache.delete(cacheKey);

    // DB-first: financials are already persisted locally by refresh scripts.
    const dbRows = getFinancialsNative(symbolUpper, periodType, 40);
    if (dbRows.length > 0) {
      const data: IncomeStatementLine[] = dbRows.map((row) => ({
        date: row.period_end,
        calendarYear: row.period_end.slice(0, 4),
        period: row.period_type === "annual" ? "FY" : quarterFromDate(row.period_end),
        revenue: row.sales ?? undefined,
        netIncome: undefined,
        eps: row.eps ?? undefined,
      }));
      cache.set(cacheKey, { data, expiresAt: Date.now() + FUNDAMENTALS_TTL_MS });
      return NextResponse.json(data);
    }

    // Fallback for symbols missing in local DB.
    const data = await fetchIncomeStatement(symbolUpper, period);
    cache.set(cacheKey, { data, expiresAt: Date.now() + FUNDAMENTALS_TTL_MS });
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
