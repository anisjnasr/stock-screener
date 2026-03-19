import { NextRequest, NextResponse } from "next/server";
import { fetchIncomeStatement } from "@/lib/massive";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const period = (request.nextUrl.searchParams.get("period") || "annual") as "annual" | "quarter";
  try {
    const data = await fetchIncomeStatement(symbol, period);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
