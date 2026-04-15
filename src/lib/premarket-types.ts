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
  minPmVolume: number;
  minGapPct: number;
  minMarketCap: number;
};
