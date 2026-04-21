-- Phase 4: newsletter archive + daily macro writeup. Run in Supabase SQL Editor after core schema.
-- Ingest: POST /api/cron/newsletter-ingest (service role). Macro: POST /api/cron/macro-writeup (service role).
-- newsletter_archive is server-only (no anon read). daily_macro_writeup is public-read for Pre-market UI.

CREATE TABLE IF NOT EXISTS newsletter_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id TEXT NOT NULL UNIQUE,
  received_at TIMESTAMPTZ NOT NULL,
  sender_email TEXT NOT NULL,
  subject TEXT,
  body_text TEXT NOT NULL,
  used_in_writeup_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_archive_received ON newsletter_archive (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_archive_sender_lower ON newsletter_archive (lower(sender_email));

ALTER TABLE newsletter_archive ENABLE ROW LEVEL SECURITY;

GRANT ALL ON newsletter_archive TO service_role;

CREATE TABLE IF NOT EXISTS daily_macro_writeup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  writeup_date DATE NOT NULL UNIQUE,
  writeup_text TEXT NOT NULL,
  source_newsletter_ids UUID[],
  model_used TEXT NOT NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_flagged BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_daily_macro_writeup_date ON daily_macro_writeup (writeup_date DESC);

ALTER TABLE daily_macro_writeup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_macro_writeup_select_anon" ON daily_macro_writeup;
CREATE POLICY "daily_macro_writeup_select_anon"
  ON daily_macro_writeup FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "daily_macro_writeup_select_authenticated" ON daily_macro_writeup;
CREATE POLICY "daily_macro_writeup_select_authenticated"
  ON daily_macro_writeup FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON daily_macro_writeup TO anon, authenticated;
GRANT ALL ON daily_macro_writeup TO service_role;
