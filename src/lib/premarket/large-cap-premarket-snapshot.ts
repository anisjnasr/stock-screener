/**
 * Large Cap Analysis — pre-market fields from one Massive full-market snapshot (blueprint §6).
 *
 * Uses the same endpoint and row parsing as movers / SIP snapshot flows (`fetchFullMarketSnapshotRaw`
 * + `parseSnapshotTickerRow` in `@/lib/massive`). Filter tickers locally — one HTTP request per run.
 */

import {
  fetchFullMarketSnapshotRaw,
  parseSnapshotTickerRow,
  type SnapshotTickerRaw,
  type TopMoverSnapshotRow,
} from "@/lib/massive";

/** Payload forwarded to Python `/large-cap/digest` as `premarket_snapshot`. */
export type LargeCapPremarketQuotePayload = {
  last_price: number;
  prev_close_from_snapshot: number;
  gap_pct: number;
  pm_volume: number;
  avg_volume_baseline_shares: number | null;
};

export function snapshotRowToPremarketPayload(row: TopMoverSnapshotRow): LargeCapPremarketQuotePayload {
  return {
    last_price: row.lastPrice,
    prev_close_from_snapshot: row.prevClose,
    gap_pct: row.gapPct,
    pm_volume: row.pmVolume,
    avg_volume_baseline_shares: row.avgVolume1m,
  };
}

export type FetchLargeCapPremarketQuotesResult = {
  /** Parsed quotes keyed by uppercase ticker (only requested symbols present). */
  byTicker: Record<string, LargeCapPremarketQuotePayload>;
  /** Total raw ticker rows returned by the snapshot (for diagnostics). */
  snapshotTickerCount: number;
};

/**
 * Single full-market snapshot request; keeps rows only for symbols in `symbols`.
 * `parseSnapshotTickerRow(..., { includeAvgVolume: true })` enables min.av baseline when API sends it.
 */
export async function fetchLargeCapPremarketQuotesForSymbols(
  symbols: string[],
  init?: { signal?: AbortSignal }
): Promise<FetchLargeCapPremarketQuotesResult> {
  const wanted = new Set(
    symbols.map((s) => String(s).trim().toUpperCase()).filter((t) => t.length > 0 && t.length <= 12)
  );
  const { tickers } = await fetchFullMarketSnapshotRaw(init);
  const byTicker: Record<string, LargeCapPremarketQuotePayload> = {};
  for (const raw of tickers) {
    const sym = String(raw.ticker ?? "").trim().toUpperCase();
    if (!wanted.has(sym)) continue;
    const row = parseSnapshotTickerRow(raw as SnapshotTickerRaw, { includeAvgVolume: true });
    if (!row) continue;
    byTicker[sym] = snapshotRowToPremarketPayload(row);
  }
  return { byTicker, snapshotTickerCount: tickers.length };
}
