/**
 * Shared types for the Small-Cap Due Diligence panel (premarket page).
 * Used by both server (lib/dd/*, /api/dd/*) and client (SmallCapDDPanel/Card).
 */

export type DDSignalLevel = "high" | "medium" | "low";
export type DDVerdict = "Bullish" | "Bearish" | "Neutral";
export type DDReportStatus = "partial" | "complete" | "error";

/** Severity buckets map to StockStalker semantic colors on the client. */
export type DDFlagSeverity = "red" | "amber" | "green";

/** Fixed flag set the Flag column uses (spec §6.5). */
export type DDFlag =
  | "toxic"
  | "active"
  | "pre-funded"
  | "in-default"
  | "ITM"
  | "available"
  | "shelf-only"
  | "near-expiry"
  | "registered"
  | "OTM"
  | "fixed"
  | "exhausted"
  | "expired";

export const DD_FLAG_SEVERITY: Record<DDFlag, DDFlagSeverity> = {
  toxic: "red",
  active: "red",
  "pre-funded": "red",
  "in-default": "red",
  ITM: "amber",
  available: "amber",
  "shelf-only": "amber",
  "near-expiry": "amber",
  registered: "amber",
  OTM: "green",
  fixed: "green",
  exhausted: "green",
  expired: "green",
};

export type DDInstrumentType =
  | "ATM"
  | "ELOC"
  | "secondary"
  | "warrants"
  | "convertible"
  | "preferred"
  | "shelf";

export type DDInstrumentStatus = "active" | "closed" | "expired" | "unconfirmed";

/** Raw instrument as extracted by the AI (spec §6.3). */
export type DDExtractedInstrument = {
  type: DDInstrumentType;
  label: string;
  authorized_usd: number | null;
  used_usd: number | null;
  remaining_usd: number | null;
  share_count: number | null;
  exercise_or_conversion_price: number | null;
  is_variable_conversion: boolean;
  floor_price: number | null;
  expiry: string | null;
  is_prefunded: boolean;
  key_terms: string | null;
  status: DDInstrumentStatus;
  flags: string[];
  source: string;
};

/** Instrument after in-code overhang math (spec §6.4). */
export type DDInstrument = DDExtractedInstrument & {
  /** Computed potential new shares from this instrument (null when open-ended/toxic). */
  potential_shares: number | null;
  /** True when dilution from this instrument cannot be cleanly bounded (variable conversion). */
  open_ended: boolean;
  /** Primary flag (drives the row color). */
  primary_flag: DDFlag | null;
  /** Severity of the primary flag. */
  severity: DDFlagSeverity | null;
};

export type DDReverseSplitConfirmation = {
  effective_date: string | null;
  ratio: string | null;
  shares_before: number | null;
  shares_after: number | null;
  source: string | null;
};

/** Strict JSON returned by the extraction model (spec §6.3). */
export type DDExtractionResult = {
  instruments: DDExtractedInstrument[];
  reverse_split_confirmations: DDReverseSplitConfirmation[];
  notes: string[];
};

/** One stacked-bar segment for the overhang card (spec §6.4 / §3.6). */
export type DDOverhangSegment = {
  label: string;
  shares: number;
  open_ended: boolean;
};

export type DDOverhangBreakdown = {
  current_shares_outstanding: number | null;
  potential_new_shares: number;
  fully_diluted_shares: number | null;
  overhang_pct: number | null;
  /** True when any instrument is open-ended → overhang is a floor, not a precise figure. */
  open_ended: boolean;
  segments: DDOverhangSegment[];
};

export type DDSplit = {
  split_from: number;
  split_to: number;
  execution_date: string;
  is_reverse: boolean;
  ratio_label: string;
};

export type DDNewsItem = {
  title: string;
  url: string;
  source: string;
  published_utc: string;
  /** Source pipeline used: yahoo (primary) or polygon (fallback). */
  provider: "yahoo" | "polygon";
};

export type DDSignals = {
  raise_pressure: DDSignalLevel;
  cash_need: DDSignalLevel;
  float_risk: DDSignalLevel;
  /** Overhang percent surfaced as a pill (null until phase 2). */
  overhang_pct: number | null;
};

export type DDVerdictResult = {
  verdict: DDVerdict;
  /** Joined human labels of whichever bearish conditions fired (spec §6.6). */
  reason: string;
  signals: DDSignals;
};

export type DDFloatSource = "stockanalysis" | "yahoo" | "polygon_proxy" | "manual";
export type DDMarketCapSource = "polygon" | "manual";

/** Phase-1 fast metrics (spec §5). */
export type DDMetrics = {
  ticker: string;
  name: string | null;
  cik: string | null;

  price: number | null;
  prev_close: number | null;
  gap_pct: number | null;

  market_cap: number | null;
  market_cap_source: DDMarketCapSource | null;

  float: number | null;
  float_source: DDFloatSource | null;

  shares_outstanding: number | null;

  short_interest: number | null;
  short_pct_float: number | null;
  short_interest_date: string | null;
  /** True when the short-interest endpoint is not on the plan / unavailable (degrade gracefully). */
  short_interest_unavailable: boolean;

  cash_on_hand: number | null;
  ttm_operating_cf: number | null;
  monthly_burn: number | null;
  runway_months: number | null;
  /** True when TTM operating cash flow >= 0 → "Profitable / n/a", no runway number. */
  cash_flow_positive: boolean;
  cash_as_of_date: string | null;

  splits: DDSplit[];

  /** Coverage warnings to surface subtly on affected cards (spec §10). */
  warnings: string[];
};

/** Full report shape returned to the client (assembled across both phases). */
export type DDReport = {
  ticker: string;
  status: DDReportStatus;
  latest_filing_date: string | null;
  generated_at: string | null;

  metrics: DDMetrics | null;
  news: DDNewsItem[];

  instruments: DDInstrument[];
  overhang: DDOverhangBreakdown | null;
  notes: string[];

  verdict: DDVerdictResult | null;

  /** Set when status === 'error' (phase-2 parse failure). */
  error?: string;
};

export type DDOverride = {
  ticker: string;
  float_override: number | null;
  market_cap_override: number | null;
};
