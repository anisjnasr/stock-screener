/**
 * Market Monitor percentile-rank coloring (self-calibrating extremeness).
 *
 * Percentiles are computed once per data load (server-side, in the API route) over each
 * indicator column's trailing history, then attached to each row. Band/tooltip resolution
 * is O(1) and done at render time. Kept framework-free so both the route and the client
 * component can import it.
 */

/** Primary lookback window (≈1 trading year). */
export const MM_PERCENTILE_LOOKBACK = 252;

/** Minimum history before percentile coloring activates (else fall back to fixed thresholds). */
export const MM_PERCENTILE_MIN_HISTORY = 60;

/** Indicator columns that receive percentile coloring in Part 1. */
export type MmPercentileColumn =
  | "up4pct"
  | "down4pct"
  | "up25pct_qtr"
  | "down25pct_qtr"
  | "up25pct_month"
  | "down25pct_month"
  | "up50pct_month"
  | "down50pct_month"
  | "nnh52wHighs"
  | "nnh52wLows";

export type MmDirection = "bullish" | "bearish";

/** High value meaning per column (drives whether high percentile = green or red). */
export const MM_COLUMN_DIRECTION: Record<MmPercentileColumn, MmDirection> = {
  up4pct: "bullish",
  down4pct: "bearish",
  up25pct_qtr: "bullish",
  down25pct_qtr: "bearish",
  up25pct_month: "bullish",
  down25pct_month: "bearish",
  up50pct_month: "bullish",
  down50pct_month: "bearish",
  nnh52wHighs: "bullish",
  nnh52wLows: "bearish",
};

export const MM_PERCENTILE_COLUMNS = Object.keys(MM_COLUMN_DIRECTION) as MmPercentileColumn[];

/** Per-row percentile ranks (0–100) or null when history < {@link MM_PERCENTILE_MIN_HISTORY}. */
export type MmRowPercentiles = Partial<Record<MmPercentileColumn, number | null>>;

/**
 * Percentile rank of each value against its own trailing window (inclusive of the current row):
 * `100 * (# values in window strictly less than today) / (# values in window)`.
 *
 * @param seriesAsc column values in chronological (ascending-date) order; nulls are ignored.
 * @returns array aligned to `seriesAsc`; entries are null when the usable window has
 *          fewer than `minHistory` values.
 */
export function computeTrailingPercentiles(
  seriesAsc: Array<number | null | undefined>,
  lookback: number = MM_PERCENTILE_LOOKBACK,
  minHistory: number = MM_PERCENTILE_MIN_HISTORY
): Array<number | null> {
  const out: Array<number | null> = new Array(seriesAsc.length).fill(null);
  for (let i = 0; i < seriesAsc.length; i++) {
    const today = seriesAsc[i];
    if (today == null || !Number.isFinite(today)) {
      out[i] = null;
      continue;
    }
    const from = Math.max(0, i - lookback + 1);
    let count = 0;
    let lessThan = 0;
    for (let j = from; j <= i; j++) {
      const v = seriesAsc[j];
      if (v == null || !Number.isFinite(v)) continue;
      count++;
      if (v < today) lessThan++;
    }
    out[i] = count >= minHistory ? (100 * lessThan) / count : null;
  }
  return out;
}

/**
 * Resolve the MM heat class for a percentile + direction.
 * Bullish-when-high: high percentile = green. Bearish-when-high: inverted.
 * Breakpoints 90/70/30/10 per spec; deep = existing `-very`, light = existing `-strong`.
 * Returns "" for neutral or when percentile is unavailable (caller applies fixed-threshold fallback).
 */
export function mmPercentileBandClass(
  percentile: number | null | undefined,
  direction: MmDirection
): string {
  if (percentile == null || !Number.isFinite(percentile)) return "";
  const dp = direction === "bullish" ? percentile : 100 - percentile;
  if (dp >= 90) return "ws-mm-heat-green-very";
  if (dp >= 70) return "ws-mm-heat-green-strong";
  if (dp > 30) return "";
  if (dp > 10) return "ws-mm-heat-red-strong";
  return "ws-mm-heat-red-very";
}

/** Hover tooltip: `"{value} — {percentile}th percentile (1Y)"`. */
export function mmPercentileTooltip(valueLabel: string, percentile: number | null | undefined): string | undefined {
  if (percentile == null || !Number.isFinite(percentile)) return undefined;
  return `${valueLabel} — ${Math.round(percentile)}th percentile (1Y)`;
}
