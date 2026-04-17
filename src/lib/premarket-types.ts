/** Shared types for Massive top movers + pre-market workspace. */

export type PremarketMoverRow = {
  ticker: string;
  name: string;
  prevClose: number;
  lastPrice: number;
  gapPct: number;
  pmVolume: number;
  avgVolume1m: number | null;
  marketCap: number | null;
  volRatioPct: number | null;
};

export type PremarketFilters = {
  minPrice: number;
  minGapPct: number;
  minPmVolume: number;
  /** Minimum average daily volume (month / DB avg_volume_1m). */
  minAvgVolume: number;
  minMarketCap: number;
};

/** Same rules as GET /api/premarket/movers (eligible SIP / Top Movers thresholds). */
export function passesPremarketFilters(row: PremarketMoverRow, f: PremarketFilters): boolean {
  if (row.lastPrice < f.minPrice) return false;
  if (row.gapPct < f.minGapPct) return false;
  if (row.pmVolume < f.minPmVolume) return false;
  if (row.avgVolume1m == null || row.avgVolume1m < f.minAvgVolume) return false;
  if (row.marketCap == null || row.marketCap < f.minMarketCap) return false;
  return true;
}
