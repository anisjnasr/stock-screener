import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { generateSipCatalystMap } from "@/lib/ai/sipCatalyst";
import { ymdInEt } from "@/lib/et-ymd";
import { getTickersWithEarningsInLast24Hours } from "@/lib/premarket/earnings-recent";
import { loadGappersSipScan, normalizeGappersScanBody } from "@/lib/premarket/gappers-ingest";
import { fetchDailyThemesForDate, summarizeThemesForMacroPrompt } from "@/lib/premarket/dailyThemesRead";
import { isSipVolumeCandidate } from "@/lib/premarket/sip-candidate-filter";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "@/lib/python-service";
import { getSupabase } from "@/lib/supabase";
import type { TradingViewScanParams } from "@/lib/sources/tradingViewScreener";
import { TRADINGVIEW_GAP_SCAN_ROW_CAP } from "@/lib/sources/tradingViewScreener";
import type { GapperRow } from "@/types/gappers";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";

export const dynamic = "force-dynamic";

/** Max SIP rows returned after LLM gates (spec). */
const SIP_MAX_TICKERS = 75;
/** Cap how many volume-qualified names enter news + LLM (cost control). */
const SIP_LLM_CANDIDATE_CAP = 120;
const SIP_SCAN_ROW_CAP = TRADINGVIEW_GAP_SCAN_ROW_CAP;

/** SIP scan: quality floors; bidirectional TV fetch uses min |gap| 2. */
function sipScanFromBody(body: unknown): TradingViewScanParams {
  const n = normalizeGappersScanBody(body);
  return {
    ...n,
    minPrice: Math.max(3, n.minPrice),
    minMarketCap: Math.max(250_000_000, n.minMarketCap),
    minGapPct: Math.max(2, n.minGapPct),
  };
}

/**
 * Pre-market “Stocks in Play”: bidirectional gappers, volume pre-filter, strict LLM classification.
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
      async () => loadGappersSipScan(scan, { rowLimit: SIP_SCAN_ROW_CAP, minAbsGapPct: 2 }),
      ["premarket-sip-gappers-v2", cacheKey],
      { revalidate: 30 }
    )();

    const earnings = await getTickersWithEarningsInLast24Hours();
    const merged: GapperRow[] = base.rows.map((r) => ({
      ...r,
      earningsRecent24h: earnings.has(r.ticker),
    }));

    const volumeOk = merged.filter(isSipVolumeCandidate);
    const sortedForLlm = [...volumeOk]
      .sort((a, b) => {
        const ag = Math.abs(b.gapPct) - Math.abs(a.gapPct);
        if (ag !== 0) return ag;
        const dv = b.pmVolume - a.pmVolume;
        if (dv !== 0) return dv;
        return a.ticker.localeCompare(b.ticker);
      })
      .slice(0, SIP_LLM_CANDIDATE_CAP);

    let themesSummary = "";
    const supabase = getSupabase();
    if (supabase) {
      const themes = await fetchDailyThemesForDate(supabase, ymdInEt());
      themesSummary = summarizeThemesForMacroPrompt(themes);
    }

    const tickers = sortedForLlm.map((r) => r.ticker);
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

    let catalyst: StocksInPlaySuccess["catalyst"] = null;
    let catalystError: string | null = null;
    let catalystSkipped = false;
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();

    const rowByTicker = new Map(sortedForLlm.map((r) => [r.ticker, r]));
    let finalRows: GapperRow[] = [];

    if (sortedForLlm.length > 0) {
      if (!anthropicKey) {
        catalystSkipped = true;
        finalRows = [];
        catalyst = null;
      } else {
        try {
          const anthropic = new Anthropic({ apiKey: anthropicKey });
          const { catalystByTicker, qualifiedOrder } = await generateSipCatalystMap(
            anthropic,
            sortedForLlm,
            news,
            themesSummary
          );
          const order = qualifiedOrder.slice(0, SIP_MAX_TICKERS);
          finalRows = order.map((t) => rowByTicker.get(t)).filter((r): r is GapperRow => Boolean(r));
          const catalystOut: NonNullable<StocksInPlaySuccess["catalyst"]> = {};
          for (const t of order) {
            const c = catalystByTicker[t];
            if (c) catalystOut[t] = c;
          }
          catalyst = Object.keys(catalystOut).length ? catalystOut : null;
        } catch (e) {
          catalystError = e instanceof Error ? e.message : "Catalyst generation failed";
          catalyst = null;
          finalRows = [];
        }
      }
    }

    const out: StocksInPlaySuccess = {
      ok: true,
      source: base.source,
      rows: finalRows,
      pythonConfigured: isPythonServiceConfigured(),
      news,
      newsError,
      catalyst,
      catalystError,
      catalystSkipped,
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
