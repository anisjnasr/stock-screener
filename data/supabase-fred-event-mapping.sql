-- Phase 2.5: Map Forex Factory-style `economic_events.event_name` → FRED series for backfilling `actual`.
-- Run in Supabase SQL Editor after `economic_events` exists.
-- Cron: POST /api/cron/fred-actuals (service role). Phase 8 / analytics: SELECT * FROM fred_event_mapping;

CREATE TABLE IF NOT EXISTS fred_event_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT UNIQUE NOT NULL,
  fred_series_id TEXT NOT NULL,
  value_format TEXT NOT NULL DEFAULT 'percent' CHECK (value_format IN ('percent', 'thousands', 'raw')),
  release_offset_days INTEGER NOT NULL DEFAULT 0
);

INSERT INTO fred_event_mapping (event_name, fred_series_id, value_format, release_offset_days) VALUES
  ('Non-Farm Payrolls', 'PAYEMS', 'thousands', 0),
  ('Unemployment Rate', 'UNRATE', 'percent', 0),
  ('Core PCE Price Index YoY', 'PCEPILFE', 'percent', 0),
  ('CPI YoY', 'CPIAUCSL', 'percent', 0),
  ('Core CPI YoY', 'CPILFESL', 'percent', 0),
  -- Real GDP % change (QoQ SAAR) — clearer than raw GDPC1 level
  ('GDP QoQ', 'A191RL1Q225SBEA', 'percent', 0),
  ('Initial Jobless Claims', 'ICSA', 'thousands', 0),
  ('Retail Sales MoM', 'RSAFS', 'percent', 0),
  -- Forex Factory weekly XML titles use "m/m" (must match `economic_events.event_name` exactly)
  ('Retail Sales m/m', 'RSAFS', 'percent', 0),
  -- Core retail: Census % change SA (ex motor vehicle & parts dealers)
  ('Core Retail Sales m/m', 'MRTSMPCSM4400AUSS', 'percent', 0),
  -- ISM Manufacturing PMI (NAPM discontinued; NAPMPMI is common replacement)
  ('ISM Manufacturing PMI', 'NAPMPMI', 'raw', 0),
  ('Consumer Confidence', 'UMCSENT', 'raw', 0)
ON CONFLICT (event_name) DO UPDATE SET
  fred_series_id = EXCLUDED.fred_series_id,
  value_format = EXCLUDED.value_format,
  release_offset_days = EXCLUDED.release_offset_days;

CREATE INDEX IF NOT EXISTS idx_fred_mapping_series ON fred_event_mapping (fred_series_id);

ALTER TABLE fred_event_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fred_event_mapping_select_anon"
  ON fred_event_mapping FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "fred_event_mapping_select_authenticated"
  ON fred_event_mapping FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON fred_event_mapping TO anon, authenticated;
GRANT ALL ON fred_event_mapping TO service_role;
