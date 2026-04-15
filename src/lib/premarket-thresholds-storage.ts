/**
 * Pre-market SIP filter thresholds: localStorage + optional cloud (logged-in users).
 */

import { cloudSyncSetting } from "@/lib/cloud-sync";
import { getActiveProfile } from "@/lib/profile-storage";

export const PREMARKET_THRESHOLDS_LS_KEY = "premarket-thresholds-v1";
export const PREMARKET_THRESHOLDS_CLOUD_KEY = "premarket_thresholds";

export type PremarketThresholdsState = {
  minPrice: string;
  minPmVolume: string;
  minGapPct: string;
  minMarketCap: string;
};

export const PREMARKET_THRESHOLDS_DEFAULTS: PremarketThresholdsState = {
  minPrice: "5",
  minPmVolume: "50000",
  minGapPct: "3",
  minMarketCap: "500000000",
};

function coerceThresholds(raw: unknown): PremarketThresholdsState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string, fallback: string) =>
    typeof o[k] === "string" && o[k].trim() !== "" ? o[k] : fallback;
  return {
    minPrice: str("minPrice", PREMARKET_THRESHOLDS_DEFAULTS.minPrice),
    minPmVolume: str("minPmVolume", PREMARKET_THRESHOLDS_DEFAULTS.minPmVolume),
    minGapPct: str("minGapPct", PREMARKET_THRESHOLDS_DEFAULTS.minGapPct),
    minMarketCap: str("minMarketCap", PREMARKET_THRESHOLDS_DEFAULTS.minMarketCap),
  };
}

export function loadPremarketThresholds(): PremarketThresholdsState {
  if (typeof window === "undefined") return { ...PREMARKET_THRESHOLDS_DEFAULTS };
  try {
    const raw = localStorage.getItem(PREMARKET_THRESHOLDS_LS_KEY);
    if (!raw) return { ...PREMARKET_THRESHOLDS_DEFAULTS };
    const parsed = JSON.parse(raw) as unknown;
    const c = coerceThresholds(parsed);
    return c ?? { ...PREMARKET_THRESHOLDS_DEFAULTS };
  } catch {
    return { ...PREMARKET_THRESHOLDS_DEFAULTS };
  }
}

export function savePremarketThresholds(t: PremarketThresholdsState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREMARKET_THRESHOLDS_LS_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
  if (getActiveProfile()) {
    cloudSyncSetting(PREMARKET_THRESHOLDS_CLOUD_KEY, t);
  }
}
