-- One-time cleanup: drop legacy theme-driven columns from market_events.
-- Safe to run multiple times.

DO $$
BEGIN
  IF to_regclass('public.market_events') IS NULL THEN
    RAISE NOTICE 'market_events table does not exist; skipping column cleanup';
    RETURN;
  END IF;

  ALTER TABLE public.market_events
    DROP COLUMN IF EXISTS theme_tag,
    DROP COLUMN IF EXISTS theme_type,
    DROP COLUMN IF EXISTS theme_rank;
END $$;
