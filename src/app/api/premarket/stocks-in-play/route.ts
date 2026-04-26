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
import { SIP_MAX_TICKERS, SIP_TOP_BY_GAP, SIP_TOP_BY_PM_VOL } from "@/lib/premarket/sip-constants";

export const dynamic = "force-dynamic";
/** Cap how many volume-qualified names enter news + LLM (cost control). */
const SIP_LLM_CANDIDATE_CAP = 120;
const SIP_SCAN_ROW_CAP = TRADINGVIEW_GAP_SCAN_ROW_CAP;

/**
 * When LLM qualifies more than {@link SIP_MAX_TICKERS} names: take top {@link SIP_TOP_BY_GAP} by signed gap %
 * (highest first), then top {@link SIP_TOP_BY_PM_VOL} by premarket volume among the rest. Preserves order within each cohort.
 */
function pickSipFinalOrder(qualifiedOrder: string[], rowByTicker: Map<string, GapperRow>): string[] {
  const rows = qualifiedOrder
    .map((t) => rowByTicker.get(t))
    .filter((r): r is GapperRow => Boolean(r));
  if (rows.length <= SIP_MAX_TICKERS) {
    return rows.map((r) => r.ticker);
  }

  const byGapPct = (a: GapperRow, b: GapperRow) => {
    const g = b.gapPct - a.gapPct;
    if (g !== 0) return g;
    const dv = b.pmVolume - a.pmVolume;
    if (dv !== 0) return dv;
    return a.ticker.localeCompare(b.ticker);
  };
  const topGap = [...rows].sort(byGapPct).slice(0, SIP_TOP_BY_GAP);
  const gapPicked = new Set(topGap.map((r) => r.ticker));

  const byPmVol = (a: GapperRow, b: GapperRow) => {
    const dv = b.pmVolume - a.pmVolume;
    if (dv !== 0) return dv;
    const g = b.gapPct - a.gapPct;
    if (g !== 0) return g;
    return a.ticker.localeCompare(b.ticker);
  };
  const topVol = [...rows].filter((r) => !gapPicked.has(r.ticker)).sort(byPmVol).slice(0, SIP_TOP_BY_PM_VOL);

  return [...topGap.map((r) => r.ticker), ...topVol.map((r) => r.ticker)].slice(0, SIP_MAX_TICKERS);
}

/**
 * Pre-market “Stocks in Play”: bidirectional gappers with user-configured filters, strict LLM classification.
 * POST JSON body — same optional fields as `/api/movers/gappers` (see `GappersRequestBody`).
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
      async () => loadGappersSipScan(scan, { rowLimit: SIP_SCAN_ROW_CAP, minAbsGapPct: scan.minGapPct }),
      ["premarket-sip-gappers-v2", cacheKey],
      { revalidate: 30 }
    )();

    const earnings = await getTickersWithEarningsInLast24Hours();
    const merged: GapperRow[] = base.rows.map((r) => ({
      ...r,
      earningsRecent24h: earnings.has(r.ticker),
    }));

    const sortedForLlm = [...merged]
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
          const order = pickSipFinalOrder(qualifiedOrder, rowByTicker);
          finalRows = order
            .map((t) => rowByTicker.get(t))
            .filter((r): r is GapperRow => Boolean(r))
            .slice(0, SIP_MAX_TICKERS);
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
        /** SIP is dynamic; avoid shared caches retaining oversized pre-cap payloads. */
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
