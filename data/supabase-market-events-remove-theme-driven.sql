-- One-time cleanup: remove theme-driven market events and disallow future inserts.
-- Safe to run multiple times.

DO $$
DECLARE
  rec RECORD;
BEGIN
  IF to_regclass('public.market_events') IS NULL THEN
    RAISE NOTICE 'market_events table does not exist; skipping cleanup';
    RETURN;
  END IF;

  DELETE FROM public.market_events
  WHERE event_category = 'theme_driven';

  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.market_events'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%event_category%'
  LOOP
    EXECUTE format('ALTER TABLE public.market_events DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.market_events'::regclass
      AND c.contype = 'c'
      AND c.conname = 'market_events_event_category_check'
  ) THEN
    ALTER TABLE public.market_events
      ADD CONSTRAINT market_events_event_category_check
      CHECK (event_category IN (
        'fomc', 'fed_speech', 'fed_testimony',
        'treasury_auction', 'treasury_press',
        'white_house', 'ustr',
        'manual'
      ));
  END IF;
END $$;
