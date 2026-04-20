-- Per-viewer calendar flags (economic + policy events). Run in Supabase SQL Editor after economic_events / market_events.
-- Phase 8 learning loop: e.g. SELECT f.*, e.event_name, e.event_date FROM calendar_event_flags f
--   JOIN economic_events e ON e.id = f.event_id AND f.event_type = 'economic'
--   WHERE f.created_at > now() - interval '7 days';

CREATE TABLE IF NOT EXISTS calendar_event_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('economic', 'market')),
  event_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('not_relevant', 'wrong_timing', 'duplicate', 'too_noisy')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_flags_viewer_event
  ON calendar_event_flags (viewer_key, event_type, event_id);

CREATE INDEX IF NOT EXISTS idx_calendar_flags_created_at
  ON calendar_event_flags (created_at DESC);

ALTER TABLE calendar_event_flags ENABLE ROW LEVEL SECURITY;

-- Intentionally no SELECT/INSERT policies for anon/authenticated — only service_role (server routes).

GRANT ALL ON calendar_event_flags TO service_role;
