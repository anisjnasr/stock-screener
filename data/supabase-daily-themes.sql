-- Phase 5: Daily themes (macro + industry).
-- Run in Supabase SQL Editor after daily_equities_writeup.
-- Or run the combined script: supabase-premarket-brief-tables.sql (equities + themes).

CREATE TABLE IF NOT EXISTS daily_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_date DATE NOT NULL,
  theme_type TEXT NOT NULL DEFAULT 'macro' CHECK (theme_type IN ('macro', 'industry')),
  theme_rank INTEGER NOT NULL CHECK (theme_rank BETWEEN 1 AND 5),
  theme_title TEXT NOT NULL,
  theme_description TEXT NOT NULL,
  asset_implications TEXT,
  key_watch TEXT,
  industry TEXT,
  exemplar_tickers TEXT[],
  trigger_signals TEXT[],
  persistence_days INTEGER DEFAULT 1,
  is_new BOOLEAN DEFAULT true,
  model_used TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (theme_date, theme_type, theme_rank)
);

CREATE INDEX IF NOT EXISTS idx_daily_themes_date ON daily_themes (theme_date);
CREATE INDEX IF NOT EXISTS idx_daily_themes_type ON daily_themes (theme_date, theme_type);

ALTER TABLE daily_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_themes_select_anon"
  ON daily_themes FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "daily_themes_select_authenticated"
  ON daily_themes FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON daily_themes TO anon, authenticated;
GRANT ALL ON daily_themes TO service_role;
