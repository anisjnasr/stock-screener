-- Comp Lab: user ratings of comp match quality (blueprint Section 9).
-- Run in Supabase → SQL Editor after data/supabase-schema.sql (profiles must exist).
--
-- Rows are scoped by profile_id (StockStalker login profiles), matching watchlists / user_settings.
-- Latest-wins: one row per (profile, reference setup, comp); updates overwrite rating + updated_at.

CREATE TABLE IF NOT EXISTS comp_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reference_ticker TEXT NOT NULL,
  reference_date DATE NOT NULL,
  comp_ticker TEXT NOT NULL,
  comp_date DATE NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  engine_similarity_score NUMERIC,
  UNIQUE (profile_id, reference_ticker, reference_date, comp_ticker, comp_date)
);

CREATE INDEX IF NOT EXISTS idx_comp_ratings_profile_reference
  ON comp_ratings (profile_id, reference_ticker, reference_date);

CREATE INDEX IF NOT EXISTS idx_comp_ratings_profile_updated
  ON comp_ratings (profile_id, updated_at DESC);

COMMENT ON TABLE comp_ratings IS
  'Comp Lab: per-profile ratings of historical comp match quality (calibration dataset).';

COMMENT ON COLUMN comp_ratings.engine_similarity_score IS
  'Engine similarity score at time of rating; stored for future v2 pattern analysis.';

-- Server/API writes in v1; expose via trusted routes in Stage 6.
ALTER TABLE comp_ratings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON comp_ratings TO service_role;
