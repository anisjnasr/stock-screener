import type { PremarketMoverRow } from "@/lib/premarket-types";
import {
  getCompanyName,
  getStockProfileDbMetrics,
  type PremarketScreenerJoinRow,
} from "@/lib/screener-db-native";
import {
  parseSnapshotTickerToPremarketRow,
  type SnapshotTickerRaw,
  type TopMoverSnapshotRow,
} from "@/lib/massive";

/**
 * Join Polygon full-market snapshot tickers against screener.db (cap + avg vol + name).
 * Filters by direction (gainers / losers) and drops symbols without positive market cap in DB.
 */
export function buildPremarketMoversFromFullSnapshot(
  raw: SnapshotTickerRaw[],
  screenerByTicker: Map<string, PremarketScreenerJoinRow>,
  opts: { direction: "gainers" | "losers" }
): PremarketMoverRow[] {
  const out: PremarketMoverRow[] = [];
  for (const t of raw) {
    const sym = String(t.ticker ?? "").trim().toUpperCase();
    if (!sym) continue;
    const sc = screenerByTicker.get(sym);
    if (!sc) continue;
    if (sc.marketCap == null || sc.marketCap <= 0) continue;

    const parsed = parseSnapshotTickerToPremarketRow(t, { includeAvgVolume: true });
    if (!parsed) continue;
    if (opts.direction === "gainers" && parsed.gapPct <= 0) continue;
    if (opts.direction === "losers" && parsed.gapPct >= 0) continue;

    const avgFromDb = sc.avgVolume1m;
    const avgVolume1m =
      parsed.avgVolume1m != null && parsed.avgVolume1m > 0 ? parsed.avgVolume1m : avgFromDb;

    const name = (sc.name && sc.name.trim()) || getCompanyName(sym) || sym;
    let volRatioPct: number | null = null;
    if (avgVolume1m != null && avgVolume1m > 0 && Number.isFinite(parsed.pmVolume) && parsed.pmVolume >= 0) {
      volRatioPct = (parsed.pmVolume / avgVolume1m) * 100;
    }

    out.push({
      ticker: sym,
      name,
      prevClose: parsed.prevClose,
      lastPrice: parsed.lastPrice,
      gapPct: parsed.gapPct,
      pmVolume: parsed.pmVolume,
      avgVolume1m,
      marketCap: sc.marketCap,
      volRatioPct,
    });
  }

  if (opts.direction === "gainers") {
    out.sort((a, b) => b.gapPct - a.gapPct);
  } else {
    out.sort((a, b) => a.gapPct - b.gapPct);
  }
  return out;
}

/** Legacy path: enrich TopMoverSnapshotRow with per-ticker DB metrics (top-movers API, ~20 names). */
export function premarketMoverFromTopSnapshotRow(r: TopMoverSnapshotRow): PremarketMoverRow {
  const name = getCompanyName(r.ticker) ?? r.ticker;
  const { metrics } = getStockProfileDbMetrics(r.ticker);
  const marketCap = metrics?.marketCap ?? null;
  const avgFromDb =
    metrics?.avgVolume20d != null && Number.isFinite(metrics.avgVolume20d) && metrics.avgVolume20d > 0
      ? metrics.avgVolume20d
      : null;
  const avgVolume1m =
    r.avgVolume1m != null && r.avgVolume1m > 0 ? r.avgVolume1m : avgFromDb;
  let volRatioPct: number | null = null;
  if (avgVolume1m != null && avgVolume1m > 0 && Number.isFinite(r.pmVolume) && r.pmVolume >= 0) {
    volRatioPct = (r.pmVolume / avgVolume1m) * 100;
  }
  return {
    ticker: r.ticker,
    name,
    prevClose: r.prevClose,
    lastPrice: r.lastPrice,
    gapPct: r.gapPct,
    pmVolume: r.pmVolume,
    avgVolume1m,
    marketCap,
    volRatioPct,
  };
}
