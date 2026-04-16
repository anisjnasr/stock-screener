"use client";

/**
 * Stock chart using TradingView Lightweight Charts
 * (https://www.tradingview.com/lightweight-charts/)
 */
import { memo, useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  createChart,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
  CandlestickSeries,
  LineSeries,
} from "lightweight-charts";
import { DEFAULT_CHART_SETTINGS, LIGHT_CHART_THEME, loadChartSettings, saveChartSettings, type ChartSettings, type ChartSeriesType } from "@/lib/chart-settings";
import type { StockFlag } from "@/lib/watchlist-storage";
import { FLAG_HEX as CHART_FLAG_HEX, FLAG_PICKER_ORDER } from "@/lib/stock-flags";
import { computeFlagStripPosition } from "@/lib/flag-picker-position";
import {
  type ChartTimeframe,
  CHART_TIMEFRAMES,
  CHART_TIMEFRAME_META,
  barDurationSeconds,
  defaultVisibleIntradayBars,
  formatMeasureSpanText,
  isIntradayTimeframe,
  loadTimeframeFavorites,
  DEFAULT_TIMEFRAME_FAVORITES,
  FAVORITES_STORAGE_KEY,
  MAX_TIMEFRAME_FAVORITES,
  sortChartTimeframesByResolution,
} from "@/lib/chart-timeframe";

export type { ChartTimeframe } from "@/lib/chart-timeframe";

/** Inset from chart right for price scale (see rightPriceScale minimumWidth). */
const CHART_PRICE_SCALE_GUTTER_PX = 88;
/** Vertical gap below toolbar / OHLC strip before first EMA row. */
const CHART_INDICATOR_COLUMN_TOP_PX = 70;
/** Right-aligned OHLC readout sits directly above indicator toggles. */
const CHART_OHLC_READOUT_TOP_PX = CHART_INDICATOR_COLUMN_TOP_PX - 22;

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type StockChartProps = {
  symbol: string;
  data: Candle[] | null;
  loading?: boolean;
  onRetryLoad?: () => void;
  timeframe?: ChartTimeframe;
  onTimeframeChange?: (tf: ChartTimeframe) => void;
  onVisibleDateRangeChange?: (range: { from: string; to: string } | null) => void;
  dualModeEnabled?: boolean;
  onToggleDualMode?: () => void;
  crosshairSyncEnabled?: boolean;
  onToggleCrosshairSync?: () => void;
  showGlobalControls?: boolean;
  chartInstanceId?: string;
  stockFlag?: StockFlag | null;
  onFlagChange?: (flag: StockFlag | null) => void;
  watchlistPickerLists?: Array<{ id: string; name: string; hasSymbol: boolean }>;
  onWatchlistMembershipSave?: (changes: { id: string; add: boolean }[]) => void;
};

type DrawMode = "none" | "ray" | "trend" | "measure";
type DrawTemplate = "weekly" | "daily" | "custom";

type DrawingStyle = {
  color: string;
  lineWidth: number;
  lineStyle: 0 | 1 | 2;
  showLabel: boolean;
  label: string;
};

type HorizontalRayDrawing = {
  id: string;
  kind: "ray";
  startTime: UTCTimestamp;
  price: number;
  style: DrawingStyle;
};

type TrendLineDrawing = {
  id: string;
  kind: "trend";
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
  style: DrawingStyle;
};

type MeasureDrawing = {
  id: string;
  kind: "measure";
  startTime: UTCTimestamp;
  startPrice: number;
  endTime: UTCTimestamp;
  endPrice: number;
  style: DrawingStyle;
};

type ChartDrawing = HorizontalRayDrawing | TrendLineDrawing | MeasureDrawing;

type DragHandle = "ray-anchor" | "trend-start" | "trend-end";
type DragState = {
  drawingId: string;
  handle: DragHandle;
};

function candleTimeToUtcTimestamp(dateStr: string): UTCTimestamp {
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return (new Date(`${s}T12:00:00.000Z`).getTime() / 1000) as UTCTimestamp;
  }
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    return Math.floor(ms / 1000) as UTCTimestamp;
  }
  return (new Date(`${s}T12:00:00.000Z`).getTime() / 1000) as UTCTimestamp;
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

function toIsoDate(time: { year: number; month: number; day: number }): string {
  const mm = String(time.month).padStart(2, "0");
  const dd = String(time.day).padStart(2, "0");
  return `${time.year}-${mm}-${dd}`;
}

function normalizeTime(raw: unknown): UTCTimestamp | null {
  if (typeof raw === "number") return raw as UTCTimestamp;
  if (
    raw &&
    typeof raw === "object" &&
    "year" in raw &&
    "month" in raw &&
    "day" in raw
  ) {
    const t = raw as { year: number; month: number; day: number };
    return candleTimeToUtcTimestamp(toIsoDate(t));
  }
  return null;
}

function timeToDateKey(raw: unknown): string | null {
  if (typeof raw === "number") {
    const ms = Number(raw) * 1000;
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (
    raw &&
    typeof raw === "object" &&
    "year" in raw &&
    "month" in raw &&
    "day" in raw
  ) {
    const t = raw as { year: number; month: number; day: number };
    return toIsoDate(t);
  }
  return null;
}

function formatMeasureLabel(
  d: { startTime: UTCTimestamp; startPrice: number; endTime: UTCTimestamp; endPrice: number },
  barIndexByTime: Map<number, number> | undefined,
  tf: ChartTimeframe
): string {
  const stats = getMeasureStats(d, barIndexByTime);
  const pct = `${stats.pricePct >= 0 ? "+" : ""}${stats.pricePct.toFixed(2)}%`;
  const chg = `${stats.priceDelta >= 0 ? "+" : ""}${stats.priceDelta.toFixed(2)}`;
  const span = formatMeasureSpanText(tf, Number(d.startTime), Number(d.endTime), stats.barsDiff, stats.daysDiff);
  return `${pct}  ${chg}\n${span}`;
}

function getMeasureStats(
  d: { startTime: UTCTimestamp; startPrice: number; endTime: UTCTimestamp; endPrice: number },
  barIndexByTime?: Map<number, number>
) {
  const priceDelta = d.endPrice - d.startPrice;
  const pricePct = d.startPrice !== 0 ? (priceDelta / d.startPrice) * 100 : 0;
  const startSec = Number(d.startTime);
  const endSec = Number(d.endTime);
  const daysDiff = Math.max(0, Math.round(Math.abs(endSec - startSec) / 86400));

  let barsDiff = daysDiff;
  if (barIndexByTime) {
    const startIdx = barIndexByTime.get(startSec);
    const endIdx = barIndexByTime.get(endSec);
    if (startIdx != null && endIdx != null) {
      barsDiff = Math.abs(endIdx - startIdx);
    }
  }
  return { priceDelta, pricePct, barsDiff, daysDiff };
}

function getDrawingStorageKey(symbol: string): string {
  return `stock-stalker:chart-drawings:v1:${symbol.toUpperCase()}`;
}

function drawingsEqual(a: ChartDrawing[], b: ChartDrawing[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

type ChartViewportMemory = {
  barsFromRight: number;
  visibleBars: number;
};

function getViewportStorageKey(chartInstanceId: string, timeframe: ChartTimeframe): string {
  return `stock-stalker:chart-viewport:v1:${chartInstanceId}:${timeframe}`;
}

function getDefaultLogicalRange(timeframe: ChartTimeframe, barCount: number): { from: number; to: number } {
  if (isIntradayTimeframe(timeframe)) {
    const n = defaultVisibleIntradayBars(timeframe);
    const visibleFrom = Math.max(0, barCount - Math.min(n, barCount));
    const visibleTo = Math.max(0, barCount - 1);
    return { from: visibleFrom, to: visibleTo + 3 };
  }
  const barsIn12Months = timeframe === "daily" ? 252 : timeframe === "weekly" ? 52 : 12;
  const visibleFrom = Math.max(0, barCount - barsIn12Months);
  const visibleTo = Math.max(0, barCount - 1);
  return { from: visibleFrom, to: visibleTo + 3 };
}

function loadViewportMemory(key: string): ChartViewportMemory | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChartViewportMemory>;
    const barsFromRight = Number(parsed.barsFromRight);
    const visibleBars = Number(parsed.visibleBars);
    if (!Number.isFinite(barsFromRight) || !Number.isFinite(visibleBars)) return null;
    if (visibleBars <= 0) return null;
    return { barsFromRight, visibleBars };
  } catch {
    return null;
  }
}

function saveViewportMemory(key: string, value: ChartViewportMemory): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore localStorage write errors.
  }
}

function clearViewportMemory(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore localStorage write errors.
  }
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x1, py - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x2, py - y2);
  const b = c1 / c2;
  const bx = x1 + b * vx;
  const by = y1 + b * vy;
  return Math.hypot(px - bx, py - by);
}

const TEMPLATE_STYLES: Record<Exclude<DrawTemplate, "custom">, DrawingStyle> = {
  weekly: {
    color: "#f59e0b",
    lineWidth: 1,
    lineStyle: 0,
    showLabel: false,
    label: "",
  },
  daily: {
    color: "#d946ef",
    lineWidth: 1,
    lineStyle: 0,
    showLabel: true,
    label: "Daily",
  },
};

function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length === 0 || period < 1) return [];
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      ema = sum / period;
    } else if (ema !== null) {
      ema = (c - ema) * k + ema;
    }
    out.push(ema);
  }
  return out;
}

