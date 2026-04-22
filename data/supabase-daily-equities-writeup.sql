-- Phase 4.5: Daily US equities writeup (newsletter-synthesized bullets).
-- Run in Supabase SQL Editor after newsletter_archive / daily_macro_writeup.
-- Or run the combined script: supabase-premarket-brief-tables.sql (equities + themes).

CREATE TABLE IF NOT EXISTS daily_equities_writeup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  writeup_date DATE UNIQUE NOT NULL,
  bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_newsletter_ids UUID[],
  model_used TEXT NOT NULL,
  fallback_used BOOLEAN DEFAULT false,
  generated_at TIMESTAMPTZ DEFAULT now(),
  is_flagged BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_daily_equities_writeup_date ON daily_equities_writeup (writeup_date);

ALTER TABLE daily_equities_writeup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_equities_writeup_select_anon"
  ON daily_equities_writeup FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "daily_equities_writeup_select_authenticated"
  ON daily_equities_writeup FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON daily_equities_writeup TO anon, authenticated;
GRANT ALL ON daily_equities_writeup TO service_role;
