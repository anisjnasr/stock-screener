import { NextRequest, NextResponse } from "next/server";
import { fetchStockNews } from "@/lib/massive";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 15, 50);
  try {
    const data = await fetchStockNews(symbol, limit);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
