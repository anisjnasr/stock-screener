import { NextRequest, NextResponse } from "next/server";
import { getOwnershipNative } from "@/lib/screener-db-native";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  try {
    const quarters = getOwnershipNative(symbol.toUpperCase(), 8);
    const latest = quarters[0] ?? null;
    return NextResponse.json({
      quarters,
      latestFundCount: latest?.num_funds ?? 0,
      latestReportDate: latest?.report_date ?? null,
      topHolders: latest?.top_holders ?? [],
    }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
