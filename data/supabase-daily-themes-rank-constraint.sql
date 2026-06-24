-- Fix: raise theme_rank upper bound from 5 to 8 to support up to 8 macro bullets.
-- The original constraint (BETWEEN 1 AND 5) blocked macro rows ranked 6-8,
-- causing a check-constraint violation on every refresh that produced more than 5 macros.
--
-- Run in Supabase → SQL Editor → New query → Paste → Run.

ALTER TABLE daily_themes
  DROP CONSTRAINT IF EXISTS daily_themes_theme_rank_check;

ALTER TABLE daily_themes
  ADD CONSTRAINT daily_themes_theme_rank_check CHECK (theme_rank BETWEEN 1 AND 8);
