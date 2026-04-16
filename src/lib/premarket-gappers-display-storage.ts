/**
 * Top Movers table: max rows (localStorage). Min gap is only from premarket scan filters.
 */

export const PREMARKET_GAPPERS_DISPLAY_LS_KEY = "premarket-gappers-display-v1";

export type PremarketGappersDisplayState = {
  /** Max rows to show in Top Movers (after sort by gap desc). */
  maxRows: string;
};

export const PREMARKET_GAPPERS_DISPLAY_DEFAULTS: PremarketGappersDisplayState = {
  maxRows: "50",
};

function coerce(raw: unknown): PremarketGappersDisplayState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: keyof PremarketGappersDisplayState, fallback: string) =>
    typeof o[k] === "string" && o[k].trim() !== "" ? o[k] : fallback;
  return {
    maxRows: str("maxRows", PREMARKET_GAPPERS_DISPLAY_DEFAULTS.maxRows),
  };
}

export function loadPremarketGappersDisplay(): PremarketGappersDisplayState {
  if (typeof window === "undefined") return { ...PREMARKET_GAPPERS_DISPLAY_DEFAULTS };
  try {
    const raw = localStorage.getItem(PREMARKET_GAPPERS_DISPLAY_LS_KEY);
    if (!raw) return { ...PREMARKET_GAPPERS_DISPLAY_DEFAULTS };
    const parsed = JSON.parse(raw) as unknown;
    const c = coerce(parsed);
    return c ?? { ...PREMARKET_GAPPERS_DISPLAY_DEFAULTS };
  } catch {
    return { ...PREMARKET_GAPPERS_DISPLAY_DEFAULTS };
  }
}

export function savePremarketGappersDisplay(s: PremarketGappersDisplayState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREMARKET_GAPPERS_DISPLAY_LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
