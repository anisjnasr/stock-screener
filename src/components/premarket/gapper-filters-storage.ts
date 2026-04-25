import type { GappersRequestBody } from "@/types/gappers";

export const GAPPER_FILTERS_LS_KEY = "stockstalker-gapper-filters-v1";

export type GapperCapPreset = "all" | "mid" | "large" | "mega" | "custom";

export const GAPPER_CAP_PRESET_MC: Record<Exclude<GapperCapPreset, "custom">, { min: number; max: number }> = {
  all: { min: 0, max: 10_000_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: 200_000_000_000 },
  mega: { min: 200_000_000_000, max: 10_000_000_000_000 },
};

export type GapperFilterState = GappersRequestBody & { capPreset: GapperCapPreset };

export const DEFAULT_GAPPER_FILTER_STATE: GapperFilterState = {
  capPreset: "all",
  minPrice: 5,
  minMarketCap: 0,
  maxMarketCap: 10_000_000_000_000,
  minPmVolume: 0,
  minAvgVolume: 0,
  minVolPct: 0,
  minGapPct: 1,
};

export function loadGapperFiltersFromStorage(): GapperFilterState {
  if (typeof window === "undefined") return DEFAULT_GAPPER_FILTER_STATE;
  try {
    const raw = localStorage.getItem(GAPPER_FILTERS_LS_KEY);
    if (!raw) return DEFAULT_GAPPER_FILTER_STATE;
    const j = JSON.parse(raw) as Partial<GapperFilterState>;
    return {
      ...DEFAULT_GAPPER_FILTER_STATE,
      ...j,
      capPreset: (j.capPreset as GapperCapPreset) ?? "all",
    };
  } catch {
    return DEFAULT_GAPPER_FILTER_STATE;
  }
}

export function saveGapperFiltersToStorage(f: GapperFilterState): void {
  try {
    localStorage.setItem(GAPPER_FILTERS_LS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

export function gapperFilterStateToRequestBody(f: GapperFilterState): GappersRequestBody {
  return {
    minPrice: f.minPrice,
    minMarketCap: f.minMarketCap,
    maxMarketCap: f.maxMarketCap,
    minPmVolume: f.minPmVolume,
    minAvgVolume: f.minAvgVolume,
    minVolPct: f.minVolPct,
    minGapPct: f.minGapPct,
  };
}
