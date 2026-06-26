-- Small-Cap Due Diligence panel (premarket page) — manual overrides + cached reports.
-- Run in Supabase → SQL Editor after data/supabase-schema.sql.
--
-- Scope: GLOBAL per ticker (not per profile). Dilution / filing data is objectively the
-- same regardless of which login profile views it, so overrides and cached reports are
-- shared to avoid redundant SEC/Anthropic calls.
--
-- Access: RLS enabled; only service_role is granted (trusted Next.js API routes read & write).
-- The browser anon key cannot touch these tables — data is exposed via /api/dd/* routes.

-- ---------------------------------------------------------------------------
-- Per-ticker manual overrides (authoritative; persist across runs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dd_overrides (
  ticker              TEXT PRIMARY KEY,
  float_override      BIGINT,
  market_cap_override BIGINT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE dd_overrides IS
  'Small-Cap DD: trader-supplied float / market-cap overrides. Authoritative; take precedence on every run.';

-- ---------------------------------------------------------------------------
-- Cached DD reports, keyed on ticker + the latest filing date seen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dd_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                TEXT NOT NULL,
  latest_filing_date    DATE NOT NULL,                          -- cache key: regenerate only when a newer filing appears
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                TEXT NOT NULL DEFAULT 'partial'         -- partial | complete | error
    CHECK (status IN ('partial', 'complete', 'error')),

  -- fast metrics (phase 1)
  price                 NUMERIC,
  gap_pct               NUMERIC,
  market_cap            BIGINT,
  market_cap_source     TEXT,                                   -- 'polygon' | 'manual'
  float                 BIGINT,
  float_source          TEXT,                                   -- 'stockanalysis' | 'yahoo' | 'polygon_proxy' | 'manual'
  short_interest        BIGINT,
  short_pct_float       NUMERIC,
  short_interest_date   DATE,
  shares_outstanding    BIGINT,
  cash_on_hand          BIGINT,
  ttm_operating_cf      BIGINT,
  monthly_burn          BIGINT,
  runway_months         NUMERIC,
  cash_as_of_date       DATE,

  -- verdict + signals
  verdict               TEXT,                                   -- Bullish | Bearish | Neutral
  verdict_reason        TEXT,
  raise_pressure        TEXT,
  cash_need             TEXT,
  float_risk            TEXT,
  overhang_pct          NUMERIC,
  fully_diluted_shares  BIGINT,

  -- structured blobs
  news                  JSONB,                                  -- fast; up to 3 company-specific headlines
  splits                JSONB,
  instruments           JSONB,                                  -- phase 2
  overhang_breakdown    JSONB,                                  -- phase 2
  notes                 JSONB,

  UNIQUE (ticker, latest_filing_date)
);

CREATE INDEX IF NOT EXISTS idx_dd_reports_ticker_generated
  ON dd_reports (ticker, generated_at DESC);

COMMENT ON TABLE dd_reports IS
  'Small-Cap DD: cached per-ticker report. Cache key (ticker, latest_filing_date): regenerate only when a newer SEC filing appears.';

COMMENT ON COLUMN dd_reports.status IS
  'partial = phase-1 metrics only; complete = phase-2 dilution + verdict landed; error = phase-2 extraction failed.';

COMMENT ON COLUMN dd_reports.float_source IS
  'stockanalysis (scrape) | yahoo (floatShares) | polygon_proxy (share_class, NOT true float) | manual (override).';

-- ---------------------------------------------------------------------------
-- RLS: server-only (service role bypasses RLS; anon/authenticated have no grants)
-- ---------------------------------------------------------------------------
ALTER TABLE dd_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE dd_reports   ENABLE ROW LEVEL SECURITY;

GRANT ALL ON dd_overrides TO service_role;
GRANT ALL ON dd_reports   TO service_role;
