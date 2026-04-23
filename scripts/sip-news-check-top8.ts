/**
 * Verify Python /news for the top 8 SIP volume-qualified tickers.
 * npx tsx --env-file=.env.local scripts/sip-news-check-top8.ts
 */
import { getTickersWithEarningsInLast24Hours } from "../src/lib/premarket/earnings-recent";
import { loadGappersSipScan, normalizeGappersScanBody } from "../src/lib/premarket/gappers-ingest";
import { isSipVolumeCandidate } from "../src/lib/premarket/sip-candidate-filter";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "../src/lib/python-service";
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
  if (!isPythonServiceConfigured()) {
    console.error("PYTHON_SERVICE_URL and PYTHON_SERVICE_KEY must be set (e.g. in .env.local).");
    process.exit(1);
  }

  const scan = sipScanFromBody({});
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
  const tickers = batch.map((r) => r.ticker);

  console.log(`Volume-qualified total: ${volumeOk.length}`);
  console.log(`Requesting news for top ${tickers.length}: ${tickers.join(", ")}\n`);

  const pack = await fetchPythonTickerNews({ tickers, hoursBack: 24 });
  let withNews = 0;
  for (const t of tickers) {
    const items = pack.data[t] ?? [];
    const n = items.length;
    if (n > 0) withNews += 1;
    const first = items[0]?.title?.slice(0, 100) ?? "—";
    console.log(`${t}: ${n} headline(s)  |  first: ${first}`);
  }
  console.log(`\nTickers with ≥1 headline: ${withNews} / ${tickers.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
