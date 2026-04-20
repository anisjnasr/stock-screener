-- Pre-market: economic calendar (Phase 1). Run in Supabase SQL Editor after data/supabase-schema.sql.
-- Ingested by POST /api/cron/economic-calendar (service role). Reads allowed for anon (RLS).

CREATE TABLE IF NOT EXISTS economic_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date DATE NOT NULL,
  event_time_et TIME,
  event_name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  impact TEXT NOT NULL CHECK (impact IN ('High', 'Medium', 'Low')),
  forecast TEXT,
  previous TEXT,
  actual TEXT,
  source TEXT NOT NULL DEFAULT 'forex_factory',
  external_id TEXT,
  is_flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_econ_dedupe ON economic_events (event_date, event_name, country);
CREATE INDEX IF NOT EXISTS idx_econ_date ON economic_events (event_date);
CREATE INDEX IF NOT EXISTS idx_econ_impact ON economic_events (impact);

ALTER TABLE economic_events ENABLE ROW LEVEL SECURITY;

-- Public read for app clients using the anon key (no service role in browser).
CREATE POLICY "economic_events_select_anon"
  ON economic_events FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "economic_events_select_authenticated"
  ON economic_events FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON economic_events TO anon, authenticated;
GRANT ALL ON economic_events TO service_role;
