import { NextRequest, NextResponse } from "next/server";
import { fetchQuote, fetchProfile, isAllowedTickerType } from "@/lib/massive";
import { getAvgVolumeBatch } from "@/lib/screener-db-native";

const MAX_SYMBOLS = 50;

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) {
    return NextResponse.json([]);
  }
  try {
    const avgVolMap = getAvgVolumeBatch(symbols, 30);
    const results = await Promise.all(
      symbols.map(async (sym) => {
        const [quote, profile] = await Promise.all([
          fetchQuote(sym),
          fetchProfile(sym),
        ]);
        const name =
          profile?.companyName ??
          (quote as { name?: string; companyName?: string })?.name ??
          (quote as { companyName?: string })?.companyName ??
          sym;
        const dbAvgVol = avgVolMap.get(sym);
        return {
          symbol: sym,
          quote: quote
            ? {
                ...quote,
                name,
                price: (quote as { price?: number }).price,
                changesPercentage: (quote as { changesPercentage?: number }).changesPercentage,
                change: (quote as { change?: number }).change,
                volume: (quote as { volume?: number }).volume,
                avgVolume: dbAvgVol ?? (quote as { avgVolume?: number }).avgVolume,
                marketCap: (quote as { marketCap?: number }).marketCap ?? profile?.mktCap,
              }
            : null,
          profile: profile ?? null,
        };
      })
    );
    const allowed = results.filter((r) => isAllowedTickerType(r.profile?.type));
    return NextResponse.json(allowed, {
      headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
