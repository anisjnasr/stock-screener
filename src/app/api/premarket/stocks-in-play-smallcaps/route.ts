import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { generateSipCatalystMap } from "@/lib/ai/sipCatalyst";
import { ymdInEt } from "@/lib/et-ymd";
import { getTickersWithEarningsInLast24Hours } from "@/lib/premarket/earnings-recent";
import { loadGappersSipScan, normalizeGappersScanBody } from "@/lib/premarket/gappers-ingest";
import { fetchDailyThemesForDate, summarizeThemesForMacroPrompt } from "@/lib/premarket/dailyThemesRead";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "@/lib/python-service";
import { getSupabase } from "@/lib/supabase";
import { TRADINGVIEW_GAP_SCAN_ROW_CAP } from "@/lib/sources/tradingViewScreener";
import type { GapperRow } from "@/types/gappers";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import { SIP_SMALL_CAP_MAX_TICKERS } from "@/lib/premarket/sip-constants";

export const dynamic = "force-dynamic";
const SIP_SCAN_ROW_CAP = TRADINGVIEW_GAP_SCAN_ROW_CAP;

function pickTopGapRows(rows: GapperRow[]): GapperRow[] {
  return [...rows]
    .sort((a, b) => {
      const gapDiff = b.gapPct - a.gapPct;
      if (gapDiff !== 0) return gapDiff;
      const volDiff = b.pmVolume - a.pmVolume;
      if (volDiff !== 0) return volDiff;
      return a.ticker.localeCompare(b.ticker);
    })
    .slice(0, SIP_SMALL_CAP_MAX_TICKERS);
}

/**
 * Small-cap SIP variant: pick top 5 by signed gap % from the user-filtered candidate pool.
 * POST body follows the same optional fields as `/api/premarket/stocks-in-play`.
 */
export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const scan = normalizeGappersScanBody(body);
  const cacheKey = JSON.stringify(scan);

  try {
    const base = await unstable_cache(
      async () => loadGappersSipScan(scan, { rowLimit: SIP_SCAN_ROW_CAP }),
      ["premarket-sip-smallcaps-v1", cacheKey],
      { revalidate: 30 }
    )();

    const earnings = await getTickersWithEarningsInLast24Hours();
    const merged: GapperRow[] = base.rows.map((r) => ({
      ...r,
      earningsRecent24h: earnings.has(r.ticker),
    }));
    const finalRows = pickTopGapRows(merged);

    const tickers = finalRows.map((r) => r.ticker);
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

    if (finalRows.length > 0) {
      if (!anthropicKey) {
        catalystSkipped = true;
      } else {
        let themesSummary = "";
        const supabase = getSupabase();
        if (supabase) {
          const themes = await fetchDailyThemesForDate(supabase, ymdInEt());
          themesSummary = summarizeThemesForMacroPrompt(themes);
        }
        try {
          const anthropic = new Anthropic({ apiKey: anthropicKey });
          const { catalystByTicker } = await generateSipCatalystMap(anthropic, finalRows, news, themesSummary);
          catalyst = Object.keys(catalystByTicker).length ? catalystByTicker : null;
        } catch (e) {
          catalystError = e instanceof Error ? e.message : "Catalyst generation failed";
          catalyst = null;
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
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
