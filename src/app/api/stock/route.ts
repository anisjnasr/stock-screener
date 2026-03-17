import { NextRequest, NextResponse } from "next/server";
import { fetchQuote, fetchProfile } from "@/lib/massive";
import { fetchNextEarningsDate } from "@/lib/yahoo-earnings";
import { getStockRecord } from "@/lib/stocks-db";
import { getCompanyClassification, getScreenerSnapshot } from "@/lib/screener-db-native";
import { isUSMarketOpen } from "@/lib/market-hours";

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

function normalizeProfile(raw: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    companyName: pickStr(raw as Record<string, unknown>, "companyName", "Company Name", "name"),
    description: pickStr(raw as Record<string, unknown>, "description", "Description"),
    website: pickStr(raw as Record<string, unknown>, "website", "Website", "url"),
    exchange: pickStr(raw as Record<string, unknown>, "exchange", "Exchange", "exchangeShortName"),
    country: pickStr(raw as Record<string, unknown>, "country", "Country"),
    industry: pickStr(raw as Record<string, unknown>, "industry", "Industry"),
    sector: pickStr(raw as Record<string, unknown>, "sector", "Sector"),
    ipoDate: pickStr(raw as Record<string, unknown>, "ipoDate", "ipo date"),
    floatShares: typeof raw.floatShares === "number" ? raw.floatShares : typeof raw.sharesFloat === "number" ? raw.sharesFloat : undefined,
    sharesOutstanding: typeof raw.sharesOutstanding === "number" ? raw.sharesOutstanding : undefined,
    mktCap: raw.mktCap ?? raw.marketCap,
  };
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  try {
    const [quote, profile, nextEarnings] = await Promise.all([
      fetchQuote(symbol),
      fetchProfile(symbol),
      fetchNextEarningsDate(symbol),
    ]);
    if (!quote)
      return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
    const name =
      (quote as { name?: string; companyName?: string }).name ??
      (quote as { companyName?: string }).companyName ??
      profile?.companyName ??
      quote.symbol;
    const profileNorm = normalizeProfile(profile as Record<string, unknown> | null);
    const stockRecord = getStockRecord(symbol);
    const companyClass = getCompanyClassification(symbol);
    const dbSnapshot = getScreenerSnapshot({ symbols: [symbol.toUpperCase()], limit: 1 });
    const dbRow = dbSnapshot.rows[0] ?? null;

    const mergedProfile =
      profileNorm || profile || stockRecord
        ? {
            ...(profile ?? {}),
            ...(profileNorm ?? {}),
            ...(stockRecord ?? {}),
            sector:
              profileNorm?.sector ??
              companyClass?.sector ??
              stockRecord?.sector ??
              (profile as { sector?: string } | null | undefined)?.sector,
            industry:
              profileNorm?.industry ??
              companyClass?.industry ??
              stockRecord?.industry ??
              (profile as { industry?: string } | null | undefined)?.industry,
            exchange:
              profileNorm?.exchange ??
              companyClass?.exchange ??
              stockRecord?.exchange ??
              (profile as { exchange?: string } | null | undefined)?.exchange,
          }
        : undefined;

    const marketOpen = isUSMarketOpen();
    const quoteWithFallback = {
      ...quote,
      name,
      price:
        typeof quote.price === "number" && quote.price > 0
          ? quote.price
          : dbRow?.last_price ?? quote.price,
      changesPercentage:
        !marketOpen && typeof dbRow?.change_pct === "number"
          ? dbRow.change_pct
          : typeof quote.changesPercentage === "number"
            ? quote.changesPercentage
            : dbRow?.change_pct ?? 0,
      change:
        !marketOpen && typeof dbRow?.change_pct === "number"
          ? ((dbRow.last_price ?? quote.price ?? 0) * dbRow.change_pct) / 100
          : quote.change,
      volume:
        typeof quote.volume === "number" && quote.volume > 0
          ? quote.volume
          : dbRow?.volume ?? quote.volume,
      avgVolume:
        typeof quote.avgVolume === "number" && quote.avgVolume > 0
          ? quote.avgVolume
          : dbRow?.avg_volume_30d_shares ?? quote.avgVolume,
      yearHigh:
        typeof dbRow?.high_52w === "number" && dbRow.high_52w > 0
          ? dbRow.high_52w
          : quote.yearHigh,
      marketCap:
        typeof dbRow?.market_cap === "number" && dbRow.market_cap > 0
          ? dbRow.market_cap
          : typeof quote.marketCap === "number" && quote.marketCap > 0
            ? quote.marketCap
            : (mergedProfile as { mktCap?: number } | undefined)?.mktCap,
      off52WHighPct: dbRow?.off_52w_high_pct ?? null,
      atrPct21d:
        typeof dbRow?.atr_pct_21d === "number" && dbRow.atr_pct_21d > 0 ? dbRow.atr_pct_21d : null,
    };

    return NextResponse.json({
      quote: quoteWithFallback,
      profile: mergedProfile,
      nextEarnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
