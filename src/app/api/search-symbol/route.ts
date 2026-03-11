import { NextRequest, NextResponse } from "next/server";
import { fetchSearchSymbol, fetchProfile, isAllowedTickerType } from "@/lib/massive";

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("query") ?? request.nextUrl.searchParams.get("q") ?? "").trim().toUpperCase();
  if (!query) {
    return NextResponse.json([]);
  }
  try {
    const data = await fetchSearchSymbol(query);
    const list = Array.isArray(data) ? data : [];
    type Item = { symbol?: string; name?: string };
    // API matches on name/description too, so we get tickers like DIPS when searching "NVDA" (name contains NVDA).
    // Prefer ticker-only matches for ticker-like queries so autocomplete shows symbols that actually match.
    const bySymbol = list.filter(
      (item: Item) => typeof item.symbol === "string" && item.symbol.toUpperCase().includes(query)
    );
    let filtered = bySymbol.length > 0
      ? bySymbol
      : list.filter(
          (item: Item) =>
            (typeof item.symbol === "string" && item.symbol.toUpperCase().includes(query)) ||
            (typeof item.name === "string" && item.name.toUpperCase().includes(query))
        );

    // Only include CS, ADRC, ETF
    filtered = filtered.filter((item: Item & { type?: string }) => isAllowedTickerType(item.type));

    // If query looks like a ticker and exact symbol isn't in results, try fetching by exact ticker (e.g. COIN)
    const looksLikeTicker = /^[A-Z]{1,5}$/.test(query);
    const hasExact = filtered.some((item: Item) => item.symbol?.toUpperCase() === query);
    if (looksLikeTicker && !hasExact) {
      const profile = await fetchProfile(query);
      if (profile && isAllowedTickerType(profile.type)) {
        filtered = [{ symbol: profile.symbol, name: profile.companyName }, ...filtered];
      }
    }

    return NextResponse.json(filtered);
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
