/** POST `/api/movers/gappers` body (all fields optional; server applies defaults). */
export type GappersRequestBody = {
  minPrice?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  minPmVolume?: number;
  minAvgVolume?: number;
  minGapPct?: number;
  maxRows?: number;
};

export type GapperSource = "tradingview";

/** One pre-market gapper row from the TradingView screener. */
export type GapperRow = {
  ticker: string;
  compositeSymbol: string | null;
  companyName: string | null;
  lastPrice: number;
  gapPct: number;
  pmVolume: number;
  dayVolume: number | null;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  /** Phase 11C: true when ticker had earnings in the last 24h (Phase 9 data). */
  earningsRecent24h: boolean;
};

export type GappersResponse = {
  ok: true;
  source: GapperSource;
  rows: GapperRow[];
};
