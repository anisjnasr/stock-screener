import { NextRequest, NextResponse } from "next/server";
import { fetchRelatedTickers } from "@/lib/massive";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  if (!symbol.trim()) {
    return NextResponse.json([]);
  }
  try {
    const data = await fetchRelatedTickers(symbol.trim());
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