function StockChart({
  symbol,
  data,
  loading,
  onRetryLoad,
  timeframe = "daily",
  onTimeframeChange,
  onVisibleDateRangeChange,
  dualModeEnabled = false,
  onToggleDualMode,
  crosshairSyncEnabled = false,
  onToggleCrosshairSync,
  showGlobalControls = false,
  chartInstanceId = "single",
  stockFlag,
  onFlagChange,
  watchlistPickerLists,
  onWatchlistMembershipSave,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const mainSeriesRef = useRef<
    ReturnType<ReturnType<typeof createChart>["addSeries"]> | null
  >(null);
  const [crosshairCandle, setCrosshairCandle] = useState<Candle | null>(null);
  const [settings, setSettings] = useState<ChartSettings>(() => loadChartSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [drawTemplate, setDrawTemplate] = useState<DrawTemplate>("weekly");
  const [customStyle, setCustomStyle] = useState<DrawingStyle>({
    color: "#22d3ee",
    lineWidth: 1,
    lineStyle: 0,
    showLabel: false,
    label: "",
  });
  const [pendingTrendStart, setPendingTrendStart] = useState<{ time: UTCTimestamp; price: number } | null>(
    null
  );
  const [pendingMeasureStart, setPendingMeasureStart] = useState<{ time: UTCTimestamp; price: number } | null>(null);
  const [pendingMeasureDrawingId, setPendingMeasureDrawingId] = useState<string | null>(null);
  const [pendingMeasureCursorPoint, setPendingMeasureCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showSelectedDrawingSettings, setShowSelectedDrawingSettings] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [snapToOhlc, setSnapToOhlc] = useState(false);
  const [showFlagPicker, setShowFlagPicker] = useState(false);
  const [chartFlagAnchorRect, setChartFlagAnchorRect] = useState<DOMRect | null>(null);
  const chartFlagBtnRef = useRef<HTMLButtonElement | null>(null);
  const [showWatchlistModal, setShowWatchlistModal] = useState(false);
  const [wlDraft, setWlDraft] = useState<Record<string, boolean>>({});
  const [pendingTrendDrawingId, setPendingTrendDrawingId] = useState<string | null>(null);
  const [chartNarrow, setChartNarrow] = useState(false);
  const [tfFavorites, setTfFavorites] = useState<ChartTimeframe[]>(() => [...DEFAULT_TIMEFRAME_FAVORITES]);
  const [tfMenuOpen, setTfMenuOpen] = useState(false);
  const tfMenuRef = useRef<HTMLDivElement | null>(null);
  const tfFavoritesHydratedRef = useRef(false);
  const suppressCrosshairBroadcastRef = useRef(false);
  const suppressDrawingBroadcastRef = useRef(false);
  const suppressViewportMemoryRef = useRef(false);
  const drawModeRef = useRef<DrawMode>("none");
  const pendingMeasureStartRef = useRef<{ time: UTCTimestamp; price: number } | null>(null);
  const pendingMeasureDrawingIdRef = useRef<string | null>(null);
  const skipNextChartClickRef = useRef(false);

  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { pendingMeasureStartRef.current = pendingMeasureStart; }, [pendingMeasureStart]);
  useEffect(() => { pendingMeasureDrawingIdRef.current = pendingMeasureDrawingId; }, [pendingMeasureDrawingId]);

  useEffect(() => {
    setTfFavorites(loadTimeframeFavorites());
    tfFavoritesHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!tfFavoritesHydratedRef.current) return;
    try {
      localStorage.setItem(
        FAVORITES_STORAGE_KEY,
        JSON.stringify(sortChartTimeframesByResolution(tfFavorites))
      );
    } catch {
      // Ignore localStorage write errors.
    }
  }, [tfFavorites]);

  useEffect(() => {
    if (!tfMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (tfMenuRef.current && !tfMenuRef.current.contains(e.target as Node)) {
        setTfMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTfMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tfMenuOpen]);

  const toggleTfFavorite = useCallback((tf: ChartTimeframe) => {
    setTfFavorites((prev) => {
      const idx = prev.indexOf(tf);
      let next: ChartTimeframe[];
      if (idx >= 0) next = prev.filter((x) => x !== tf);
      else if (prev.length >= MAX_TIMEFRAME_FAVORITES) return prev;
      else next = [...prev, tf];
      return sortChartTimeframesByResolution(next);
    });
  }, []);

  const chronological = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.slice().sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const seriesData = useMemo(() => {
    if (chronological.length === 0) return [];
    return chronological.map((d) => ({
      time: candleTimeToUtcTimestamp(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
  }, [chronological]);

  const timeToCandle = useMemo(() => {
    const m = new Map<number, Candle>();
    chronological.forEach((c) => m.set(candleTimeToUtcTimestamp(c.date), c));
    return m;
  }, [chronological]);

  const barIndexByTime = useMemo(() => {
    const m = new Map<number, number>();
    chronological.forEach((c, i) => m.set(Number(candleTimeToUtcTimestamp(c.date)), i));
    return m;
  }, [chronological]);

  const sortedTimes = useMemo(() => seriesData.map((s) => Number(s.time)).sort((a, b) => a - b), [seriesData]);

  /** Volume as OHLC candles from 0 so Lightweight Charts can draw borders (histogram has no stroke). */
  const volumeCandleData = useMemo(() => {
    if (chronological.length === 0) return [];
    return chronological.map((d) => {
      const time = candleTimeToUtcTimestamp(d.date);
      const v = d.volume;
      if (v <= 0) {
        return { time, open: 0, high: 0, low: 0, close: 0 };
      }
      if (d.close >= d.open) {
        return { time, open: 0, high: v, low: 0, close: v };
      }
      return { time, open: v, high: v, low: 0, close: 0 };
    });
  }, [chronological]);

  const ema50Data = useMemo(() => {
    if (timeframe !== "daily") return [];
    const closes = chronological.map((d) => d.close);
    const ema = computeEMA(closes, 50);
    return seriesData
      .map((d, i) => (ema[i] != null ? { time: d.time, value: ema[i]! } : null))
      .filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
  }, [timeframe, chronological, seriesData]);

  const ema200Data = useMemo(() => {
    if (timeframe !== "daily") return [];
    const closes = chronological.map((d) => d.close);
    const ema = computeEMA(closes, 200);
    return seriesData
      .map((d, i) => (ema[i] != null ? { time: d.time, value: ema[i]! } : null))
      .filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
  }, [timeframe, chronological, seriesData]);

  const ema40Data = useMemo(() => {
    if (timeframe !== "weekly") return [];
    const closes = chronological.map((d) => d.close);
    const ema = computeEMA(closes, 40);
    return seriesData
      .map((d, i) => (ema[i] != null ? { time: d.time, value: ema[i]! } : null))
      .filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
  }, [timeframe, chronological, seriesData]);

  const handleUpdateSettings = useCallback(
    (partial: Partial<ChartSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial };
        saveChartSettings(next);
        return next;
      });
    },
    []
  );

  const isLightBackground = useMemo(() => {
    const hex = settings.backgroundColor.replace("#", "");
    if (hex.length < 6) return false;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  }, [settings.backgroundColor]);
  const isUsingLightTheme = useMemo(
    () => settings.backgroundColor.toLowerCase() === LIGHT_CHART_THEME.backgroundColor.toLowerCase(),
    [settings.backgroundColor]
  );
  const applyThemePalette = useCallback((theme: ChartSettings) => {
    setSettings((prev) => {
      const next: ChartSettings = {
        ...prev,
        backgroundColor: theme.backgroundColor,
        candleUpBodyColor: theme.candleUpBodyColor,
        candleDownBodyColor: theme.candleDownBodyColor,
        candleUpBorderColor: theme.candleUpBorderColor,
        candleDownBorderColor: theme.candleDownBorderColor,
        candleUpWickColor: theme.candleUpWickColor,
        candleDownWickColor: theme.candleDownWickColor,
      };
      saveChartSettings(next);
      return next;
    });
  }, []);
  const toolbarMutedClass = isLightBackground
    ? "text-zinc-800 hover:bg-zinc-200/70"
    : "text-zinc-200 hover:bg-white/10";
  const toolbarActiveClass = isLightBackground
    ? "bg-zinc-900 text-zinc-100"
    : "bg-zinc-200 text-zinc-900";
  const toolbarDividerClass = isLightBackground
    ? "bg-zinc-700/30"
    : "bg-zinc-400/50 dark:bg-[var(--ws-border-hover)]";

  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setChartNarrow(w > 0 && w < 360);
    });
    ro.observe(el);
    setChartNarrow(el.clientWidth > 0 && el.clientWidth < 360);
    return () => ro.disconnect();
  }, [loading, data?.length]);

  const activeDrawingStyle = useMemo<DrawingStyle>(() => {
    if (drawTemplate === "custom") return customStyle;
    return TEMPLATE_STYLES[drawTemplate];
  }, [drawTemplate, customStyle]);

  const snapPointToCandle = useCallback(
    (time: UTCTimestamp, price: number): { time: UTCTimestamp; price: number } => {
      if (!snapToOhlc || sortedTimes.length === 0) return { time, price };
      const target = Number(time);
      let lo = 0;
      let hi = sortedTimes.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (sortedTimes[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      let bestIdx = lo;
      if (bestIdx > 0 && Math.abs(sortedTimes[bestIdx - 1] - target) < Math.abs(sortedTimes[bestIdx] - target)) {
        bestIdx = bestIdx - 1;
      }
      const bestTime = sortedTimes[bestIdx] as UTCTimestamp;
      const candle = timeToCandle.get(bestTime);
      if (!candle) return { time: bestTime, price };
      const picks = [candle.open, candle.high, candle.low, candle.close];
      let bestPrice = picks[0];
      let bestDist = Math.abs(price - bestPrice);
      for (let i = 1; i < picks.length; i++) {
        const dist = Math.abs(price - picks[i]);
        if (dist < bestDist) {
          bestDist = dist;
          bestPrice = picks[i];
        }
      }
      return { time: bestTime, price: bestPrice };
    },
    [snapToOhlc, sortedTimes, timeToCandle]
  );

  useEffect(() => {
    const key = getDrawingStorageKey(symbol);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setDrawings([]);
        return;
      }
      const parsed = JSON.parse(raw) as ChartDrawing[];
      if (Array.isArray(parsed)) setDrawings(parsed);
      else setDrawings([]);
    } catch {
      setDrawings([]);
    }
    setSelectedDrawingId(null);
    setDragState(null);
  }, [symbol]);

  useEffect(() => {
    const key = getDrawingStorageKey(symbol);
    try {
      localStorage.setItem(key, JSON.stringify(drawings));
    } catch {
      // Ignore localStorage write errors.
    }
    if (suppressDrawingBroadcastRef.current) {
      suppressDrawingBroadcastRef.current = false;
      return;
    }
    window.dispatchEvent(
      new CustomEvent("stock-chart-drawings", {
        detail: { symbol: symbol.toUpperCase(), drawings, source: chartInstanceId },
      })
    );
  }, [symbol, drawings, chartInstanceId]);

  useEffect(() => {
    const onRemoteDrawings = (evt: Event) => {
      const detail = (evt as CustomEvent).detail as
        | { symbol?: string; drawings?: ChartDrawing[]; source?: string }
        | undefined;
      if (!detail) return;
      if (detail.source === chartInstanceId) return;
      if ((detail.symbol ?? "").toUpperCase() !== symbol.toUpperCase()) return;
      if (!Array.isArray(detail.drawings)) return;
      setDrawings((prev) => {
        if (drawingsEqual(prev, detail.drawings as ChartDrawing[])) return prev;
        suppressDrawingBroadcastRef.current = true;
        return detail.drawings as ChartDrawing[];
      });
    };
    window.addEventListener("stock-chart-drawings", onRemoteDrawings as EventListener);
    return () => window.removeEventListener("stock-chart-drawings", onRemoteDrawings as EventListener);
  }, [symbol, chartInstanceId]);

  useEffect(() => {
    if (!containerRef.current || seriesData.length === 0) return;

    const el = containerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: settings.backgroundColor },
        textColor: isLightBackground ? "#333333" : "#D9D9D9",
        panes: {
          separatorColor: isLightBackground ? "rgba(0,0,0,0.15)" : "rgba(113,113,122,0.4)",
          separatorHoverColor: isLightBackground ? "rgba(0,0,0,0.3)" : "rgba(113,113,122,0.6)",
        },
      },
      grid: {
        vertLines: { visible: settings.showVertGrid },
        horzLines: { visible: settings.showHorzGrid },
      },
      width: el.clientWidth,
      height: Math.max(el.clientHeight, 300),
      timeScale: {
        timeVisible: true,
        secondsVisible: timeframe === "1m" || timeframe === "5m" || timeframe === "15m" || timeframe === "30m",
        borderColor: isLightBackground ? "rgba(0,0,0,0.2)" : "rgba(113,113,122,0.4)",
        allowBoldLabels: true,
      },
      handleScroll: {
        mouseWheel: false,
      },
      handleScale: {
        mouseWheel: false,
      },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: isLightBackground ? "rgba(0,0,0,0.2)" : "rgba(113,113,122,0.5)",
        scaleMargins: { top: 0.1, bottom: 0.02 },
        minimumWidth: 80,
        entireTextOnly: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          width: 1,
          style: 1,
          color: isLightBackground ? "rgba(50,50,50,0.5)" : "rgba(233,236,243,0.9)",
          labelBackgroundColor: isLightBackground ? "rgba(240,240,240,0.96)" : "rgba(28,30,34,0.96)",
        },
        horzLine: {
          visible: true,
          width: 1,
          style: 1,
          labelVisible: true,
          color: isLightBackground ? "rgba(50,50,50,0.5)" : "rgba(233,236,243,0.9)",
          labelBackgroundColor: isLightBackground ? "rgba(240,240,240,0.96)" : "rgba(28,30,34,0.96)",
        },
      },
    });

    // Overlays: EMAs
    if (timeframe === "daily") {
      if (settings.showEma50 && ema50Data.length > 0) {
        const ema50Color = "#ef4444";
        chart
          .addSeries(LineSeries, {
            color: ema50Color,
            lineWidth: 1,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            autoscaleInfoProvider: () => null,
          })
          .setData(ema50Data);
      }
      if (settings.showEma200 && ema200Data.length > 0) {
        const ema200Color = "#22c55e";
        chart
          .addSeries(LineSeries, {
            color: ema200Color,
            lineWidth: 1,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            autoscaleInfoProvider: () => null,
          })
          .setData(ema200Data);
      }
    } else if (timeframe === "weekly" && settings.showEma40Weekly && ema40Data.length > 0) {
      const ema40Color = "#22c55e";
      chart
        .addSeries(LineSeries, {
          color: ema40Color,
          lineWidth: 1,
          priceScaleId: "right",
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        })
        .setData(ema40Data);
    }

    // Main price series type
    const addMainSeries = (type: ChartSeriesType) => {
      if (type === "line") {
        const series = chart.addSeries(LineSeries, {
          color: settings.candleUpBodyColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        series.setData(
          seriesData.map((d) => ({
            time: d.time,
            value: d.close,
          }))
        );
        return series;
      } else if (type === "area") {
        const series = chart.addSeries(LineSeries, {
          color: settings.candleUpBodyColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        series.setData(
          seriesData.map((d) => ({
            time: d.time,
            value: d.close,
          }))
        );
        return series;
      } else {
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: settings.candleUpBodyColor,
          downColor: settings.candleDownBodyColor,
          borderUpColor: settings.candleUpBorderColor,
          borderDownColor: settings.candleDownBorderColor,
          wickUpColor: settings.candleUpWickColor,
          wickDownColor: settings.candleDownWickColor,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        candleSeries.setData(seriesData);
        return candleSeries;
      }
    };
    const mainSeries = addMainSeries(settings.type);
    mainSeriesRef.current = mainSeries;

    const drawingStepSeconds = barDurationSeconds(timeframe);
    const firstSeriesTime = seriesData[0]?.time ?? (candleTimeToUtcTimestamp("1970-01-01") as UTCTimestamp);
    const lastSeriesTime = seriesData[seriesData.length - 1]?.time ?? (candleTimeToUtcTimestamp("1970-01-01") as UTCTimestamp);
    const firstSeriesIndex = 0;
    const lastSeriesIndex = Math.max(0, seriesData.length - 1);
    const farRightTime = (Number(lastSeriesTime) + drawingStepSeconds) as UTCTimestamp;
    const resolveTimeAtX = (x: number, preferredRawTime?: unknown): UTCTimestamp | null => {
      const direct = normalizeTime(preferredRawTime ?? chart.timeScale().coordinateToTime(x));
      if (direct != null) return direct;
      const logical = (
        chart.timeScale() as unknown as { coordinateToLogical?: (coord: number) => number | null | undefined }
      ).coordinateToLogical?.(x);
      if (logical == null || !Number.isFinite(logical)) return null;
      const roundedLogical = Math.round(logical);
      const clampedLogical = Math.max(firstSeriesIndex - 5000, Math.min(lastSeriesIndex + 5000, roundedLogical));
      if (clampedLogical >= lastSeriesIndex) {
        return (Number(lastSeriesTime) + (clampedLogical - lastSeriesIndex) * drawingStepSeconds) as UTCTimestamp;
      }
      if (clampedLogical <= firstSeriesIndex) {
        return (Number(firstSeriesTime) - (firstSeriesIndex - clampedLogical) * drawingStepSeconds) as UTCTimestamp;
      }
      return (Number(firstSeriesTime) + (clampedLogical - firstSeriesIndex) * drawingStepSeconds) as UTCTimestamp;
    };

    for (const d of drawings) {
      const baseWidth = Math.max(1, Math.min(4, Math.round(d.style.lineWidth)));
      const emphasized = d.id === selectedDrawingId ? Math.min(4, baseWidth + 1) : baseWidth;
      const clampedLineWidth = emphasized as 1 | 2 | 3 | 4;
      const lineSeries = chart.addSeries(LineSeries, {
        color: d.style.color,
        lineWidth: clampedLineWidth,
        lineStyle: d.style.lineStyle ?? 0,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        // Drawings should never autoscale the main price axis.
        autoscaleInfoProvider: () => null,
      });
      if (d.kind === "ray") {
        lineSeries.setData([
          { time: d.startTime, value: d.price },
          { time: farRightTime, value: d.price },
        ]);
        if (d.style.showLabel && d.style.label.trim()) {
          const c = d.style.color;
          lineSeries.createPriceLine({
            price: d.price,
            color: c,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: d.style.label.trim(),
            axisLabelColor: "transparent",
            axisLabelTextColor: c,
          });
        }
      } else if (d.kind === "measure" || d.kind === "trend") {
        const first = d.startTime <= d.endTime ? { t: d.startTime, p: d.startPrice } : { t: d.endTime, p: d.endPrice };
        const second = d.startTime <= d.endTime ? { t: d.endTime, p: d.endPrice } : { t: d.startTime, p: d.startPrice };
        if (first.t === second.t) {
          lineSeries.setData([
            { time: first.t, value: first.p },
            { time: (first.t + drawingStepSeconds) as UTCTimestamp, value: second.p },
          ]);
        } else {
          lineSeries.setData([
            { time: first.t, value: first.p },
            { time: second.t, value: second.p },
          ]);
        }
      }
    }
    const onCrosshairMove = (param: { time?: unknown; point?: { x: number; y: number } }) => {
      if (param.time != null) {
        const candle = timeToCandle.get(param.time as number);
        setCrosshairCandle(candle ?? null);
        if (pendingMeasureDrawingIdRef.current && param.point) {
          setPendingMeasureCursorPoint({ x: param.point.x, y: param.point.y });
          const timeRaw = resolveTimeAtX(param.point.x, param.time);
          const clampedY = Math.max(0, Math.min(el.clientHeight - 1, param.point.y));
          const price = mainSeries.coordinateToPrice(clampedY);
          if (timeRaw != null && price != null && Number.isFinite(price)) {
            const snapped = snapPointToCandle(timeRaw, price);
            setDrawings((prev) =>
              prev.map((d) =>
                d.id === pendingMeasureDrawingIdRef.current && d.kind === "measure"
                  ? {
                      ...d,
                      endTime: snapped.time,
                      endPrice: snapped.price,
                      style: {
                        ...d.style,
                        label: formatMeasureLabel(
                          { startTime: d.startTime, startPrice: d.startPrice, endTime: snapped.time, endPrice: snapped.price },
                          barIndexByTime,
                          timeframe
                        ),
                      },
                    }
                  : d
              )
            );
          }
        } else if (!pendingMeasureDrawingIdRef.current) {
          setPendingMeasureCursorPoint(null);
        }
        if (crosshairSyncEnabled && !suppressCrosshairBroadcastRef.current) {
          const close = candle?.close;
          if (close != null && Number.isFinite(close)) {
            window.dispatchEvent(
              new CustomEvent("stock-chart-crosshair", {
                detail: {
                  symbol: symbol.toUpperCase(),
                  source: chartInstanceId,
                  time: param.time,
                  close,
                },
              })
            );
          }
        }
      } else {
        setCrosshairCandle(null);
        if (!pendingMeasureDrawingIdRef.current) setPendingMeasureCursorPoint(null);
        if (crosshairSyncEnabled && !suppressCrosshairBroadcastRef.current) {
          window.dispatchEvent(
            new CustomEvent("stock-chart-crosshair", {
              detail: {
                symbol: symbol.toUpperCase(),
                source: chartInstanceId,
                time: null,
                close: null,
              },
            })
          );
        }
      }
    };
    chart.subscribeCrosshairMove(onCrosshairMove as never);

    const onRemoteCrosshair = (evt: Event) => {
      if (!crosshairSyncEnabled) return;
      const detail = (evt as CustomEvent).detail as
        | { symbol?: string; source?: string; time?: unknown; close?: number | null }
        | undefined;
      if (!detail) return;
      if (detail.source === chartInstanceId) return;
      if ((detail.symbol ?? "").toUpperCase() !== symbol.toUpperCase()) return;
      suppressCrosshairBroadcastRef.current = true;
      try {
        if (detail.time == null || detail.close == null) {
          (chart as unknown as { clearCrosshairPosition?: () => void }).clearCrosshairPosition?.();
        } else {
          (chart as unknown as {
            setCrosshairPosition?: (price: number, time: unknown, series: unknown) => void;
          }).setCrosshairPosition?.(Number(detail.close), detail.time, mainSeries);
        }
      } finally {
        setTimeout(() => {
          suppressCrosshairBroadcastRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("stock-chart-crosshair", onRemoteCrosshair as EventListener);

    const finalizePendingMeasureAtPoint = (point: { x: number; y: number }) => {
      const activeMeasureId = pendingMeasureDrawingIdRef.current;
      if (!activeMeasureId) return false;
      const timeRaw = resolveTimeAtX(point.x);
      const clampedY = Math.max(0, Math.min(el.clientHeight - 1, point.y));
      const price = mainSeries.coordinateToPrice(clampedY);
      if (timeRaw == null || price == null || !Number.isFinite(price)) return false;
      const snapped = snapPointToCandle(timeRaw, price);
      setDrawings((prev) =>
        prev.map((d) => {
          if (d.id !== activeMeasureId || d.kind !== "measure") return d;
          const updated = { ...d, endTime: snapped.time, endPrice: snapped.price };
          return { ...updated, style: { ...updated.style, label: formatMeasureLabel(updated, barIndexByTime, timeframe) } };
        })
      );
      setSelectedDrawingId(activeMeasureId);
      setPendingMeasureDrawingId(null);
      setPendingMeasureStart(null);
      pendingMeasureDrawingIdRef.current = null;
      pendingMeasureStartRef.current = null;
      setPendingMeasureCursorPoint(null);
      setDrawMode("none");
      return true;
    };

    const onContainerMouseDown = (evt: MouseEvent) => {
      if (drawModeRef.current !== "measure" || !pendingMeasureDrawingIdRef.current) return;
      const rect = el.getBoundingClientRect();
      const point = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
      if (finalizePendingMeasureAtPoint(point)) {
        skipNextChartClickRef.current = true;
      }
    };
    el.addEventListener("mousedown", onContainerMouseDown);

    const onChartClick = (param: {
      time?: unknown;
      point?: { x: number; y: number };
    }) => {
      if (skipNextChartClickRef.current) {
        skipNextChartClickRef.current = false;
        return;
      }
      if (!param.point) return;
      if (drawModeRef.current === "none") {
        const x = param.point.x;
        const y = param.point.y;
        let bestId: string | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        const threshold = 10;
        for (const d of drawings) {
          const yCoord = mainSeries.priceToCoordinate(d.kind === "ray" ? d.price : d.startPrice);
          if (yCoord == null) continue;
          if (d.kind === "ray") {
            const x1 = chart.timeScale().timeToCoordinate(d.startTime);
            const x2 = chart.timeScale().timeToCoordinate(farRightTime);
            if (x1 == null || x2 == null) continue;
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const clampedX = Math.max(minX, Math.min(maxX, x));
            const dist = Math.hypot(clampedX - x, yCoord - y);
            if (dist < bestDist) {
              bestDist = dist;
              bestId = d.id;
            }
          } else {
            const x1 = chart.timeScale().timeToCoordinate(d.startTime);
            const y1 = mainSeries.priceToCoordinate(d.startPrice);
            const x2 = chart.timeScale().timeToCoordinate(d.endTime);
            const y2 = mainSeries.priceToCoordinate(d.endPrice);
            if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
            const dist = distanceToSegment(x, y, x1, y1, x2, y2);
            if (dist < bestDist) {
              bestDist = dist;
              bestId = d.id;
            }
          }
        }
        setSelectedDrawingId(bestDist <= threshold ? bestId : null);
        return;
      }
      const timeRaw = resolveTimeAtX(param.point.x);
      const clampedY = Math.max(0, Math.min(el.clientHeight - 1, param.point.y));
      const price = mainSeries.coordinateToPrice(clampedY);
      if (timeRaw == null || price == null || !Number.isFinite(price)) return;
      const snapped = snapPointToCandle(timeRaw, price);

      if (drawModeRef.current === "measure") {
        if (pendingMeasureStartRef.current == null) {
          const measure: MeasureDrawing = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            kind: "measure",
            startTime: snapped.time,
            startPrice: snapped.price,
            endTime: snapped.time,
            endPrice: snapped.price,
            style: { ...activeDrawingStyle, color: "#f59e0b", lineStyle: 2, showLabel: true, label: "" },
          };
          setDrawings((prev) => [...prev, measure]);
          setPendingMeasureStart({ time: snapped.time, price: snapped.price });
          setPendingMeasureDrawingId(measure.id);
          pendingMeasureStartRef.current = { time: snapped.time, price: snapped.price };
          pendingMeasureDrawingIdRef.current = measure.id;
          setPendingMeasureCursorPoint({ x: param.point.x, y: param.point.y });
          return;
        }
        finalizePendingMeasureAtPoint(param.point);
        return;
      }

      if (drawMode === "ray") {
        const ray: HorizontalRayDrawing = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind: "ray",
          startTime: snapped.time,
          price: snapped.price,
          style: activeDrawingStyle,
        };
        setDrawings((prev) => [...prev, ray]);
        setSelectedDrawingId(ray.id);
        setDrawMode("none");
        setPendingTrendStart(null);
        setPendingTrendDrawingId(null);
        return;
      }

      if (pendingTrendStart == null) {
        const trend: TrendLineDrawing = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind: "trend",
          startTime: snapped.time,
          startPrice: snapped.price,
          endTime: snapped.time,
          endPrice: snapped.price,
          style: activeDrawingStyle,
        };
        setDrawings((prev) => [...prev, trend]);
        setPendingTrendStart({ time: snapped.time, price: snapped.price });
        setPendingTrendDrawingId(trend.id);
        return;
      }

      const finalSnapped = snapped;
      setDrawings((prev) =>
        prev.map((d) =>
          d.id === pendingTrendDrawingId && d.kind === "trend"
            ? { ...d, endTime: finalSnapped.time, endPrice: finalSnapped.price }
            : d
        )
      );
      setSelectedDrawingId(pendingTrendDrawingId);
      setPendingTrendDrawingId(null);
      setPendingTrendStart(null);
      setDrawMode("none");
    };
    chart.subscribeClick(onChartClick);

    if (settings.showVolume && volumeCandleData.length > 0) {
      chart.addSeries(
        CandlestickSeries,
        {
          priceFormat: { type: "custom", minMove: 1, formatter: (v: number) => fmtVol(v) },
          priceScaleId: "",
          lastValueVisible: true,
          priceLineVisible: false,
          upColor: settings.candleUpBodyColor,
          downColor: settings.candleDownBodyColor,
          borderVisible: true,
          borderUpColor: settings.candleUpBorderColor,
          borderDownColor: settings.candleDownBorderColor,
          wickVisible: false,
        },
        1
      ).setData(volumeCandleData);
      try {
        const volScale = chart.priceScale("");
        if (volScale) {
          volScale.applyOptions({
            visible: true,
            borderVisible: true,
            borderColor: isLightBackground ? "rgba(0,0,0,0.2)" : "rgba(113,113,122,0.5)",
            minimumWidth: 64,
          } as Record<string, unknown>);
        }
      } catch { /* ignore */ }
      const panes = chart.panes();
      if (panes[0]) panes[0].setStretchFactor(7);
      if (panes[1]) panes[1].setStretchFactor(1);
    }

    const barCount = seriesData.length;
    const maxTo = Math.max(0, barCount - 1) + 3;
    const viewportKey = getViewportStorageKey(chartInstanceId, timeframe);
    const remembered = loadViewportMemory(viewportKey);
    if (remembered) {
      const visibleBars = Math.max(5, Math.min(5000, remembered.visibleBars));
      const rawTo = maxTo - remembered.barsFromRight;
      const minTo = -visibleBars + 1;
      const maxToAllowed = maxTo + 200;
      let to = Math.max(minTo, Math.min(maxToAllowed, rawTo));
      // Guard against future-only windows (can render an "empty" chart).
      // Keep at least one real bar inside the visible logical range.
      const latestRealBar = Math.max(0, barCount - 1);
      if (to - visibleBars >= latestRealBar) {
        to = latestRealBar + 3;
      }
      // Also guard against past-only windows (entire range before first bar).
      if (to < 0) {
        to = Math.min(maxTo, visibleBars - 1);
      }
      const from = to - visibleBars;
      chart.timeScale().setVisibleLogicalRange({ from, to });
    } else {
      chart.timeScale().setVisibleLogicalRange(getDefaultLogicalRange(timeframe, barCount));
    }

    const onVisibleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range || suppressViewportMemoryRef.current) return;
      const visibleBars = Math.max(5, Math.min(5000, Number(range.to) - Number(range.from)));
      if (!Number.isFinite(visibleBars) || visibleBars <= 0) return;
      const barsFromRight = Math.max(-200, Math.min(20000, maxTo - Number(range.to)));
      if (!Number.isFinite(barsFromRight)) return;
      saveViewportMemory(viewportKey, { barsFromRight, visibleBars });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

    const onVisibleTimeRangeChange = (range: { from: unknown; to: unknown } | null) => {
      if (!onVisibleDateRangeChange) return;
      if (!range || range.from == null || range.to == null) {
        onVisibleDateRangeChange(null);
        return;
      }
      const fromDate = timeToDateKey(range.from);
      const toDate = timeToDateKey(range.to);
      if (!fromDate || !toDate) {
        onVisibleDateRangeChange(null);
        return;
      }
      onVisibleDateRangeChange(
        fromDate <= toDate ? { from: fromDate, to: toDate } : { from: toDate, to: fromDate }
      );
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleTimeRangeChange as never);
    if (onVisibleDateRangeChange) {
      const initialVisibleRange = (
        chart.timeScale() as { getVisibleRange?: () => { from: unknown; to: unknown } | null }
      ).getVisibleRange?.() ?? null;
      onVisibleTimeRangeChange(initialVisibleRange);
    }

    try {
      const rightScale = chart.priceScale("right");
      if (rightScale) rightScale.applyOptions({ visible: true, borderVisible: true });
    } catch {
      /* ignore */
    }

    chartRef.current = chart;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const from = Number(range.from);
      const to = Number(range.to);
      const visibleBars = to - from;
      const zoomFactor = e.deltaY > 0 ? 0.1 : -0.1;
      const delta = Math.max(1, Math.round(visibleBars * Math.abs(zoomFactor)));
      const newFrom = e.deltaY > 0 ? from - delta : from + delta;
      const clampedFrom = Math.max(-50, Math.min(to - 5, newFrom));
      ts.setVisibleLogicalRange({ from: clampedFrom, to });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      const el = containerRef.current;
      chartRef.current.applyOptions({
        width: el.clientWidth,
        height: Math.max(el.clientHeight, 300),
      });
    };
    window.addEventListener("resize", handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("mousedown", onContainerMouseDown);
      try {
        chart.unsubscribeCrosshairMove(onCrosshairMove as never);
      } catch {
        /* ignore */
      }
      try {
        chart.unsubscribeClick(onChartClick as never);
      } catch {
        /* ignore */
      }
      window.removeEventListener("stock-chart-crosshair", onRemoteCrosshair as EventListener);
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onVisibleTimeRangeChange as never);
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
    };
  }, [
    symbol,
    timeframe,
    chronological,
    seriesData,
    volumeCandleData,
    ema50Data,
    ema200Data,
    ema40Data,
    settings,
    isLightBackground,
    drawings,
    drawMode,
    activeDrawingStyle,
    pendingTrendStart,
    pendingTrendDrawingId,
    pendingMeasureStart,
    pendingMeasureDrawingId,
    snapPointToCandle,
    selectedDrawingId,
    timeToCandle,
    crosshairSyncEnabled,
    onVisibleDateRangeChange,
    chartInstanceId,
    barIndexByTime,
  ]);

  const selectedDrawing = useMemo(
    () => drawings.find((d) => d.id === selectedDrawingId) ?? null,
    [drawings, selectedDrawingId]
  );
  const updateSelectedDrawingStyle = useCallback(
    (partial: Partial<DrawingStyle>) => {
      if (!selectedDrawingId) return;
      setDrawings((prev) =>
        prev.map((d) =>
          d.id === selectedDrawingId
            ? {
                ...d,
                style: {
                  ...d.style,
                  ...partial,
                },
              }
            : d
        )
      );
    },
    [selectedDrawingId]
  );

  const handleResetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || seriesData.length === 0) return;
    const viewportKey = getViewportStorageKey(chartInstanceId, timeframe);
    clearViewportMemory(viewportKey);
    suppressViewportMemoryRef.current = true;
    chart.timeScale().setVisibleLogicalRange(getDefaultLogicalRange(timeframe, seriesData.length));
    setTimeout(() => {
      suppressViewportMemoryRef.current = false;
    }, 0);
  }, [chartInstanceId, timeframe, seriesData.length]);

  useEffect(() => {
    if (selectedDrawingId && !drawings.some((d) => d.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
    }
  }, [drawings, selectedDrawingId]);

  useEffect(() => {
    if (!selectedDrawing) setShowSelectedDrawingSettings(false);
  }, [selectedDrawing]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setDrawMode((m) => (m === "ray" ? "none" : "ray"));
        setPendingTrendStart(null);
        setPendingTrendDrawingId(null);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setDrawMode((m) => (m === "trend" ? "none" : "trend"));
        setPendingTrendStart(null);
        setPendingTrendDrawingId(null);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setDrawMode((m) => (m === "measure" ? "none" : "measure"));
        setPendingMeasureStart(null);
        setPendingMeasureDrawingId(null);
        pendingMeasureStartRef.current = null;
        pendingMeasureDrawingIdRef.current = null;
        setPendingMeasureCursorPoint(null);
        return;
      }

      if (onFlagChange && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (showFlagPicker) {
          onFlagChange(null);
          setShowFlagPicker(false);
          setShowWatchlistModal(false);
          return;
        }
        setShowFlagPicker(true);
        setShowWatchlistModal(false);
        return;
      }
      if (onFlagChange && showFlagPicker) {
        const numpadDigit =
          e.code === "Numpad0"
            ? "0"
            : e.code === "Numpad1"
              ? "1"
              : e.code === "Numpad2"
                ? "2"
                : e.code === "Numpad3"
                  ? "3"
                  : e.code === "Numpad4"
                    ? "4"
                    : e.code === "Numpad5"
                      ? "5"
                      : null;
        const key = numpadDigit ?? e.key;
        if (key === "0") {
          e.preventDefault();
          onFlagChange(null);
          setShowFlagPicker(false);
          return;
        }
        if (key === "1") {
          e.preventDefault();
          onFlagChange("blue");
          setShowFlagPicker(false);
          return;
        }
        if (key === "2") {
          e.preventDefault();
          onFlagChange("purple");
          setShowFlagPicker(false);
          return;
        }
        if (key === "3") {
          e.preventDefault();
          onFlagChange("yellow");
          setShowFlagPicker(false);
          return;
        }
        if (key === "4") {
          e.preventDefault();
          onFlagChange("red");
          setShowFlagPicker(false);
          return;
        }
        if (key === "5") {
          e.preventDefault();
          onFlagChange("green");
          setShowFlagPicker(false);
          return;
        }
      }

      if (selectedDrawingId && e.key === "Delete") {
        setDrawings((prev) => prev.filter((d) => d.id !== selectedDrawingId));
        setSelectedDrawingId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedDrawingId, onFlagChange, showFlagPicker]);

  const getHandlePoint = useCallback(
    (d: ChartDrawing, handle: DragHandle): { x: number; y: number } | null => {
      const chart = chartRef.current;
      const series = mainSeriesRef.current;
      if (!chart || !series) return null;
      if (d.kind === "ray") {
        const x = chart.timeScale().timeToCoordinate(d.startTime);
        const y = series.priceToCoordinate(d.price);
        if (x == null || y == null) return null;
        return { x, y };
      }
      const time = handle === "trend-start" ? d.startTime : d.endTime;
      const price = handle === "trend-start" ? d.startPrice : d.endPrice;
      const x = chart.timeScale().timeToCoordinate(time);
      const y = series.priceToCoordinate(price);
      if (x == null || y == null) return null;
      return { x, y };
    },
    []
  );

  useEffect(() => {
    if (!dragState) return;
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const el = containerRef.current;
    if (!chart || !series || !el) return;

    const onMove = (evt: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const rawTime = chart.timeScale().coordinateToTime(x);
      const time0 = normalizeTime(rawTime);
      const price0 = series.coordinateToPrice(y);
      if (time0 == null || price0 == null || !Number.isFinite(price0)) return;
      const snapped = snapPointToCandle(time0, price0);

      setDrawings((prev) =>
        prev.map((d) => {
          if (d.id !== dragState.drawingId) return d;
          if (d.kind === "ray") {
            return {
              ...d,
              startTime: snapped.time,
              price: snapped.price,
            };
          }
          if (dragState.handle === "trend-start") {
            return {
              ...d,
              startTime: snapped.time,
              startPrice: snapped.price,
            };
          }
          return {
            ...d,
            endTime: snapped.time,
            endPrice: snapped.price,
          };
        })
      );
    };
    const onUp = () => setDragState(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState, snapPointToCandle]);

  useEffect(() => {
    if (!pendingTrendDrawingId) return;
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const el = containerRef.current;
    if (!chart || !series || !el) return;

    const onMove = (evt: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const rawTime = chart.timeScale().coordinateToTime(x);
      const time0 = normalizeTime(rawTime);
      const price0 = series.coordinateToPrice(y);
      if (time0 == null || price0 == null || !Number.isFinite(price0)) return;
      const snapped = snapPointToCandle(time0, price0);

      setDrawings((prev) =>
        prev.map((d) =>
          d.id === pendingTrendDrawingId && d.kind === "trend"
            ? { ...d, endTime: snapped.time, endPrice: snapped.price }
            : d
        )
      );
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [pendingTrendDrawingId, snapPointToCandle]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onShiftClick = (e: MouseEvent) => {
      if (e.shiftKey && drawMode === "none") {
        setDrawMode("measure");
      }
    };
    el.addEventListener("mousedown", onShiftClick);
    return () => el.removeEventListener("mousedown", onShiftClick);
  }, [drawMode]);

  useEffect(() => {
    if (!showWatchlistModal || !watchlistPickerLists) return;
    const d: Record<string, boolean> = {};
    for (const w of watchlistPickerLists) d[w.id] = w.hasSymbol;
    setWlDraft(d);
  }, [showWatchlistModal, watchlistPickerLists]);

  useLayoutEffect(() => {
    if (!showFlagPicker) {
      setChartFlagAnchorRect(null);
      return;
    }
    const el = chartFlagBtnRef.current;
    if (!el) return;
    const sync = () => setChartFlagAnchorRect(el.getBoundingClientRect());
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [showFlagPicker]);

  useEffect(() => {
    if (!showFlagPicker) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-chart-flag-picker]")) return;
      if (chartFlagBtnRef.current?.contains(t as Node)) return;
      setShowFlagPicker(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showFlagPicker]);

  const selectedHandles = useMemo(() => {
    if (!selectedDrawing) return [];
    if (selectedDrawing.kind === "ray") {
      const p = getHandlePoint(selectedDrawing, "ray-anchor");
      return p ? [{ key: "ray-anchor", handle: "ray-anchor" as DragHandle, point: p }] : [];
    }
    const start = getHandlePoint(selectedDrawing, "trend-start");
    const end = getHandlePoint(selectedDrawing, "trend-end");
    return [
      ...(start ? [{ key: "trend-start", handle: "trend-start" as DragHandle, point: start }] : []),
      ...(end ? [{ key: "trend-end", handle: "trend-end" as DragHandle, point: end }] : []),
    ];
  }, [selectedDrawing, getHandlePoint]);

  const selectedDrawingScreenPos = useMemo<{ x: number; y: number } | null>(() => {
    if (!selectedDrawing) return null;
    if (selectedDrawing.kind === "ray") {
      return getHandlePoint(selectedDrawing, "ray-anchor");
    }
    const start = getHandlePoint(selectedDrawing, "trend-start");
    const end = getHandlePoint(selectedDrawing, "trend-end");
    if (start && end) return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return start ?? end ?? null;
  }, [selectedDrawing, getHandlePoint]);

  const measureLabels = useMemo(
    () =>
      drawings
        .filter((d): d is MeasureDrawing => d.kind === "measure" && Boolean(d.style.label?.trim()))
        .map((d) => {
          const stats = getMeasureStats(
            { startTime: d.startTime, startPrice: d.startPrice, endTime: d.endTime, endPrice: d.endPrice },
            barIndexByTime
          );
          return {
            id: d.id,
            color: d.style.color,
            stats,
            spanText: formatMeasureSpanText(
              timeframe,
              Number(d.startTime),
              Number(d.endTime),
              stats.barsDiff,
              stats.daysDiff
            ),
            point:
              d.id === pendingMeasureDrawingId && pendingMeasureCursorPoint
                ? pendingMeasureCursorPoint
                : getHandlePoint(d, "trend-end"),
          };
        })
        .filter((m) => m.point != null),
    [drawings, getHandlePoint, pendingMeasureDrawingId, pendingMeasureCursorPoint, barIndexByTime, timeframe]
  );

  return (
    <>
    <div className="flex-1 min-h-0 relative overflow-hidden bg-white dark:bg-[var(--ws-bg)]">
      <div
        className="absolute top-0 left-0 right-0 z-20 px-2 py-1 flex items-center justify-between gap-2 flex-wrap"
        style={{ paddingRight: CHART_PRICE_SCALE_GUTTER_PX, pointerEvents: "none" }}
      >
        <div
          className="flex items-center gap-1 flex-wrap ml-auto rounded-b px-1.5 py-0.5"
          style={{
            pointerEvents: "auto",
            background: isLightBackground ? "rgba(255,255,255,0.28)" : "transparent",
          }}
        >
          <div className="flex items-center gap-1">
            {onTimeframeChange && (
              <>
                {tfFavorites.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => onTimeframeChange(tf)}
                    className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
                      timeframe === tf ? toolbarActiveClass : toolbarMutedClass
                    }`}
                  >
                    {CHART_TIMEFRAME_META[tf].abbrev}
                  </button>
                ))}
                <div className="relative" ref={tfMenuRef}>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={tfMenuOpen}
                    onClick={() => setTfMenuOpen((o) => !o)}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${toolbarMutedClass}`}
                    title="All timeframes"
                  >
                    <svg
                      viewBox="0 0 14 14"
                      className="h-[14px] w-[14px] shrink-0 text-current"
                      aria-hidden="true"
                    >
                      <path
                        d="M3.5 5.25L7 8.75l3.5-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    TF
                  </button>
                  {tfMenuOpen && (
                    <div
                      className="absolute right-0 top-full z-50 mt-0.5 min-w-[220px] max-h-[min(70vh,420px)] overflow-y-auto rounded border py-1 shadow-lg"
                      role="listbox"
                      style={{
                        background: isLightBackground ? "rgba(255,255,255,0.98)" : "rgba(28,30,34,0.98)",
                        borderColor: isLightBackground ? "rgba(0,0,0,0.12)" : "rgba(113,113,122,0.5)",
                      }}
                    >
                      {CHART_TIMEFRAMES.map((tf) => {
                        const fav = tfFavorites.includes(tf);
                        const atMax = tfFavorites.length >= MAX_TIMEFRAME_FAVORITES;
                        return (
                          <div key={tf} className="flex items-center gap-1 px-1 py-0.5">
                            <button
                              type="button"
                              role="option"
                              aria-selected={timeframe === tf}
                              className={`min-w-0 flex-1 text-left px-2 py-1 text-ws-label rounded ${
                                timeframe === tf ? toolbarActiveClass : toolbarMutedClass
                              }`}
                              onClick={() => {
                                onTimeframeChange(tf);
                                setTfMenuOpen(false);
                              }}
                            >
                              {CHART_TIMEFRAME_META[tf].labelLong}
                            </button>
                            <button
                              type="button"
                              className={`shrink-0 px-1.5 py-1 text-sm leading-none rounded ${toolbarMutedClass}`}
                              aria-label={fav ? "Remove from favorites" : "Add to favorites"}
                              title={
                                fav
                                  ? "Remove from favorites"
                                  : atMax && !fav
                                    ? `Maximum ${MAX_TIMEFRAME_FAVORITES} favorites`
                                    : "Add to favorites"
                              }
                              disabled={!fav && atMax}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTfFavorite(tf);
                              }}
                            >
                              {fav ? "★" : "☆"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => applyThemePalette(isUsingLightTheme ? DEFAULT_CHART_SETTINGS : LIGHT_CHART_THEME)}
            className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${toolbarMutedClass}`}
            title="Toggle chart theme"
          >
            {isUsingLightTheme ? "Dark" : "Light"}
          </button>
          <span className={`mx-1 h-4 w-px ${toolbarDividerClass}`} />
          <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setDrawMode((m) => (m === "ray" ? "none" : "ray"));
              setPendingTrendStart(null);
              setPendingTrendDrawingId(null);
            }}
            className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
              drawMode === "ray"
                ? "bg-amber-300 text-zinc-900 dark:bg-amber-500/25 dark:text-amber-100"
                : toolbarMutedClass
            }`}
            title="Draw horizontal ray"
          >
            Ray
          </button>
          <button
            type="button"
            onClick={() => {
              setDrawMode((m) => (m === "trend" ? "none" : "trend"));
              setPendingTrendStart(null);
              setPendingTrendDrawingId(null);
            }}
            className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
              drawMode === "trend"
                ? "bg-violet-300 text-zinc-900 dark:bg-violet-500/25 dark:text-violet-100"
                : toolbarMutedClass
            }`}
            title="Draw trend line"
          >
            Trend
          </button>
          <button
            type="button"
            onClick={() => {
              setDrawMode((m) => (m === "measure" ? "none" : "measure"));
              setPendingMeasureStart(null);
              setPendingMeasureDrawingId(null);
              pendingMeasureStartRef.current = null;
              pendingMeasureDrawingIdRef.current = null;
              setPendingMeasureCursorPoint(null);
            }}
            className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
              drawMode === "measure"
                ? "bg-orange-300 text-zinc-900 dark:bg-orange-500/25 dark:text-orange-100"
                : toolbarMutedClass
            }`}
            title="Measure tool (SHIFT+click or Alt+M)"
          >
            Measure
          </button>
          <button
            type="button"
            onClick={() => setSnapToOhlc((v) => !v)}
            className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
              snapToOhlc
                ? "bg-cyan-300 text-zinc-900 dark:bg-[var(--ws-cyan-dim)] dark:text-[var(--ws-cyan)]"
                : toolbarMutedClass
            }`}
            title="Snap to OHLC"
          >
            Snap
          </button>
          </div>
          {showGlobalControls && (
            <span className={`mx-1 h-4 w-px ${toolbarDividerClass}`} />
          )}
          {showGlobalControls && onToggleDualMode && (
            <button
              type="button"
              onClick={onToggleDualMode}
              className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
                dualModeEnabled
                  ? toolbarActiveClass
                  : toolbarMutedClass
              }`}
              title="Toggle dual chart mode"
              aria-label="Toggle dual chart mode"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <rect x="1.5" y="2.5" width="5.5" height="11" rx="1" />
                <rect x="9" y="2.5" width="5.5" height="11" rx="1" />
              </svg>
            </button>
          )}
          {showGlobalControls && onToggleCrosshairSync && (
            <button
              type="button"
              onClick={onToggleCrosshairSync}
              className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${
                crosshairSyncEnabled
                  ? "bg-sky-300 text-zinc-900 dark:bg-[rgba(92,158,245,0.2)] dark:text-[var(--ws-blue)]"
                  : toolbarMutedClass
              }`}
              title="Toggle crosshair sync"
              aria-label="Toggle crosshair sync"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5M8 6.2v3.6M6.2 8h3.6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          )}
          <span className={`mx-1 h-4 w-px ${toolbarDividerClass}`} />
          <button
            type="button"
            onClick={handleResetView}
            className={`px-2 py-0.5 text-ws-label font-medium rounded transition-colors ${toolbarMutedClass}`}
            title="Reset chart view"
            aria-label="Reset chart view"
          >
            Reset
          </button>
          {onFlagChange && (
            <div className="relative">
              <button
                ref={chartFlagBtnRef}
                type="button"
                onClick={() => { setShowFlagPicker((v) => !v); setShowWatchlistModal(false); }}
                className={`px-1.5 py-0.5 text-ws-label font-medium rounded transition-colors ${toolbarMutedClass} flex items-center gap-1`}
                title="Flag (Shift+F opens; Shift+F again clears. Keys 0–5 when open)"
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill={stockFlag ? CHART_FLAG_HEX[stockFlag] : "currentColor"} stroke={stockFlag ? CHART_FLAG_HEX[stockFlag] : "currentColor"} strokeWidth="0.5" aria-hidden>
                  <path d="M3 1v14M3 1h9l-2.5 4L12 9H3" />
                </svg>
              </button>
            </div>
          )}
          {onWatchlistMembershipSave && watchlistPickerLists != null && (
            <div className="relative">
              <button
                type="button"
                onClick={() => { setShowWatchlistModal((v) => !v); setShowFlagPicker(false); }}
                className={`px-1.5 py-0.5 text-ws-label font-medium rounded transition-colors ${toolbarMutedClass}`}
                title="Lists"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-zinc-500 dark:text-[var(--ws-text-dim)]">Loading chart…</p>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <p className="text-zinc-500 dark:text-[var(--ws-text-dim)]">No chart data</p>
            {onRetryLoad && (
              <button
                type="button"
                className="px-2.5 py-1 text-xs rounded ws-focus-ring"
                style={{ background: "var(--ws-cyan)", color: "var(--ws-bg)" }}
                onClick={onRetryLoad}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      ) : (
        <div ref={chartAreaRef} className="absolute inset-0">
          {/* Canvas first (opaque); watermark must sit above it or it is never visible */}
          <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-0"
            onContextMenu={(ev) => {
              if (pendingMeasureDrawingId != null) {
                ev.preventDefault();
                const id = pendingMeasureDrawingId;
                setDrawings((prev) => prev.filter((d) => !(d.id === id && d.kind === "measure")));
                setPendingMeasureDrawingId(null);
                setPendingMeasureStart(null);
                pendingMeasureStartRef.current = null;
                pendingMeasureDrawingIdRef.current = null;
                setPendingMeasureCursorPoint(null);
                return;
              }
              if (pendingTrendDrawingId != null && pendingTrendStart != null) {
                ev.preventDefault();
                const id = pendingTrendDrawingId;
                setDrawings((prev) => prev.filter((d) => !(d.id === id && d.kind === "trend")));
                setPendingTrendDrawingId(null);
                setPendingTrendStart(null);
              }
            }}
          />
          {!chartNarrow && (
            <div
              className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center overflow-hidden"
              aria-hidden
            >
              <span
                className="select-none font-mono font-bold tracking-tight text-center leading-none"
                style={{
                  marginLeft: "min(20%, 160px)",
                  fontSize: "clamp(1.75rem, min(11vw, 10vh), 5rem)",
                  color: isLightBackground ? "rgba(0,0,0,0.09)" : "rgba(201, 209, 217, 0.14)",
                  maxWidth: "56%",
                }}
              >
                {symbol.toUpperCase()}
              </span>
            </div>
          )}
          {crosshairCandle && (() => {
            const idx = chronological.findIndex((c) => c.date === crosshairCandle.date);
            const prevClose = idx > 0 ? chronological[idx - 1].close : null;
            const chgPct = prevClose != null && prevClose > 0
              ? ((crosshairCandle.close - prevClose) / prevClose) * 100
              : null;
            return (
              <div
                className="absolute z-10 text-ws-label font-medium flex items-center justify-end gap-3 whitespace-nowrap pointer-events-none"
                style={{
                  top: CHART_OHLC_READOUT_TOP_PX,
                  right: CHART_PRICE_SCALE_GUTTER_PX,
                  color: isLightBackground ? "#333333" : "var(--ws-text, #e5e5e5)",
                }}
              >
                <span>O {crosshairCandle.open.toFixed(2)}</span>
                <span>H {crosshairCandle.high.toFixed(2)}</span>
                <span>L {crosshairCandle.low.toFixed(2)}</span>
                <span>C {crosshairCandle.close.toFixed(2)}</span>
                {chgPct != null && (
                  <span style={{ color: chgPct >= 0 ? "var(--ws-green, #22c55e)" : "var(--ws-red, #ef4444)" }}>
                    {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%
                  </span>
                )}
                <span>V {fmtVol(crosshairCandle.volume)}</span>
              </div>
            );
          })()}
          <div
            className="absolute z-10 flex flex-col items-end gap-1"
            style={{ top: CHART_INDICATOR_COLUMN_TOP_PX, right: CHART_PRICE_SCALE_GUTTER_PX }}
          >
            {(timeframe === "daily" ? [
              { key: "ema50", label: "EMA(50)", color: "#ef4444", active: settings.showEma50, toggle: () => handleUpdateSettings({ showEma50: !settings.showEma50 }) },
              { key: "ema200", label: "EMA(200)", color: "#22c55e", active: settings.showEma200, toggle: () => handleUpdateSettings({ showEma200: !settings.showEma200 }) },
            ] : timeframe === "weekly" ? [
              { key: "ema40w", label: "EMA(40W)", color: "#22c55e", active: settings.showEma40Weekly, toggle: () => handleUpdateSettings({ showEma40Weekly: !settings.showEma40Weekly }) },
            ] : []).concat([
              { key: "vol", label: "Vol", color: "#7B8794", active: settings.showVolume, toggle: () => handleUpdateSettings({ showVolume: !settings.showVolume }) },
            ]).map((ind) => (
              <button
                key={ind.key}
                type="button"
                onClick={ind.toggle}
                className="flex items-center gap-1.5 py-0.5 text-ws-label font-medium transition-opacity cursor-pointer border-0 bg-transparent shadow-none outline-offset-2 hover:opacity-90 ws-focus-ring"
                aria-pressed={ind.active}
                style={{
                  color: ind.active ? ind.color : `${ind.color}66`,
                  textDecoration: ind.active ? "none" : "line-through",
                }}
                title={`Toggle ${ind.label}`}
              >
                <span
                  className="shrink-0 w-2 h-2 rounded-full"
                  style={{ background: ind.active ? ind.color : `${ind.color}55` }}
                />
                {ind.label}
              </button>
            ))}
          </div>
          {measureLabels.map((m) => (
            <div
              key={m.id}
              className="absolute z-15 pointer-events-none rounded px-1.5 py-0.5 text-[13px] font-medium leading-tight flex flex-col gap-0.5"
              style={{
                left: `${m.point!.x + 8}px`,
                top: `${m.point!.y - 10}px`,
                color: m.color,
                background: isLightBackground ? "rgba(255,255,255,0.85)" : "rgba(20,24,30,0.78)",
                border: `1px solid ${m.color}55`,
              }}
            >
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span style={{ color: m.stats.pricePct >= 0 ? "var(--ws-green, #22c55e)" : "var(--ws-red, #ef4444)" }}>
                  {m.stats.pricePct >= 0 ? "+" : ""}{m.stats.pricePct.toFixed(2)}%
                </span>
                <span style={{ color: m.stats.priceDelta >= 0 ? "var(--ws-green, #22c55e)" : "var(--ws-red, #ef4444)" }}>
                  {m.stats.priceDelta >= 0 ? "+" : ""}{m.stats.priceDelta.toFixed(2)}
                </span>
              </div>
              <div className="text-[12px] opacity-90 whitespace-nowrap" style={{ color: isLightBackground ? "#444" : "var(--ws-text-dim, #a1a1aa)" }}>
                {m.spanText}
              </div>
            </div>
          ))}
          {selectedHandles.map((h) => (
            <button
              key={h.key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setDragState({ drawingId: selectedDrawingId as string, handle: h.handle });
              }}
              className="absolute z-20 h-3 w-3 rounded-full border border-white shadow"
              style={{
                left: `${h.point.x}px`,
                top: `${h.point.y}px`,
                transform: "translate(-50%, -50%)",
                background: "var(--ws-cyan)",
              }}
              title="Drag to edit"
              aria-label="Drag drawing handle"
            />
          ))}
          {selectedDrawing && selectedDrawingScreenPos && (
            <div
              className="absolute z-20 flex items-center gap-1"
              style={{
                left: `${selectedDrawingScreenPos.x}px`,
                top: `${Math.max(4, selectedDrawingScreenPos.y - 36)}px`,
                transform: "translateX(-50%)",
              }}
            >
              <button
                type="button"
                onClick={() => setShowSelectedDrawingSettings((v) => !v)}
                className="p-1.5 rounded bg-zinc-900/80 text-zinc-300 border border-zinc-600 hover:bg-zinc-800"
                title="Drawing settings"
                aria-label="Drawing settings"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M9.243 1.5a1.25 1.25 0 0 0-2.486 0l-.11.887a4.51 4.51 0 0 0-1.26.73l-.852-.36a1.25 1.25 0 0 0-1.64.66l-.75 1.8a1.25 1.25 0 0 0 .64 1.62l.83.35a4.37 4.37 0 0 0 0 1.46l-.83.35a1.25 1.25 0 0 0-.64 1.62l.75 1.8a1.25 1.25 0 0 0 1.64.66l.852-.36a4.51 4.51 0 0 0 1.26.73l.11.887a1.25 1.25 0 0 0 2.486 0l.11-.887a4.51 4.51 0 0 0 1.26-.73l.852.36a1.25 1.25 0 0 0 1.64-.66l.75-1.8a1.25 1.25 0 0 0-.64-1.62l-.83-.35a4.37 4.37 0 0 0 0-1.46l.83-.35a1.25 1.25 0 0 0 .64-1.62l-.75-1.8a1.25 1.25 0 0 0-1.64-.66l-.852.36a4.51 4.51 0 0 0-1.26-.73l-.11-.887ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawings((prev) => prev.filter((d) => d.id !== selectedDrawing.id));
                  setSelectedDrawingId(null);
                }}
                className="p-1.5 rounded bg-zinc-900/80 text-rose-300 border border-zinc-600 hover:bg-zinc-800"
                title="Delete drawing"
                aria-label="Delete drawing"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M6.5 1.5h3a1 1 0 0 1 1 1V3H13a.5.5 0 0 1 0 1h-.5l-.6 9a1.5 1.5 0 0 1-1.5 1.4H5.6A1.5 1.5 0 0 1 4.1 13l-.6-9H3a.5.5 0 0 1 0-1h2.5v-.5a1 1 0 0 1 1-1Zm0 1a.2.2 0 0 0-.2.2V3h3.4v-.3a.2.2 0 0 0-.2-.2h-3Z" />
                </svg>
              </button>
              {showSelectedDrawingSettings && (
                <div className="absolute right-0 top-9 w-52 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg p-2 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-600 dark:text-zinc-300">Color</span>
                    <input
                      type="color"
                      value={selectedDrawing.style.color}
                      onChange={(e) => updateSelectedDrawingStyle({ color: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-600 dark:text-zinc-300">Thickness</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={selectedDrawing.style.lineWidth}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        updateSelectedDrawingStyle({ lineWidth: Math.max(1, Math.min(6, n)) });
                      }}
                      className="w-14 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-zinc-700 dark:text-zinc-200"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-600 dark:text-zinc-300">Style</span>
                    <select
                      value={selectedDrawing.style.lineStyle ?? 0}
                      onChange={(e) =>
                        updateSelectedDrawingStyle({ lineStyle: Number(e.target.value) as 0 | 1 | 2 })
                      }
                      className="w-24 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-zinc-700 dark:text-zinc-200"
                    >
                      <option value={0}>Solid</option>
                      <option value={2}>Dashed</option>
                      <option value={1}>Dotted</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Chart settings trigger at axes intersection (bottom-right) */}
          <div className="absolute bottom-1 right-1 z-20">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="p-1.5 rounded bg-zinc-900/80 text-zinc-300 border border-zinc-600 hover:bg-zinc-800"
              title="Chart settings"
              aria-label="Chart settings"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M9.243 1.5a1.25 1.25 0 0 0-2.486 0l-.11.887a4.51 4.51 0 0 0-1.26.73l-.852-.36a1.25 1.25 0 0 0-1.64.66l-.75 1.8a1.25 1.25 0 0 0 .64 1.62l.83.35a4.37 4.37 0 0 0 0 1.46l-.83.35a1.25 1.25 0 0 0-.64 1.62l.75 1.8a1.25 1.25 0 0 0 1.64.66l.852-.36a4.51 4.51 0 0 0 1.26.73l.11.887a1.25 1.25 0 0 0 2.486 0l.11-.887a4.51 4.51 0 0 0 1.26-.73l.852.36a1.25 1.25 0 0 0 1.64-.66l.75-1.8a1.25 1.25 0 0 0-.64-1.62l-.83-.35a4.37 4.37 0 0 0 0-1.46l.83-.35a1.25 1.25 0 0 0 .64-1.62l-.75-1.8a1.25 1.25 0 0 0-1.64-.66l-.852.36a4.51 4.51 0 0 0-1.26-.73l-.11-.887ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
              </svg>
            </button>
            {showSettings && (
              <div className="absolute right-0 bottom-7 z-20 w-64 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg p-3 text-xs space-y-3">
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Chart type</div>
                  <div className="flex flex-wrap gap-1">
                    {(["candles", "line", "area"] as ChartSeriesType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleUpdateSettings({ type: t })}
                        className={`px-2 py-0.5 rounded border text-ws-label ${
                          settings.type === t
                            ? "border-zinc-700 dark:border-zinc-300 text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-700"
                            : "border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {t === "candles" ? "Candles" : t === "line" ? "Line" : "Area"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Overlays</div>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showEma50}
                      onChange={(e) => handleUpdateSettings({ showEma50: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">EMA 50 (daily)</span>
                  </label>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showEma200}
                      onChange={(e) => handleUpdateSettings({ showEma200: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">EMA 200 (daily)</span>
                  </label>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showEma40Weekly}
                      onChange={(e) => handleUpdateSettings({ showEma40Weekly: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">EMA 40 (weekly)</span>
                  </label>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Drawing tools</div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {(["weekly", "daily", "custom"] as DrawTemplate[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setDrawTemplate(t)}
                        className={`px-2 py-0.5 rounded border text-ws-label ${
                          drawTemplate === t
                            ? "border-zinc-700 dark:border-zinc-300 text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-700"
                            : "border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {t === "weekly" ? "Weekly" : t === "daily" ? "Daily" : "Custom"}
                      </button>
                    ))}
                  </div>
                  <div className="text-ws-label text-zinc-500 dark:text-zinc-400 mb-2">
                    Weekly template uses yellow/orange. Daily uses purple/magenta.
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawMode((m) => (m === "ray" ? "none" : "ray"));
                        setPendingTrendStart(null);
                        setPendingTrendDrawingId(null);
                      }}
                      className={`px-2 py-0.5 rounded border text-ws-label ${
                        drawMode === "ray"
                          ? "border-zinc-700 dark:border-zinc-300 text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-700"
                          : "border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Horizontal Ray
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawMode((m) => (m === "trend" ? "none" : "trend"));
                        setPendingTrendStart(null);
                        setPendingTrendDrawingId(null);
                      }}
                      className={`px-2 py-0.5 rounded border text-ws-label ${
                        drawMode === "trend"
                          ? "border-zinc-700 dark:border-zinc-300 text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-700"
                          : "border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Trend Line
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawMode((m) => (m === "measure" ? "none" : "measure"));
                        setPendingMeasureStart(null);
                        setPendingMeasureDrawingId(null);
                        pendingMeasureStartRef.current = null;
                        pendingMeasureDrawingIdRef.current = null;
                        setPendingMeasureCursorPoint(null);
                      }}
                      className={`px-2 py-0.5 rounded border text-ws-label ${
                        drawMode === "measure"
                          ? "border-zinc-700 dark:border-zinc-300 text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-700"
                          : "border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                    >
                      Measure
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawings([]);
                        setPendingTrendStart(null);
                        setPendingTrendDrawingId(null);
                        setPendingMeasureStart(null);
                        setPendingMeasureDrawingId(null);
                        pendingMeasureStartRef.current = null;
                        pendingMeasureDrawingIdRef.current = null;
                        setPendingMeasureCursorPoint(null);
                        setDrawMode("none");
                      }}
                      className="px-2 py-0.5 rounded border text-ws-label border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      Clear All
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawings((prev) => prev.slice(0, -1))}
                      className="px-2 py-0.5 rounded border text-ws-label border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      disabled={!selectedDrawing}
                      onClick={() => {
                        setDrawings((prev) => prev.filter((d) => d.id !== selectedDrawingId));
                        setSelectedDrawingId(null);
                      }}
                      className="px-2 py-0.5 rounded border text-ws-label border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50"
                    >
                      Delete Selected
                    </button>
                  </div>
                  <label className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-zinc-600 dark:text-zinc-300">Snap to OHLC</span>
                    <input
                      type="checkbox"
                      checked={snapToOhlc}
                      onChange={(e) => setSnapToOhlc(e.target.checked)}
                    />
                  </label>
                  <div className="text-ws-label text-zinc-500 dark:text-zinc-400 mb-2">
                    {drawMode === "none"
                      ? "Select a draw tool, then click on chart."
                      : drawMode === "ray"
                      ? "Ray mode: click once to place."
                      : drawMode === "measure"
                      ? pendingMeasureStart
                        ? "Measure: click second point."
                        : "Measure: click first point (or SHIFT+click)."
                      : pendingTrendStart
                      ? "Trend mode: click second point."
                      : "Trend mode: click first point."}
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Line color</span>
                    <input
                      type="color"
                      value={drawTemplate === "custom" ? customStyle.color : activeDrawingStyle.color}
                      onChange={(e) => {
                        if (drawTemplate !== "custom") return;
                        setCustomStyle((s) => ({ ...s, color: e.target.value }));
                      }}
                      disabled={drawTemplate !== "custom"}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent disabled:opacity-50"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Line width</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={drawTemplate === "custom" ? customStyle.lineWidth : activeDrawingStyle.lineWidth}
                      onChange={(e) => {
                        if (drawTemplate !== "custom") return;
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setCustomStyle((s) => ({ ...s, lineWidth: Math.max(1, Math.min(6, n)) }));
                      }}
                      disabled={drawTemplate !== "custom"}
                      className="w-14 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Line style</span>
                    <select
                      value={drawTemplate === "custom" ? customStyle.lineStyle : activeDrawingStyle.lineStyle}
                      onChange={(e) => {
                        if (drawTemplate !== "custom") return;
                        setCustomStyle((s) => ({ ...s, lineStyle: Number(e.target.value) as 0 | 1 | 2 }));
                      }}
                      disabled={drawTemplate !== "custom"}
                      className="w-24 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                    >
                      <option value={0}>Solid</option>
                      <option value={2}>Dashed</option>
                      <option value={1}>Dotted</option>
                    </select>
                  </div>
                  <label className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Ray label</span>
                    <input
                      type="checkbox"
                      checked={drawTemplate === "custom" ? customStyle.showLabel : activeDrawingStyle.showLabel}
                      onChange={(e) => {
                        if (drawTemplate !== "custom") return;
                        setCustomStyle((s) => ({ ...s, showLabel: e.target.checked }));
                      }}
                      disabled={drawTemplate !== "custom"}
                    />
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-600 dark:text-zinc-300">Label text</span>
                    <input
                      type="text"
                      value={drawTemplate === "custom" ? customStyle.label : activeDrawingStyle.label}
                      onChange={(e) => {
                        if (drawTemplate !== "custom") return;
                        setCustomStyle((s) => ({ ...s, label: e.target.value }));
                      }}
                      disabled={drawTemplate !== "custom"}
                      className="w-28 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                    />
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Volume & grid</div>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showVolume}
                      onChange={(e) => handleUpdateSettings({ showVolume: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">Show volume</span>
                  </label>
                  <label className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={settings.showVertGrid}
                      onChange={(e) => handleUpdateSettings({ showVertGrid: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">Vertical grid</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.showHorzGrid}
                      onChange={(e) => handleUpdateSettings({ showHorzGrid: e.target.checked })}
                    />
                    <span className="text-zinc-600 dark:text-zinc-300">Horizontal grid</span>
                  </label>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">Colors</div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Background</span>
                    <input
                      type="color"
                      value={settings.backgroundColor}
                      onChange={(e) => handleUpdateSettings({ backgroundColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Up candle body</span>
                    <input
                      type="color"
                      value={settings.candleUpBodyColor}
                      onChange={(e) => handleUpdateSettings({ candleUpBodyColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Down candle body</span>
                    <input
                      type="color"
                      value={settings.candleDownBodyColor}
                      onChange={(e) => handleUpdateSettings({ candleDownBodyColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Up outline</span>
                    <input
                      type="color"
                      value={settings.candleUpBorderColor}
                      onChange={(e) => handleUpdateSettings({ candleUpBorderColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Down outline</span>
                    <input
                      type="color"
                      value={settings.candleDownBorderColor}
                      onChange={(e) => handleUpdateSettings({ candleDownBorderColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-zinc-600 dark:text-zinc-300">Up wick</span>
                    <input
                      type="color"
                      value={settings.candleUpWickColor}
                      onChange={(e) => handleUpdateSettings({ candleUpWickColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-600 dark:text-zinc-300">Down wick</span>
                    <input
                      type="color"
                      value={settings.candleDownWickColor}
                      onChange={(e) => handleUpdateSettings({ candleDownWickColor: e.target.value })}
                      className="w-10 h-5 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => applyThemePalette(LIGHT_CHART_THEME)}
                    className="text-ws-label text-zinc-500 dark:text-zinc-400 hover:underline"
                  >
                    Light theme
                  </button>
                  <button
                    type="button"
                    onClick={() => applyThemePalette(DEFAULT_CHART_SETTINGS)}
                    className="text-ws-label text-zinc-500 dark:text-zinc-400 hover:underline"
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    {showWatchlistModal && onWatchlistMembershipSave && watchlistPickerLists != null && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.85)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowWatchlistModal(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-watchlist-modal-title"
      >
        <div
          className="rounded-lg shadow-xl w-full max-w-md border border-zinc-200 dark:border-[var(--ws-border)] p-4 bg-white dark:bg-[var(--ws-bg3)]"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="chart-watchlist-modal-title" className="text-sm font-semibold mb-3 dark:text-[var(--ws-text)]">
            Lists for {symbol.toUpperCase()}
          </h2>
          {watchlistPickerLists.length === 0 ? (
            <p className="text-xs text-zinc-600 dark:text-[var(--ws-text-dim)] mb-3">
              Create a list in the Lists section, then return here.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[50vh] overflow-y-auto mb-4">
              {watchlistPickerLists.map((wl) => (
                <li key={wl.id} className="flex items-center gap-2">
                  <input
                    id={`wl-cb-${wl.id}`}
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-400"
                    checked={!!wlDraft[wl.id]}
                    onChange={(e) => setWlDraft((prev) => ({ ...prev, [wl.id]: e.target.checked }))}
                  />
                  <label htmlFor={`wl-cb-${wl.id}`} className="text-sm cursor-pointer dark:text-[var(--ws-text)]">
                    {wl.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-[var(--ws-text-dim)]"
              onClick={() => setShowWatchlistModal(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded bg-cyan-600 text-white hover:bg-cyan-500"
              onClick={() => {
                const changes: { id: string; add: boolean }[] = [];
                for (const w of watchlistPickerLists) {
                  const want = !!wlDraft[w.id];
                  if (want !== w.hasSymbol) changes.push({ id: w.id, add: want });
                }
                onWatchlistMembershipSave(changes);
                setShowWatchlistModal(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )}
    {showFlagPicker &&
      onFlagChange &&
      chartFlagAnchorRect &&
      typeof document !== "undefined" &&
      createPortal(
        <div
          data-chart-flag-picker
          className="fixed z-[10000] rounded border shadow-lg p-2 flex items-center gap-2 bg-white dark:bg-[var(--ws-bg3)] border-zinc-200 dark:border-[var(--ws-border)] whitespace-nowrap"
          style={computeFlagStripPosition(chartFlagAnchorRect)}
        >
          <button
            type="button"
            onClick={() => {
              onFlagChange(null);
              setShowFlagPicker(false);
            }}
            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 bg-zinc-600 flex items-center justify-center text-ws-caption text-zinc-300 ${!stockFlag ? "border-white" : "border-transparent"}`}
            title="No flag (0)"
          >
            ✕
          </button>
          {FLAG_PICKER_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onFlagChange(c);
                setShowFlagPicker(false);
              }}
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${stockFlag === c ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: CHART_FLAG_HEX[c], borderColor: CHART_FLAG_HEX[c] }}
              title={`${c.charAt(0).toUpperCase() + c.slice(1)} (${FLAG_PICKER_ORDER.indexOf(c) + 1})`}
            />
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

export default memo(StockChart);
