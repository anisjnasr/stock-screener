-- Phase 2: Fed / Treasury / White House / USTR scheduled policy events.
-- Run in Supabase SQL Editor after economic_events (or any time).
-- Ingested by POST /api/cron/market-events/* (service role). Reads for anon (RLS).

CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date DATE NOT NULL,
  event_time_et TIME,
  event_title TEXT NOT NULL,
  event_category TEXT NOT NULL CHECK (event_category IN (
    'fomc', 'fed_speech', 'fed_testimony',
    'treasury_auction', 'treasury_press',
    'white_house', 'ustr',
    'theme_driven', 'manual'
  )),
  speaker TEXT,
  location TEXT,
  impact TEXT NOT NULL DEFAULT 'Medium' CHECK (impact IN ('High', 'Medium', 'Low')),
  source_url TEXT,
  source_type TEXT NOT NULL,
  external_id TEXT,
  theme_tag TEXT,
  theme_type TEXT CHECK (theme_type IN ('macro', 'industry')),
  theme_rank INTEGER,
  description TEXT,
  is_flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_dedupe ON market_events (event_date, event_title, event_category);
CREATE INDEX IF NOT EXISTS idx_market_date ON market_events (event_date);
CREATE INDEX IF NOT EXISTS idx_market_category ON market_events (event_category);

ALTER TABLE market_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market_events_select_anon"
  ON market_events FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "market_events_select_authenticated"
  ON market_events FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON market_events TO anon, authenticated;
GRANT ALL ON market_events TO service_role;
