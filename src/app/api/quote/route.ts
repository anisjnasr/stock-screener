import { NextRequest, NextResponse } from "next/server";
import { fetchQuote } from "@/lib/massive";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  try {
    const raw = await fetchQuote(symbol);
    if (!raw) return NextResponse.json({ error: "Symbol not found" }, { status: 404 });
    const quote = {
      ...raw,
      name: (raw as { name?: string; companyName?: string }).name ?? (raw as { companyName?: string }).companyName ?? raw.symbol,
    };
    return NextResponse.json(quote, {
      headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
