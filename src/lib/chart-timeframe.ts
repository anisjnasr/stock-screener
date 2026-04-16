/**
 * Canonical chart resolutions: intraday + daily/weekly/monthly.
 * Intraday data: /api/intraday-candles; daily+: /api/candles.
 */

export const CHART_TIMEFRAMES = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "daily",
  "weekly",
  "monthly",
] as const;

export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];

export type ChartTimeframeMeta = {
  labelLong: string;
  abbrev: string;
  category: "intraday" | "daily";
};

export const CHART_TIMEFRAME_META: Record<ChartTimeframe, ChartTimeframeMeta> = {
  "1m": { labelLong: "1 min", abbrev: "1m", category: "intraday" },
  "5m": { labelLong: "5 min", abbrev: "5m", category: "intraday" },
  "15m": { labelLong: "15 min", abbrev: "15m", category: "intraday" },
  "30m": { labelLong: "30 min", abbrev: "30m", category: "intraday" },
  "1h": { labelLong: "1 hr", abbrev: "1h", category: "intraday" },
  "4h": { labelLong: "4 hr", abbrev: "4h", category: "intraday" },
  daily: { labelLong: "Daily", abbrev: "1D", category: "daily" },
  weekly: { labelLong: "Weekly", abbrev: "1W", category: "daily" },
  monthly: { labelLong: "Monthly", abbrev: "1M", category: "daily" },
};

export function isIntradayTimeframe(tf: ChartTimeframe): boolean {
  return CHART_TIMEFRAME_META[tf].category === "intraday";
}

/** Favorites strip order: shortest bar / smallest calendar period first (left), largest last (right). */
export function sortChartTimeframesByResolution(favs: ChartTimeframe[]): ChartTimeframe[] {
  const order = (tf: ChartTimeframe) => CHART_TIMEFRAMES.indexOf(tf);
  return [...favs].sort((a, b) => order(a) - order(b));
}

/** Bar duration in seconds for drawing extrapolation / measure tool. */
export function barDurationSeconds(tf: ChartTimeframe): number {
  switch (tf) {
    case "1m":
      return 60;
    case "5m":
      return 5 * 60;
    case "15m":
      return 15 * 60;
    case "30m":
      return 30 * 60;
    case "1h":
      return 60 * 60;
    case "4h":
      return 4 * 60 * 60;
    case "daily":
      return 86400;
    case "weekly":
      return 7 * 86400;
    case "monthly":
      return 30 * 86400;
    default:
      return 86400;
  }
}

/**
 * Query param for /api/intraday-candles `interval` (numeric string).
 * Maps to Polygon aggs: minute mult or hour mult (60=1h, 240=4h encoded as API convention).
 */
export function intradayApiIntervalParam(tf: ChartTimeframe): string | null {
  if (!isIntradayTimeframe(tf)) return null;
  switch (tf) {
    case "1m":
      return "1";
    case "5m":
      return "5";
    case "15m":
      return "15";
    case "30m":
      return "30";
    case "1h":
      return "60";
    case "4h":
      return "240";
    default:
      return null;
  }
}

/** Parse API interval string back to ChartTimeframe (intraday only). */
export function chartTimeframeFromIntradayApiInterval(interval: string): ChartTimeframe | null {
  const n = interval.trim();
  const map: Record<string, ChartTimeframe> = {
    "1": "1m",
    "5": "5m",
    "15": "15m",
    "30": "30m",
    "60": "1h",
    "240": "4h",
  };
  return map[n] ?? null;
}

export const FAVORITES_STORAGE_KEY = "stock-stalker:chart-tf-favorites:v1";
export const MAX_TIMEFRAME_FAVORITES = 8;

/** Default favorite buttons when none stored. */
export const DEFAULT_TIMEFRAME_FAVORITES: ChartTimeframe[] = ["daily", "weekly", "monthly"];

/** Initial visible bar count for intraday (logical range from the right). */
export function defaultVisibleIntradayBars(tf: ChartTimeframe): number {
  if (!isIntradayTimeframe(tf)) return 252;
  switch (tf) {
    case "1m":
      return 120;
    case "5m":
      return 150;
    case "15m":
      return 150;
    case "30m":
      return 120;
    case "1h":
      return 90;
    case "4h":
      return 80;
    default:
      return 120;
  }
}

export function loadTimeframeFavorites(): ChartTimeframe[] {
  try {
    if (typeof localStorage === "undefined") return [...DEFAULT_TIMEFRAME_FAVORITES];
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [...DEFAULT_TIMEFRAME_FAVORITES];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_TIMEFRAME_FAVORITES];
    const out: ChartTimeframe[] = [];
    for (const x of parsed) {
      if (typeof x === "string" && (CHART_TIMEFRAMES as readonly string[]).includes(x)) {
        out.push(x as ChartTimeframe);
      }
    }
    const uniq = [...new Set(out)].slice(0, MAX_TIMEFRAME_FAVORITES);
    const base = uniq.length > 0 ? uniq : [...DEFAULT_TIMEFRAME_FAVORITES];
    return sortChartTimeframesByResolution(base);
  } catch {
    return [...DEFAULT_TIMEFRAME_FAVORITES];
  }
}

/** Second line of measure tool label: bars + calendar span or hours for intraday. */
export function formatMeasureSpanText(
  tf: ChartTimeframe,
  startSec: number,
  endSec: number,
  barsDiff: number,
  daysDiff: number
): string {
  const step = barDurationSeconds(tf);
  if (step >= 86400) {
    return `${barsDiff} bars · ${daysDiff} days`;
  }
  const hours = Math.abs(endSec - startSec) / 3600;
  return `${barsDiff} bars · ${hours.toFixed(1)} h`;
}
