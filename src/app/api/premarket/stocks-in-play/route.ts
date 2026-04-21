import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { getTickersWithEarningsInLast24Hours } from "@/lib/premarket/earnings-recent";
import { loadGappersScanOnly, normalizeGappersScanBody } from "@/lib/premarket/gappers-ingest";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "@/lib/python-service";
import type { TradingViewScanParams } from "@/lib/sources/tradingViewScreener";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";

export const dynamic = "force-dynamic";

/** SIP scan: slightly tighter than generic gappers defaults; body still overrides within clamps. */
function sipScanFromBody(body: unknown): TradingViewScanParams {
  const n = normalizeGappersScanBody(body);
  return {
    ...n,
    minPrice: Math.max(3, n.minPrice),
    minMarketCap: Math.max(250_000_000, n.minMarketCap),
    minGapPct: Math.max(1, n.minGapPct),
  };
}

/**
 * Pre-market “Stocks in Play”: TradingView gappers plus optional yfinance headlines (Python service).
 * POST JSON body — same optional fields as `/api/movers/gappers` (see `GappersRequestBody`).
 */
export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const scan = sipScanFromBody(body);
  const cacheKey = JSON.stringify(scan);

  try {
    const base = await unstable_cache(
      async () => loadGappersScanOnly(scan, { rowLimit: 30 }),
      ["premarket-sip-gappers", cacheKey],
      { revalidate: 30 }
    )();

    const earnings = await getTickersWithEarningsInLast24Hours();
    const rows = base.rows.map((r) => ({
      ...r,
      earningsRecent24h: earnings.has(r.ticker),
    }));

    const tickers = rows.map((r) => r.ticker);
    let news: StocksInPlaySuccess["news"] = null;
    let newsError: string | null = null;

    if (tickers.length > 0 && isPythonServiceConfigured()) {
      try {
        const pack = await fetchPythonTickerNews({
          tickers,
          hoursBack: 24,
          signal: request.signal,
        });
        news = pack.data;
      } catch (e) {
        newsError = e instanceof Error ? e.message : "Unknown error";
      }
    }

    const out: StocksInPlaySuccess = {
      ok: true,
      source: base.source,
      rows,
      pythonConfigured: isPythonServiceConfigured(),
      news,
      newsError,
    };

    return NextResponse.json(out, {
      headers: {
        "Cache-Control": "private, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
