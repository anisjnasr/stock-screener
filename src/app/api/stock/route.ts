import { NextRequest, NextResponse } from "next/server";
import { fetchQuote, fetchProfile } from "@/lib/massive";
import { fetchNextEarningsDate } from "@/lib/yahoo-earnings";
import { getStockRecord } from "@/lib/stocks-db";

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

    const mergedProfile =
      profileNorm || profile || stockRecord
        ? {
            ...(profile ?? {}),
            ...(profileNorm ?? {}),
            ...(stockRecord ?? {}),
            sector:
              profileNorm?.sector ??
              stockRecord?.sector ??
              (profile as { sector?: string } | null | undefined)?.sector,
            industry:
              profileNorm?.industry ??
              stockRecord?.industry ??
              (profile as { industry?: string } | null | undefined)?.industry,
            exchange:
              profileNorm?.exchange ??
              stockRecord?.exchange ??
              (profile as { exchange?: string } | null | undefined)?.exchange,
          }
        : undefined;

    return NextResponse.json({
      quote: { ...quote, name },
      profile: mergedProfile,
      nextEarnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
