-- Phase 9: Big-name universe + earnings calendar (Finnhub → Supabase).
-- Run in Supabase SQL Editor after profile schema / economic_events.
-- Crons: POST /api/cron/earnings/universe | ingest | actuals (service role).

-- 9A — Universe (S&P 500 ∪ Nasdaq-100 ∪ >$10B mcap from screener ingest)
CREATE TABLE IF NOT EXISTS big_name_universe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT UNIQUE NOT NULL,
  in_sp500 BOOLEAN DEFAULT false,
  in_nasdaq100 BOOLEAN DEFAULT false,
  market_cap_usd NUMERIC,
  above_10b_threshold BOOLEAN DEFAULT false,
  last_refreshed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_big_name_ticker ON big_name_universe (ticker);

ALTER TABLE big_name_universe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "big_name_universe_select_anon"
  ON big_name_universe FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "big_name_universe_select_authenticated"
  ON big_name_universe FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON big_name_universe TO anon, authenticated;
GRANT ALL ON big_name_universe TO service_role;

-- 9B — Earnings rows (Finnhub calendar/earnings)
CREATE TABLE IF NOT EXISTS earnings_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  company_name TEXT,
  report_date DATE NOT NULL,
  report_time TEXT CHECK (report_time IN ('bmo', 'amc', 'dmh')),
  quarter INTEGER,
  year INTEGER,
  eps_estimate NUMERIC,
  revenue_estimate NUMERIC,
  eps_actual NUMERIC,
  revenue_actual NUMERIC,
  current_quarter_eps_surprise_pct NUMERIC,
  current_quarter_rev_surprise_pct NUMERIC,
  prior_quarter_eps_surprise_pct NUMERIC,
  prior_quarter_rev_surprise_pct NUMERIC,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_dedupe
  ON earnings_calendar (ticker, report_date, quarter, year);

CREATE INDEX IF NOT EXISTS idx_earnings_report_date ON earnings_calendar (report_date);
CREATE INDEX IF NOT EXISTS idx_earnings_ticker ON earnings_calendar (ticker);

ALTER TABLE earnings_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "earnings_calendar_select_anon"
  ON earnings_calendar FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "earnings_calendar_select_authenticated"
  ON earnings_calendar FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON earnings_calendar TO anon, authenticated;
GRANT ALL ON earnings_calendar TO service_role;
