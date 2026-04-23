/**
 * Run LLM SIP gate on the top 8 volume-qualified names (same hard filters as the API).
 * Usage: npx tsx --env-file=.env.local scripts/sip-qualify-hard-filter-top8.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { generateSipCatalystMap } from "../src/lib/ai/sipCatalyst";
import { ymdInEt } from "../src/lib/et-ymd";
import { getTickersWithEarningsInLast24Hours } from "../src/lib/premarket/earnings-recent";
import { loadGappersSipScan, normalizeGappersScanBody } from "../src/lib/premarket/gappers-ingest";
import { fetchDailyThemesForDate, summarizeThemesForMacroPrompt } from "../src/lib/premarket/dailyThemesRead";
import { isSipVolumeCandidate } from "../src/lib/premarket/sip-candidate-filter";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "../src/lib/python-service";
import { getSupabase } from "../src/lib/supabase";
import { TRADINGVIEW_GAP_SCAN_ROW_CAP } from "../src/lib/sources/tradingViewScreener";
import type { TradingViewScanParams } from "../src/lib/sources/tradingViewScreener";
import type { GapperRow } from "../src/types/gappers";

const TOP_N = 8;

function sipScanFromBody(body: unknown): TradingViewScanParams {
  const n = normalizeGappersScanBody(body);
  return {
    ...n,
    minPrice: Math.max(3, n.minPrice),
    minMarketCap: Math.max(250_000_000, n.minMarketCap),
    minGapPct: Math.max(2, n.minGapPct),
  };
}

async function main() {
  const scan = sipScanFromBody({});
  console.log("Loading TradingView (bidirectional)…");
  const base = await loadGappersSipScan(scan, { rowLimit: TRADINGVIEW_GAP_SCAN_ROW_CAP, minAbsGapPct: 2 });

  const earnings = await getTickersWithEarningsInLast24Hours();
  const merged: GapperRow[] = base.rows.map((r) => ({
    ...r,
    earningsRecent24h: earnings.has(r.ticker),
  }));

  const volumeOk = merged.filter(isSipVolumeCandidate);
  const sorted = [...volumeOk].sort((a, b) => {
    const ag = Math.abs(b.gapPct) - Math.abs(a.gapPct);
    if (ag !== 0) return ag;
    const dv = b.pmVolume - a.pmVolume;
    if (dv !== 0) return dv;
    return a.ticker.localeCompare(b.ticker);
  });

  const batch = sorted.slice(0, TOP_N);
  console.log(`\nVolume-qualified (all): ${volumeOk.length}`);
  console.log(`Evaluating top ${batch.length} by |gap| then PM vol:\n`);
  for (const r of batch) {
    console.log(
      `  ${r.ticker}  gap=${r.gapPct.toFixed(2)}%  pmVol=${Math.round(r.pmVolume)}  adv90=${r.avgVolume90d != null ? Math.round(r.avgVolume90d) : "—"}`
    );
  }

  let news: Record<string, import("../src/lib/python-service").PythonNewsItem[]> | null = null;
  if (batch.length && isPythonServiceConfigured()) {
    console.log("\nFetching Python headlines…");
    const pack = await fetchPythonTickerNews({ tickers: batch.map((r) => r.ticker), hoursBack: 24 });
    news = pack.data;
  } else {
    console.log("\n(Python news not configured — LLM will see empty headlines for all.)");
  }

  let themesSummary = "";
  const supabase = getSupabase();
  if (supabase) {
    const themes = await fetchDailyThemesForDate(supabase, ymdInEt());
    themesSummary = summarizeThemesForMacroPrompt(themes);
  }

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    console.error("\nANTHROPIC_API_KEY missing — cannot run LLM gate.");
    process.exit(1);
  }

  console.log("\nRunning Claude SIP classification…\n");
  const anthropic = new Anthropic({ apiKey: key });
  const { qualifiedOrder, catalystByTicker } = await generateSipCatalystMap(anthropic, batch, news, themesSummary);

  console.log("— Results —");
  console.log(`Qualified for SIP: ${qualifiedOrder.length} / ${batch.length}`);
  if (qualifiedOrder.length) {
    for (const t of qualifiedOrder) {
      const c = catalystByTicker[t];
      console.log(`\n  ✓ ${t}`);
      console.log(`    checks: company_specific_news=${c.checks.company_specific_news} surprises_market=${c.checks.surprises_market}`);
      console.log(`    category: ${c.category}  ranking: ${c.ranking_score}`);
      console.log(`    ${c.summary.slice(0, 200)}${c.summary.length > 200 ? "…" : ""}`);
    }
  }
  const failed = batch.filter((r) => !qualifiedOrder.includes(r.ticker));
  if (failed.length) {
    console.log("\nNot returned as SIP by model:");
    for (const r of failed) {
      console.log(`  · ${r.ticker} (omitted or failed gates — no qualifying row in JSON)`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
