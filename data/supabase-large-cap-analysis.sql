-- Large Cap Analysis: result cache (Section 8c) + Trade forward-test archive (Section 11f).
-- Run in Supabase → SQL Editor after data/supabase-schema.sql (profiles must exist).
--
-- Cache and archive rows are scoped by profile_id (StockStalker login profiles), matching
-- watchlists / user_settings. Composite keys match blueprint (user, ticker, trading_date).
--
-- Access: RLS enabled; only service_role is granted (server / Python backend reads & writes).
-- The browser anon key cannot read these tables — expose data via trusted API routes later.

-- ---------------------------------------------------------------------------
-- Cached Claude result per stock per session day (hash-gated re-runs per Section 8c)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS large_cap_analysis_cache (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  trading_date DATE NOT NULL,
  verdict_json JSONB NOT NULL,
  digest_hash TEXT NOT NULL,
  data_mode TEXT NOT NULL CHECK (data_mode IN ('historical', 'historical_premarket')),
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, ticker, trading_date)
);

CREATE INDEX IF NOT EXISTS idx_lcap_cache_profile_trading_date
  ON large_cap_analysis_cache (profile_id, trading_date DESC);

CREATE INDEX IF NOT EXISTS idx_lcap_cache_profile_ticker
  ON large_cap_analysis_cache (profile_id, ticker);

COMMENT ON TABLE large_cap_analysis_cache IS
  'Large Cap Analysis: cached verdict JSON + digest fingerprint per profile/ticker/session date.';

COMMENT ON COLUMN large_cap_analysis_cache.digest_hash IS
  'Stable hash of the digest sent to Claude; unchanged hash skips API call for that trading day.';

COMMENT ON COLUMN large_cap_analysis_cache.data_mode IS
  'historical = OHLC/indicators only; historical_premarket = includes Polygon snapshot pre-market fields.';

-- ---------------------------------------------------------------------------
-- Archive: Trade verdicts only; outcome scored next day from daily OHLC (Section 11)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS large_cap_trade_archive (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  trading_date DATE NOT NULL,
  result_json JSONB NOT NULL,
  outcome TEXT CHECK (
    outcome IS NULL
    OR outcome IN ('Scenario 1', 'Scenario 2', 'Scenario 3', 'None', 'Ambiguous')
  ),
  scoring_json JSONB,
  scored BOOLEAN NOT NULL DEFAULT false,
  outcome_scored_at TIMESTAMPTZ,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, ticker, trading_date)
);

CREATE INDEX IF NOT EXISTS idx_lcap_archive_profile_trading_date
  ON large_cap_trade_archive (profile_id, trading_date DESC);

CREATE INDEX IF NOT EXISTS idx_lcap_archive_outcome_pending
  ON large_cap_trade_archive (profile_id, scored, trading_date DESC)
  WHERE NOT scored;

COMMENT ON TABLE large_cap_trade_archive IS
  'Large Cap Analysis: one row per Trade verdict per session day; outcome filled after daily bar completes.';

COMMENT ON COLUMN large_cap_trade_archive.trading_date IS
  'US session date the Trade call was made for (not the date it was logged).';

COMMENT ON COLUMN large_cap_trade_archive.result_json IS
  'Validated Section 9 JSON (verdict, narrative, scenarios) at time of log/upsert.';

COMMENT ON COLUMN large_cap_trade_archive.outcome IS
  'NULL=pending; Scenario 1–3 / None / Ambiguous after Python scoring (Section 11d).';

COMMENT ON COLUMN large_cap_trade_archive.scoring_json IS
  'Per-scenario trigger/target/invalidation booleans and classifier output for expanded UI.';

-- ---------------------------------------------------------------------------
-- RLS: server-only (service role bypasses RLS; anon/authenticated have no grants)
-- ---------------------------------------------------------------------------
ALTER TABLE large_cap_analysis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE large_cap_trade_archive ENABLE ROW LEVEL SECURITY;

GRANT ALL ON large_cap_analysis_cache TO service_role;
GRANT ALL ON large_cap_trade_archive TO service_role;
