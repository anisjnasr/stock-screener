export type ReportTimeBucket = "bmo" | "amc" | "dmh";

/** Row for upsert into `big_name_universe`. */
export type BigNameUniverseInsert = {
  ticker: string;
  in_sp500: boolean;
  in_nasdaq100: boolean;
  market_cap_usd: number | null;
  above_10b_threshold: boolean;
  last_refreshed_at: string;
};

/** Row for upsert into `earnings_calendar`. */
export type EarningsCalendarInsert = {
  ticker: string;
  company_name: string | null;
  report_date: string;
  report_time: ReportTimeBucket | null;
  quarter: number | null;
  year: number | null;
  eps_estimate: number | null;
  revenue_estimate: number | null;
  eps_actual: number | null;
  revenue_actual: number | null;
  current_quarter_eps_surprise_pct: number | null;
  current_quarter_rev_surprise_pct: number | null;
  prior_quarter_eps_surprise_pct: number | null;
  prior_quarter_rev_surprise_pct: number | null;
  last_updated_at: string;
};

export type EarningsCalendarPublic = {
  id: string;
  ticker: string;
  /** From `big_name_universe` at request time (for peek ordering). */
  market_cap_usd: number | null;
  company_name: string | null;
  report_date: string;
  report_time: string | null;
  quarter: number | null;
  year: number | null;
  eps_estimate: number | null;
  revenue_estimate: number | null;
  eps_actual: number | null;
  revenue_actual: number | null;
  /** Prior fiscal quarter EPS actual (from DB), for display only. */
  prior_eps_actual: number | null;
  /** Prior fiscal quarter revenue actual (from DB), for display only. */
  prior_revenue_actual: number | null;
  current_quarter_eps_surprise_pct: number | null;
  current_quarter_rev_surprise_pct: number | null;
  prior_quarter_eps_surprise_pct: number | null;
  prior_quarter_rev_surprise_pct: number | null;
};

export type EarningsCalendarBucket = "yesterday" | "today" | "tomorrow" | "week";

export type EarningsCalendarResponse = {
  anchor: string;
  buckets: Record<EarningsCalendarBucket, EarningsCalendarPublic[]>;
};
