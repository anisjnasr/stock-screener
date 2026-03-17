"use client";

/**
 * Stock chart using TradingView Lightweight Charts
 * (https://www.tradingview.com/lightweight-charts/)
 */
import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import { DEFAULT_CHART_SETTINGS, loadChartSettings, saveChartSettings, type ChartSettings, type ChartSeriesType } from "@/lib/chart-settings";

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartTimeframe = "daily" | "weekly" | "monthly";

type StockChartProps = {
  symbol: string;
  data: Candle[] | null;
  loading?: boolean;
  timeframe?: ChartTimeframe;
  onTimeframeChange?: (tf: ChartTimeframe) => void;
};

type DrawMode = "none" | "ray" | "trend";
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

type ChartDrawing = HorizontalRayDrawing | TrendLineDrawing;

type DragHandle = "ray-anchor" | "trend-start" | "trend-end";
type DragState = {
  drawingId: string;
  handle: DragHandle;
};

function dateToTime(dateStr: string): UTCTimestamp {
  return (new Date(dateStr + "T12:00:00Z").getTime() / 1000) as UTCTimestamp;
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
    return dateToTime(toIsoDate(t));
  }
  return null;
}

function getDrawingStorageKey(symbol: string, timeframe: ChartTimeframe): string {
  return `stock-stalker:chart-drawings:v1:${symbol.toUpperCase()}:${timeframe}`;
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
    lineWidth: 2,
    lineStyle: 0,
    showLabel: true,
    label: "Weekly",
  },
  daily: {
    color: "#d946ef",
    lineWidth: 2,
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

export default function StockChart({
  symbol,
  data,
  loading,
  timeframe = "daily",
  onTimeframeChange,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
    lineWidth: 2,
    lineStyle: 0,
    showLabel: false,
    label: "",
  });
  const [pendingTrendStart, setPendingTrendStart] = useState<{ time: UTCTimestamp; price: number } | null>(
    null
  );
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showSelectedDrawingSettings, setShowSelectedDrawingSettings] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [snapToOhlc, setSnapToOhlc] = useState(true);

  const chronological = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.slice().sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const seriesData = useMemo(() => {
    if (chronological.length === 0) return [];
    return chronological.map((d) => ({
      time: dateToTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
  }, [chronological]);

  const timeToCandle = useMemo(() => {
    const m = new Map<number, Candle>();
    chronological.forEach((c) => m.set(dateToTime(c.date), c));
    return m;
  }, [chronological]);

  const sortedTimes = useMemo(() => seriesData.map((s) => Number(s.time)).sort((a, b) => a - b), [seriesData]);

  const volumeData = useMemo(() => {
    if (chronological.length === 0) return [];
    const upColor = settings.candleUpBodyColor;
    const downColor = settings.candleDownBodyColor;
    return chronological.map((d) => ({
      time: dateToTime(d.date),
      value: d.volume,
      color: d.close >= d.open ? upColor : downColor,
    }));
  }, [chronological, settings]);

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
    const key = getDrawingStorageKey(symbol, timeframe);
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
    setPendingTrendStart(null);
    setDrawMode("none");
    setSelectedDrawingId(null);
    setDragState(null);
  }, [symbol, timeframe]);

  useEffect(() => {
    const key = getDrawingStorageKey(symbol, timeframe);
    try {
      localStorage.setItem(key, JSON.stringify(drawings));
    } catch {
      // Ignore localStorage write errors.
    }
  }, [symbol, timeframe, drawings]);

  useEffect(() => {
    if (!containerRef.current || seriesData.length === 0) return;

    const el = containerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: settings.backgroundColor },
        textColor: "#D9D9D9",
        panes: {
          separatorColor: "rgba(113,113,122,0.4)",
          separatorHoverColor: "rgba(113,113,122,0.6)",
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
        secondsVisible: false,
        borderColor: "rgba(113,113,122,0.4)",
      },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: "rgba(113,113,122,0.5)",
        scaleMargins: { top: 0.1, bottom: 0.02 },
        minimumWidth: 80,
        entireTextOnly: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(140,140,140,0.28)",
          labelBackgroundColor: "rgba(140,140,140,0.28)",
        },
        horzLine: {
          visible: false,
          labelVisible: true,
          color: "rgba(140,140,140,0.28)",
          labelBackgroundColor: "#22c55e",
        },
      },
    });

    // Overlays: EMAs
    if (timeframe === "daily") {
      if (settings.showEma50 && ema50Data.length > 0) {
        chart
          .addSeries(LineSeries, {
            color: "#ef4444",
            lineWidth: 1,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
          .setData(ema50Data);
      }
      if (settings.showEma200 && ema200Data.length > 0) {
        chart
          .addSeries(LineSeries, {
            color: "#22c55e",
            lineWidth: 1,
            priceScaleId: "right",
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          })
          .setData(ema200Data);
      }
    } else if (timeframe === "weekly" && settings.showEma40Weekly && ema40Data.length > 0) {
      chart
        .addSeries(LineSeries, {
          color: "#22c55e",
          lineWidth: 1,
          priceScaleId: "right",
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
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

    const drawingStepSeconds: number =
      timeframe === "monthly" ? 60 * 60 * 24 * 30 : timeframe === "weekly" ? 60 * 60 * 24 * 7 : 60 * 60 * 24;
    const lastSeriesTime = seriesData[seriesData.length - 1]?.time ?? (dateToTime("1970-01-01") as UTCTimestamp);
    const farRightTime = (Number(lastSeriesTime) + drawingStepSeconds * 360) as UTCTimestamp;

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
      });
      if (d.kind === "ray") {
        lineSeries.setData([
          { time: d.startTime, value: d.price },
          { time: farRightTime, value: d.price },
        ]);
        if (d.style.showLabel && d.style.label.trim()) {
          lineSeries.createPriceLine({
            price: d.price,
            color: d.style.color,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: d.style.label.trim(),
          });
        }
      } else {
        const first = d.startTime <= d.endTime ? { t: d.startTime, p: d.startPrice } : { t: d.endTime, p: d.endPrice };
        const second = d.startTime <= d.endTime ? { t: d.endTime, p: d.endPrice } : { t: d.startTime, p: d.startPrice };
        lineSeries.setData([
          { time: first.t, value: first.p },
          { time: second.t, value: second.p },
        ]);
      }
    }
    const unsubCrosshair = chart.subscribeCrosshairMove((param) => {
      if (param.time != null) {
        const candle = timeToCandle.get(param.time as number);
        setCrosshairCandle(candle ?? null);
      } else {
        setCrosshairCandle(null);
      }
    });

    const onChartClick = (param: {
      time?: unknown;
      point?: { x: number; y: number };
    }) => {
      if (!param.point) return;
      if (drawMode === "none") {
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
      const rawTime = chart.timeScale().coordinateToTime(param.point.x);
      const timeRaw = normalizeTime(rawTime);
      const price = mainSeries.coordinateToPrice(param.point.y);
      if (timeRaw == null || price == null || !Number.isFinite(price)) return;
      const snapped = snapPointToCandle(timeRaw, price);

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
        return;
      }

      if (pendingTrendStart == null) {
        setPendingTrendStart({ time: snapped.time, price: snapped.price });
        return;
      }

      const trend: TrendLineDrawing = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind: "trend",
        startTime: pendingTrendStart.time,
        startPrice: pendingTrendStart.price,
        endTime: snapped.time,
        endPrice: snapped.price,
        style: activeDrawingStyle,
      };
      setDrawings((prev) => [...prev, trend]);
      setSelectedDrawingId(trend.id);
      setPendingTrendStart(null);
      setDrawMode("none");
    };
    chart.subscribeClick(onChartClick);

    if (settings.showVolume && volumeData.length > 0) {
      chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          priceScaleId: "",
        },
        1
      ).setData(volumeData);
      const panes = chart.panes();
      if (panes[0]) panes[0].setStretchFactor(7);
      if (panes[1]) panes[1].setStretchFactor(1);
    }

    // Default zoom: last 12 months of candles, with 3 bars space from current bar to price axis
    const barsIn12Months = timeframe === "daily" ? 252 : timeframe === "weekly" ? 52 : 12;
    const barCount = seriesData.length;
    const visibleFrom = Math.max(0, barCount - barsIn12Months);
    const visibleTo = barCount - 1;
    chart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: visibleTo + 3 });

    try {
      const rightScale = chart.priceScale("right");
      if (rightScale) rightScale.applyOptions({ visible: true, borderVisible: true });
    } catch {
      /* ignore */
    }

    chartRef.current = chart;

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
      try {
        (unsubCrosshair as (() => void) | undefined)?.();
      } catch {
        /* ignore */
      }
      try {
        chart.unsubscribeClick(onChartClick as never);
      } catch {
        /* ignore */
      }
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
    };
  }, [
    symbol,
    timeframe,
    chronological,
    seriesData,
    volumeData,
    ema50Data,
    ema200Data,
    ema40Data,
    settings,
    drawings,
    drawMode,
    activeDrawingStyle,
    pendingTrendStart,
    snapPointToCandle,
    selectedDrawingId,
    timeToCandle,
  ]);

  const timeframes: ChartTimeframe[] = ["daily", "weekly", "monthly"];
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

  useEffect(() => {
    if (selectedDrawingId && !drawings.some((d) => d.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
    }
  }, [drawings, selectedDrawingId]);

  useEffect(() => {
    if (!selectedDrawing) setShowSelectedDrawingSettings(false);
  }, [selectedDrawing]);

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

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-zinc-900">
      <div className="px-2 py-1 border-b border-zinc-100 dark:border-zinc-800 shrink-0 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {onTimeframeChange &&
            timeframes.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                  timeframe === tf
                    ? "bg-zinc-700 dark:bg-zinc-600 text-white"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {tf.charAt(0).toUpperCase() + tf.slice(1)}
              </button>
            ))}
          <button
            type="button"
            onClick={() => {
              setDrawMode((m) => (m === "ray" ? "none" : "ray"));
              setPendingTrendStart(null);
            }}
            className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
              drawMode === "ray"
                ? "bg-amber-500 text-zinc-900"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
            }}
            className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
              drawMode === "trend"
                ? "bg-violet-500 text-white"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
            title="Draw trend line"
          >
            Trend
          </button>
          <button
            type="button"
            onClick={() => {
              setDrawings((prev) => prev.slice(0, -1));
              if (drawings.length <= 1) setSelectedDrawingId(null);
            }}
            className="px-2 py-0.5 text-xs font-medium rounded text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Undo last drawing"
          >
            Undo
          </button>
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">TradingView Lightweight Charts</span>
      </div>
      {loading ? (
        <div className="flex-1 min-h-[300px] flex items-center justify-center">
          <p className="text-zinc-500 dark:text-zinc-400">Loading chart…</p>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex-1 min-h-[300px] flex items-center justify-center">
          <p className="text-zinc-500 dark:text-zinc-400">No chart data</p>
        </div>
      ) : (
        <div className="relative w-full flex-1 min-h-0">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute top-3 left-3 z-[5] pointer-events-none select-none text-zinc-300/45 dark:text-zinc-600/45 text-3xl font-semibold font-mono tracking-wide">
            {symbol.toUpperCase()}
          </div>
          {crosshairCandle && (
            <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-[#2A2D31]/95 border border-zinc-600 text-[#D9D9D9] text-xs font-mono flex items-center gap-3">
              <span>O {crosshairCandle.open.toFixed(2)}</span>
              <span>H {crosshairCandle.high.toFixed(2)}</span>
              <span>L {crosshairCandle.low.toFixed(2)}</span>
              <span>C {crosshairCandle.close.toFixed(2)}</span>
              <span>V {fmtVol(crosshairCandle.volume)}</span>
            </div>
          )}
          {selectedHandles.map((h) => (
            <button
              key={h.key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setDragState({ drawingId: selectedDrawingId as string, handle: h.handle });
              }}
              className="absolute z-20 h-3 w-3 rounded-full border border-white bg-cyan-400 shadow"
              style={{
                left: `${h.point.x}px`,
                top: `${h.point.y}px`,
                transform: "translate(-50%, -50%)",
              }}
              title="Drag to edit"
              aria-label="Drag drawing handle"
            />
          ))}
          {selectedDrawing && (
            <div className="absolute top-2 right-12 z-20 flex items-center gap-1">
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
                        className={`px-2 py-0.5 rounded border text-[11px] ${
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
                        className={`px-2 py-0.5 rounded border text-[11px] ${
                          drawTemplate === t
                            ? "border-zinc-700 dark:border-zinc-300 text-zinc-900 dark:text-zinc-50 bg-zinc-100 dark:bg-zinc-700"
                            : "border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {t === "weekly" ? "Weekly" : t === "daily" ? "Daily" : "Custom"}
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-2">
                    Weekly template uses yellow/orange. Daily uses purple/magenta.
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawMode((m) => (m === "ray" ? "none" : "ray"));
                        setPendingTrendStart(null);
                      }}
                      className={`px-2 py-0.5 rounded border text-[11px] ${
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
                      }}
                      className={`px-2 py-0.5 rounded border text-[11px] ${
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
                        setDrawings([]);
                        setPendingTrendStart(null);
                        setDrawMode("none");
                      }}
                      className="px-2 py-0.5 rounded border text-[11px] border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      Clear All
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawings((prev) => prev.slice(0, -1))}
                      className="px-2 py-0.5 rounded border text-[11px] border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
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
                      className="px-2 py-0.5 rounded border text-[11px] border-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50"
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
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-2">
                    {drawMode === "none"
                      ? "Select a draw tool, then click on chart."
                      : drawMode === "ray"
                      ? "Ray mode: click once to place."
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
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setSettings(DEFAULT_CHART_SETTINGS);
                      saveChartSettings(DEFAULT_CHART_SETTINGS);
                    }}
                    className="text-[11px] text-zinc-500 dark:text-zinc-400 hover:underline"
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
  );
}
