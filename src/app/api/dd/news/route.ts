import { NextRequest, NextResponse } from "next/server";
import { fetchDDNews } from "@/lib/dd/news";
import { normalizeTicker } from "@/lib/dd/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dd/news?ticker=XYZ — company news (spec §5.6).
 * Fast + independent so the news card paints first, ahead of everything else.
 */
export async function GET(request: NextRequest) {
  const ticker = normalizeTicker(request.nextUrl.searchParams.get("ticker"));
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Invalid or missing ticker" }, { status: 400 });
  }
  try {
    const news = await fetchDDNews(ticker, request.signal);
    return NextResponse.json({ ok: true, ticker, news });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
