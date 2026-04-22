-- One-shot migration: daily_equities_writeup (Phase 4.5) + daily_themes (Phase 5).
-- Run in Supabase → SQL Editor → New query → Paste → Run.
-- Fixes: "Could not find the table 'public.daily_equities_writeup' / daily_themes' in the schema cache"

-- --- daily_equities_writeup ---
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

DROP POLICY IF EXISTS "daily_equities_writeup_select_anon" ON daily_equities_writeup;
CREATE POLICY "daily_equities_writeup_select_anon"
  ON daily_equities_writeup FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "daily_equities_writeup_select_authenticated" ON daily_equities_writeup;
CREATE POLICY "daily_equities_writeup_select_authenticated"
  ON daily_equities_writeup FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON daily_equities_writeup TO anon, authenticated;
GRANT ALL ON daily_equities_writeup TO service_role;

-- --- daily_themes ---
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

DROP POLICY IF EXISTS "daily_themes_select_anon" ON daily_themes;
CREATE POLICY "daily_themes_select_anon"
  ON daily_themes FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "daily_themes_select_authenticated" ON daily_themes;
CREATE POLICY "daily_themes_select_authenticated"
  ON daily_themes FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON daily_themes TO anon, authenticated;
GRANT ALL ON daily_themes TO service_role;
