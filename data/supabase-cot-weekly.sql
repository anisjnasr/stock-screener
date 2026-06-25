-- COT (Commitments of Traders) positioning panel — weekly store.
-- Run in Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- One row per (contract_key, report_date). Raw long/short numbers are stored so that
-- net, spread and the 3-year COT index can be recomputed at read time (Task 5).
--
-- Data sources (CFTC Socrata), joined per week at ingest (Task 3):
--   * comm_* / large_spec_* : TFF (gpe5-46if) for ES/NQ/RTY/BTC, Disaggregated (72hh-3qpy) for GC/CL
--   * small_spec_*          : Legacy (6dca-aqww) nonrept_positions_long_all / _short_all
-- Contract names confirmed in discovery (Task 1) are identical across all three datasets:
--   ES="S&P 500 Consolidated", NQ="NASDAQ-100 Consolidated", RTY="RUSSELL E-MINI",
--   BTC="BITCOIN", GC="GOLD", CL="WTI-PHYSICAL".

CREATE TABLE IF NOT EXISTS cot_weekly (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date      DATE NOT NULL,
  contract_key     TEXT NOT NULL CHECK (contract_key IN ('ES', 'NQ', 'RTY', 'BTC', 'GC', 'CL')),
  report_type      TEXT NOT NULL CHECK (report_type IN ('tff', 'disagg')),
  open_interest    BIGINT,

  -- Commercial camp (summed at ingest).
  --   TFF:    Dealers
  --   Disagg: Producer/Merchant + Swap Dealers
  comm_long        BIGINT,
  comm_short       BIGINT,

  -- Large speculator camp (summed at ingest).
  --   TFF:    Asset Managers + Leveraged Funds + Other Reportables
  --   Disagg: Managed Money + Other Reportables
  large_spec_long  BIGINT,
  large_spec_short BIGINT,

  -- Small speculator camp (Legacy non-reportable residual). NULL when the Legacy
  -- row is missing for a week; the frontend hides the small-spec bar that week.
  small_spec_long  BIGINT,
  small_spec_short BIGINT,

  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),

  UNIQUE (contract_key, report_date)
);

CREATE INDEX IF NOT EXISTS idx_cot_weekly_contract_date
  ON cot_weekly (contract_key, report_date);
CREATE INDEX IF NOT EXISTS idx_cot_weekly_report_date
  ON cot_weekly (report_date);

ALTER TABLE cot_weekly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cot_weekly_select_anon"
  ON cot_weekly FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "cot_weekly_select_authenticated"
  ON cot_weekly FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON cot_weekly TO anon, authenticated;
GRANT ALL ON cot_weekly TO service_role;
