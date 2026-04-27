import type { GappersRequestBody } from "@/types/gappers";

export const GAPPER_FILTERS_LS_KEY = "stockstalker-gapper-filters-v1";
export const GAPPER_SAVED_FILTER_PRESETS_LS_KEY = "stockstalker-gapper-filter-presets-v1";

export type GapperCapPreset = "all" | "mid" | "large" | "mega" | "custom";

export const GAPPER_CAP_PRESET_MC: Record<Exclude<GapperCapPreset, "custom">, { min: number; max: number }> = {
  all: { min: 0, max: 10_000_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: 200_000_000_000 },
  mega: { min: 200_000_000_000, max: 10_000_000_000_000 },
};

export type GapperFilterState = GappersRequestBody & { capPreset: GapperCapPreset };
export type SavedGapperFilterPreset = {
  id: string;
  name: string;
  filters: GapperFilterState;
};

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

function normalizeSavedPreset(raw: unknown): SavedGapperFilterPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? "").trim();
  const name = String(rec.name ?? "").trim();
  if (!id || !name) return null;
  const filtersRaw = rec.filters;
  const filtersPartial =
    filtersRaw && typeof filtersRaw === "object" ? (filtersRaw as Partial<GapperFilterState>) : {};
  return {
    id,
    name,
    filters: {
      ...DEFAULT_GAPPER_FILTER_STATE,
      ...filtersPartial,
      capPreset: (filtersPartial.capPreset as GapperCapPreset) ?? "custom",
    },
  };
}

function loadSavedFilterPresetsForKey(key: string): SavedGapperFilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSavedPreset).filter((v): v is SavedGapperFilterPreset => Boolean(v));
  } catch {
    return [];
  }
}

function saveSavedFilterPresetsForKey(key: string, presets: SavedGapperFilterPreset[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
}

export function loadSavedGapperFilterPresetsFromStorage(): SavedGapperFilterPreset[] {
  return loadSavedFilterPresetsForKey(GAPPER_SAVED_FILTER_PRESETS_LS_KEY);
}

export function saveSavedGapperFilterPresetsToStorage(presets: SavedGapperFilterPreset[]): void {
  saveSavedFilterPresetsForKey(GAPPER_SAVED_FILTER_PRESETS_LS_KEY, presets);
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

/** SIP uses its own persisted filters (must match Stocks in Play). */
export const SIP_GAPPER_FILTERS_LS_KEY = "stockstalker-sip-gapper-filters-v1";
export const SIP_SAVED_FILTER_PRESETS_LS_KEY = "stockstalker-sip-filter-presets-v1";

export function loadSipGapperFiltersFromStorage(): GapperFilterState {
  if (typeof window === "undefined") return DEFAULT_GAPPER_FILTER_STATE;
  try {
    const raw = localStorage.getItem(SIP_GAPPER_FILTERS_LS_KEY);
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

export function saveSipGapperFiltersToStorage(f: GapperFilterState): void {
  try {
    localStorage.setItem(SIP_GAPPER_FILTERS_LS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

export function loadSavedSipFilterPresetsFromStorage(): SavedGapperFilterPreset[] {
  return loadSavedFilterPresetsForKey(SIP_SAVED_FILTER_PRESETS_LS_KEY);
}

export function saveSavedSipFilterPresetsToStorage(presets: SavedGapperFilterPreset[]): void {
  saveSavedFilterPresetsForKey(SIP_SAVED_FILTER_PRESETS_LS_KEY, presets);
}
