/**
 * User chart settings for the main price chart.
 * Stored in localStorage so they persist across sessions.
 */

const STORAGE_KEY_CHART_SETTINGS = "stock-research-chart-settings";

export type ChartSeriesType = "candles" | "line" | "area";

export type ChartSettings = {
  /** Series render style (candles, line, area). */
  type: ChartSeriesType;
  /** Show volume histogram pane. */
  showVolume: boolean;
  /** Show daily EMA 50 overlay (on daily timeframe). */
  showEma50: boolean;
  /** Show daily EMA 200 overlay (on daily timeframe). */
  showEma200: boolean;
  /** Show weekly EMA 40 overlay (on weekly timeframe). */
  showEma40Weekly: boolean;
  /** Show vertical grid lines. */
  showVertGrid: boolean;
  /** Show horizontal grid lines. */
  showHorzGrid: boolean;
  /** Chart background (canvas) color. */
  backgroundColor: string;
  /** Candle body color for up bars. */
  candleUpBodyColor: string;
  /** Candle body color for down bars. */
  candleDownBodyColor: string;
  /** Candle outline (border) color for up bars. */
  candleUpBorderColor: string;
  /** Candle outline (border) color for down bars. */
  candleDownBorderColor: string;
  /** Candle wick color for up bars. */
  candleUpWickColor: string;
  /** Candle wick color for down bars. */
  candleDownWickColor: string;
};

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  type: "candles",
  showVolume: true,
  showEma50: true,
  showEma200: true,
  showEma40Weekly: true,
  showVertGrid: false,
  showHorzGrid: false,
  // Colors: match user-provided TradingView theme
  backgroundColor: "#292b31",
  candleUpBodyColor: "#dbdbdb",
  candleDownBodyColor: "#636363",
  candleUpBorderColor: "#9c9c9c",
  candleDownBorderColor: "#9c9c9c",
  candleUpWickColor: "#9c9c9c",
  candleDownWickColor: "#9c9c9c",
};

export const LIGHT_CHART_THEME: ChartSettings = {
  type: "candles",
  showVolume: true,
  showEma50: true,
  showEma200: true,
  showEma40Weekly: true,
  showVertGrid: false,
  showHorzGrid: false,
  backgroundColor: "#ffffff",
  candleUpBodyColor: "#ffffff",
  candleDownBodyColor: "#000000",
  candleUpBorderColor: "#000000",
  candleDownBorderColor: "#000000",
  candleUpWickColor: "#000000",
  candleDownWickColor: "#000000",
};

export function loadChartSettings(): ChartSettings {
  if (typeof window === "undefined") return DEFAULT_CHART_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHART_SETTINGS);
    if (!raw) return DEFAULT_CHART_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ChartSettings> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_CHART_SETTINGS;
    return {
      ...DEFAULT_CHART_SETTINGS,
      ...parsed,
      // Guard against bad values
      type:
        parsed.type === "candles" || parsed.type === "line" || parsed.type === "area"
          ? parsed.type
          : DEFAULT_CHART_SETTINGS.type,
    };
  } catch {
    return DEFAULT_CHART_SETTINGS;
  }
}

export function saveChartSettings(settings: ChartSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_CHART_SETTINGS, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

