import type { GapperRow } from "@/types/gappers";

/** SIP volume gate: pre-market participation vs 90d ADV (TradingView field). */
export const SIP_MIN_ABS_GAP_PCT = 2;
export const SIP_MIN_PM_VOLUME = 100_000;
export const SIP_MIN_PM_VOL_FRAC_OF_ADV = 0.2;

/**
 * Hard pre-filter before LLM: |gap| ≥ 2%, PM vol ≥ 100k, PM vol ≥ 20% of 90d average volume.
 * Rows without a usable `avgVolume90d` fail the ratio check.
 */
export function isSipVolumeCandidate(row: Pick<GapperRow, "gapPct" | "pmVolume" | "avgVolume90d">): boolean {
  if (!Number.isFinite(row.gapPct) || Math.abs(row.gapPct) < SIP_MIN_ABS_GAP_PCT) return false;
  if (!Number.isFinite(row.pmVolume) || row.pmVolume < SIP_MIN_PM_VOLUME) return false;
  const adv = row.avgVolume90d;
  if (adv == null || !Number.isFinite(adv) || adv <= 0) return false;
  return row.pmVolume >= adv * SIP_MIN_PM_VOL_FRAC_OF_ADV;
}
