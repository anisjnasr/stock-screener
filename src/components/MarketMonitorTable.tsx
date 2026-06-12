import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { MarketMonitorRow, MarketMonitorApiPayload } from "@/app/api/market-monitor/route";
import type { MarketMonitorMetricKey } from "@/lib/screener-db-native";
import MarketMonitorConstituentsModal, {
  type MarketMonitorListCreatedInfo,
} from "@/components/MarketMonitorConstituentsModal";
import { industryThemePillClass } from "@/lib/premarket/industry-theme-pill-class";
import { normalizeIndustryDisplayName } from "@/lib/text-format";

const MARKET_MONITOR_FETCH_VERSION = "7x-atr-v1";

/** Lets `height:100%` children fill the row’s tallest cell (`td { height: 1px }` table layout trick). */
const MM_BODY_TD = "p-0 align-middle h-px max-h-none";

/** Inner fill: stretch to row height and vertically center one-line values. */
const MM_CELL_FILL =
  "flex h-full min-h-0 w-full box-border items-center justify-center py-0.5";

const MM_MODAL_TITLES: Record<MarketMonitorMetricKey, string> = {
  up4pct: "4% Up",
  down4pct: "4% Down",
  up25pct_qtr: "Up 25% Q",
  down25pct_qtr: "Down 25% Q",
  up25pct_month: "Up 25% M",
  down25pct_month: "Down 25% M",
  up50pct_month: "Up 50% M",
  down50pct_month: "Down 50% M",
  nnh52w_highs: "52W Highs",
  nnh52w_lows: "52W Lows",
  count_7x_atr_50d: "7× ATR",
  count_episodic_pivot: "EP",
  universe_above_50d: ">50D",
  universe_above_200d: ">200D",
};

/** Earliest session date for which primary-breadth indicator counts are drillable (ISO YYYY-MM-DD). */
const MM_INDICATOR_DRILLDOWN_MIN_DATE = "2026-03-26";

function isMmIndicatorDrilldownDate(rowDate: string): boolean {
  return rowDate.trim() >= MM_INDICATOR_DRILLDOWN_MIN_DATE;
}

/** New signal columns use full indicator history; primary breadth keeps the rollout min date. */
function isMmMetricDrilldownAllowed(metric: MarketMonitorMetricKey, rowDate: string): boolean {
  if (metric === "count_7x_atr_50d" || metric === "count_episodic_pivot") return true;
  return isMmIndicatorDrilldownDate(rowDate);
}


function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toLocaleString();
}

function fmtRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toFixed(2);
}


function getRatioCellClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  if (value < 0.5) return "ws-mm-heat-red-very";
  if (value < 1) return "ws-mm-heat-red-strong";
  if (value > 2) return "ws-mm-heat-green-very";
  if (value > 1) return "ws-mm-heat-green-strong";
  return "";
}

function formatDateDmy(input: string): string {
  const d = new Date(input.trim());
  if (Number.isNaN(d.getTime())) return input;
  const day = d.getDate().toString().padStart(2, "0");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/** `ch` widths tuned for locale-formatted integers, ratios, and breadth %. */
const MM_TAB_DATE_CH = 11;
const MM_TAB_MIN_INT_CH = 2;
const MM_TAB_MIN_RATIO_CH = 4;

const MM_TABLE_HEADERS_AFTER_DATE = [
  "Up %",
  "Down %",
  "5D Ratio",
  "10D Ratio",
  "Up 25% (Q)",
  "Down 25% (Q)",
  "Up 25% (M)",
  "Down 25% (M)",
  "Up 50% (M)",
  "Down 50% (M)",
  "52W Highs",
  "52W Lows",
  "7× ATR",
  "EP",
] as const;

/** Column subheaders for top industry cells (aligned with Up %, Up 25% Q/M, Up 50% M breadth metrics). */
const MM_TOP_INDUSTRY_HEADERS = ["Up %", "Up 25% (Q)", "Up 25% (M)", "Up 50% (M)"] as const;

const MM_COL_WIDTH_LS_KEY = "stockstalker-mm-col-widths-v2";
const MM_COL_MIN_W = 40;
const MM_COL_MAX_W = 960;

/** Logical column IDs for resizing (colgroup / second header row). */
type MmColKey =
  | "date"
  | "top0"
  | "top1"
  | "top2"
  | "top3"
  | "b0"
  | "b1"
  | "b2"
  | "b3"
  | "b4"
  | "b5"
  | "b6"
  | "b7"
  | "b8"
  | "b9"
  | "b10"
  | "b11"
  | "b12"
  | "b13"
  | "universe";

type MmColWidthMap = Partial<Record<MmColKey, number>>;

/** Approximation for `ch` → px used when autofitting breadth columns alongside header text. */
const MM_CH_APPROX_PX = 7.25;

/** Canvas font strings approximating table header vs body typography. */
const MM_MEASURE_FONT_HEADER = '700 12px ui-sans-serif, system-ui, sans-serif';
const MM_MEASURE_FONT_BODY = '400 12px ui-sans-serif, system-ui, sans-serif';
const MM_MEASURE_FONT_PILL = '600 11px ui-sans-serif, system-ui, sans-serif';

const MM_AUTOFIT_HDR_PAD_PX = 18;
const MM_AUTOFIT_BODY_PAD_PX = 14;
const MM_AUTOFIT_TOP_PILL_PAD_PX = 28;

/** Width keys must stay aligned with {@link MM_TABLE_HEADERS_AFTER_DATE} order. */
const MM_AUTOFIT_BREADTH = [
  { colKey: "b0" as const, cwKey: "up4pct" as const, text: (r: MarketMonitorRow) => fmtInt(r.up4pct) },
  { colKey: "b1" as const, cwKey: "down4pct" as const, text: (r: MarketMonitorRow) => fmtInt(r.down4pct) },
  { colKey: "b2" as const, cwKey: "ratio5d" as const, text: (r: MarketMonitorRow) => fmtRatio(r.ratio5d) },
  { colKey: "b3" as const, cwKey: "ratio10d" as const, text: (r: MarketMonitorRow) => fmtRatio(r.ratio10d) },
  { colKey: "b4" as const, cwKey: "up25pctQtr" as const, text: (r: MarketMonitorRow) => fmtInt(r.up25pct_qtr) },
  { colKey: "b5" as const, cwKey: "down25pctQtr" as const, text: (r: MarketMonitorRow) => fmtInt(r.down25pct_qtr) },
  { colKey: "b6" as const, cwKey: "up25pctMonth" as const, text: (r: MarketMonitorRow) => fmtInt(r.up25pct_month) },
  { colKey: "b7" as const, cwKey: "down25pctMonth" as const, text: (r: MarketMonitorRow) => fmtInt(r.down25pct_month) },
  { colKey: "b8" as const, cwKey: "up50pctMonth" as const, text: (r: MarketMonitorRow) => fmtInt(r.up50pct_month) },
  { colKey: "b9" as const, cwKey: "down50pctMonth" as const, text: (r: MarketMonitorRow) => fmtInt(r.down50pct_month) },
  { colKey: "b10" as const, cwKey: "nnh52wHighs" as const, text: (r: MarketMonitorRow) => fmtInt(r.nnh52wHighs ?? 0) },
  { colKey: "b11" as const, cwKey: "nnh52wLows" as const, text: (r: MarketMonitorRow) => fmtInt(r.nnh52wLows ?? 0) },
  { colKey: "b12" as const, cwKey: "count7xAtr50d" as const, text: (r: MarketMonitorRow) => fmtInt(r.count7xAtr50d ?? 0) },
  { colKey: "b13" as const, cwKey: "countEpisodicPivot" as const, text: (r: MarketMonitorRow) => fmtInt(r.countEpisodicPivot ?? 0) },
] as const;

function loadMmColWidths(): MmColWidthMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MM_COL_WIDTH_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: MmColWidthMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k !== "string" || typeof v !== "number" || !Number.isFinite(v)) continue;
      out[k as MmColKey] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Keep module-level measuring canvas outside React render. */
let mmMeasureCtx: CanvasRenderingContext2D | null | undefined;

function mmTextWidthPx(text: string, font: string): number {
  if (typeof document === "undefined") return text.length * 7;
  if (mmMeasureCtx === undefined) {
    const c = document.createElement("canvas");
    mmMeasureCtx = c.getContext("2d");
  }
  if (!mmMeasureCtx) return text.length * 7;
  mmMeasureCtx.font = font;
  return mmMeasureCtx.measureText(text).width;
}

function clampMmColW(px: number): number {
  return Math.round(Math.min(MM_COL_MAX_W, Math.max(MM_COL_MIN_W, px)));
}

function mmColStyle(px: number | undefined): CSSProperties | undefined {
  if (px == null) return undefined;
  return { width: px, minWidth: px };
}

function mmTopColKey(i: 0 | 1 | 2 | 3): MmColKey {
  return `top${i}` as MmColKey;
}

function maxFormattedCh(rows: MarketMonitorRow[], values: (row: MarketMonitorRow) => string[], minCh: number): number {
  let max = minCh;
  for (const row of rows) {
    for (const value of values(row)) {
      max = Math.max(max, value.length);
    }
  }
  return max;
}

function MmTabularInner({
  widthCh,
  widthPx,
  children,
  className = "",
  textAlign = "right",
}: {
  widthCh: number;
  widthPx?: number;
  children: ReactNode;
  className?: string;
  textAlign?: "left" | "right";
}) {
  const sizingStyle: CSSProperties =
    widthPx != null
      ? { width: `${widthPx}px`, minWidth: `${widthPx}px`, boxSizing: "border-box" }
      : { width: `${widthCh}ch`, minWidth: `${widthCh}ch` };

  return (
    <span
      className={`inline-block text-right tabular-nums ${className}`.trim()}
      style={{ ...sizingStyle, textAlign }}
    >
      {children}
    </span>
  );
}

/** Invisible splitter on header cell edge: drag to resize, double‑click for auto‑fit width. */
function MmColResizeGrip({
  onPointerDown,
  onDoubleClick,
}: {
  onPointerDown: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onDoubleClick: (e: React.MouseEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-0 right-0 z-40 h-full w-[6px] translate-x-[4px] cursor-col-resize select-none touch-none"
      role="presentation"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDoubleClick(e);
      }}
    />
  );
}

function MmNumericCellCenter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${MM_CELL_FILL} ${className}`.trim()}>{children}</div>;
}

function MmDateCellLeft({ children }: { children: ReactNode }) {
  return <div className={`${MM_CELL_FILL} justify-start px-1`.trim()}>{children}</div>;
}

function MmIndustryPill({ industry, constrained = false }: { industry: string; constrained?: boolean }) {
  const label = normalizeIndustryDisplayName(industry);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-px font-semibold leading-tight ${industryThemePillClass(label)} ${
        constrained ? "min-w-0 max-w-full truncate" : "w-max max-w-none shrink-0 whitespace-nowrap"
      }`}
      style={{ fontSize: "var(--ws-fs-caption)" }}
      title={label}
    >
      {label}
    </span>
  );
}

function getTopIndustryValues(tops: MarketMonitorRow["topUpIndustries"]): (string | null)[] {
  const t = tops ?? {
    up4pct: null,
    up25pct_qtr: null,
    up25pct_month: null,
    up50pct_month: null,
  };
  return [t.up4pct, t.up25pct_qtr, t.up25pct_month, t.up50pct_month];
}

function MmTopIndustryBodyCell({ industry, widthPx }: { industry: string | null; widthPx?: number }) {
  const sizingStyle: CSSProperties | undefined =
    widthPx != null
      ? { width: widthPx, minWidth: widthPx, maxWidth: widthPx, boxSizing: "border-box" }
      : undefined;

  return (
    <div
      className="flex h-full min-h-0 items-center justify-start overflow-hidden py-0.5 pl-1.5 pr-1"
      style={sizingStyle}
    >
      {industry ? (
        <MmIndustryPill industry={industry} constrained={widthPx != null} />
      ) : (
        <span className="text-ws-caption" style={{ color: "var(--ws-text-vdim)" }}>
          —
        </span>
      )}
    </div>
  );
}

/** Up/down pairs (4%, Q, M): every row is green or red when up ≠ down; extreme fill when dominance is very lopsided. */
function getPairCellClassFull(up: number | null | undefined, down: number | null | undefined): string {
  const upVal = Number(up ?? 0);
  const downVal = Number(down ?? 0);
  if (!Number.isFinite(upVal) || !Number.isFinite(downVal)) return "";
  if (upVal === downVal) return "";
  const bullish = upVal > downVal;
  const winner = bullish ? upVal : downVal;
  const total = upVal + downVal;
  if (total <= 0) return "";

  const dominance = winner / total;
  if (dominance >= 0.78) return bullish ? "ws-mm-heat-green-very" : "ws-mm-heat-red-very";
  return bullish ? "ws-mm-heat-green-strong" : "ws-mm-heat-red-strong";
}

export default function MarketMonitorTable({
  onSymbolSelect,
  onWatchlistListCreated,
}: {
  onSymbolSelect?: (sym: string) => void;
  onWatchlistListCreated?: (info: MarketMonitorListCreatedInfo) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableRowsToShow, setTableRowsToShow] = useState<MarketMonitorRow[]>([]);
  const [mmModal, setMmModal] = useState<{ date: string; metric: MarketMonitorMetricKey } | null>(null);
  const [staleBanner, setStaleBanner] = useState<string | null>(null);
  const [topIndustriesExpanded, setTopIndustriesExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-monitor?v=${MARKET_MONITOR_FETCH_VERSION}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<MarketMonitorApiPayload>)
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setStaleBanner(null);
        } else {
          setError(null);
          const all = json.rows ?? [];
          if (json.stale && (json.message || json.dataAsOf)) {
            setStaleBanner(json.message ?? `Data through ${json.dataAsOf ?? "unknown"} — refresh precompute when ready.`);
          } else {
            setStaleBanner(null);
          }
          if (all.length > 0) {
            const latest = new Date(`${all[0].date}T00:00:00Z`);
            const cutoff = new Date(latest);
            cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
            const cutoffStr = cutoff.toISOString().slice(0, 10);
            setTableRowsToShow(all.filter((r) => r.date >= cutoffStr));
          } else {
            setTableRowsToShow([]);
            if (json.message && !json.error) {
              setStaleBanner(json.message);
            }
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load market monitor");
        setStaleBanner(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const columnValueWidths = useMemo(
    () => {
      const intWidth = (value: (row: MarketMonitorRow) => number | null | undefined) =>
        maxFormattedCh(tableRowsToShow, (row) => [fmtInt(value(row))], MM_TAB_MIN_INT_CH);
      const ratioWidth = (value: (row: MarketMonitorRow) => number | null | undefined) =>
        maxFormattedCh(tableRowsToShow, (row) => [fmtRatio(value(row))], MM_TAB_MIN_RATIO_CH);

      return {
        up4pct: intWidth((row) => row.up4pct),
        down4pct: intWidth((row) => row.down4pct),
        ratio5d: ratioWidth((row) => row.ratio5d),
        ratio10d: ratioWidth((row) => row.ratio10d),
        up25pctQtr: intWidth((row) => row.up25pct_qtr),
        down25pctQtr: intWidth((row) => row.down25pct_qtr),
        up25pctMonth: intWidth((row) => row.up25pct_month),
        down25pctMonth: intWidth((row) => row.down25pct_month),
        up50pctMonth: intWidth((row) => row.up50pct_month),
        down50pctMonth: intWidth((row) => row.down50pct_month),
        nnh52wHighs: intWidth((row) => row.nnh52wHighs ?? 0),
        nnh52wLows: intWidth((row) => row.nnh52wLows ?? 0),
        count7xAtr50d: intWidth((row) => row.count7xAtr50d ?? 0),
        countEpisodicPivot: intWidth((row) => row.countEpisodicPivot ?? 0),
        universe: intWidth((row) => row.universe),
      };
    },
    [tableRowsToShow]
  );

  const dragMmColRef = useRef<{ key: MmColKey; startX: number; startW: number } | null>(null);
  const [colWidthsPx, setColWidthsPx] = useState<MmColWidthMap>(() => loadMmColWidths());
  const colWidthsPxRef = useRef<MmColWidthMap | null>(null);

  useLayoutEffect(() => {
    colWidthsPxRef.current = colWidthsPx;
  }, [colWidthsPx]);

  const mmFitColPx = useCallback(
    (key: MmColKey): number => {
      if (key === "date") {
        let wPx = mmTextWidthPx("Date", MM_MEASURE_FONT_HEADER) + MM_AUTOFIT_HDR_PAD_PX;
        for (const row of tableRowsToShow) {
          wPx = Math.max(
            wPx,
            mmTextWidthPx(formatDateDmy(row.date), MM_MEASURE_FONT_BODY) + MM_AUTOFIT_BODY_PAD_PX
          );
        }
        return clampMmColW(Math.ceil(wPx));
      }

      if (key === "universe") {
        let wPx =
          mmTextWidthPx("Stock Universe", MM_MEASURE_FONT_HEADER) + MM_AUTOFIT_HDR_PAD_PX;
        const chFloor =
          Math.ceil(columnValueWidths.universe * MM_CH_APPROX_PX + MM_AUTOFIT_BODY_PAD_PX);
        for (const row of tableRowsToShow) {
          wPx = Math.max(wPx, mmTextWidthPx(fmtInt(row.universe), MM_MEASURE_FONT_BODY) + MM_AUTOFIT_BODY_PAD_PX);
        }
        return clampMmColW(Math.ceil(Math.max(wPx, chFloor)));
      }

      const topMatch = /^top([0-3])$/.exec(key);
      if (topMatch) {
        const idx = Number(topMatch[1]) as 0 | 1 | 2 | 3;
        const hdr = MM_TOP_INDUSTRY_HEADERS[idx];
        let wPx = mmTextWidthPx(hdr, MM_MEASURE_FONT_HEADER) + MM_AUTOFIT_HDR_PAD_PX;
        for (const row of tableRowsToShow) {
          const v = getTopIndustryValues(row.topUpIndustries)[idx];
          if (!v) continue;
          const label = normalizeIndustryDisplayName(v);
          wPx = Math.max(
            wPx,
            mmTextWidthPx(label, MM_MEASURE_FONT_PILL) + MM_AUTOFIT_TOP_PILL_PAD_PX
          );
        }
        return clampMmColW(Math.ceil(Math.max(wPx, MM_COL_MIN_W)));
      }

      const bi = MM_AUTOFIT_BREADTH.findIndex((row) => row.colKey === key);
      if (bi !== -1) {
        const spec = MM_AUTOFIT_BREADTH[bi];
        const hdrLabel = MM_TABLE_HEADERS_AFTER_DATE[bi];
        let wPx =
          mmTextWidthPx(hdrLabel, MM_MEASURE_FONT_HEADER) + MM_AUTOFIT_HDR_PAD_PX;
        const cw =
          Math.ceil(columnValueWidths[spec.cwKey] * MM_CH_APPROX_PX + MM_AUTOFIT_BODY_PAD_PX);
        wPx = Math.max(wPx, cw);
        for (const row of tableRowsToShow) {
          const txt = spec.text(row);
          if (txt !== "") {
            wPx = Math.max(
              wPx,
              mmTextWidthPx(txt, MM_MEASURE_FONT_BODY) + MM_AUTOFIT_BODY_PAD_PX
            );
          }
        }
        return clampMmColW(Math.ceil(wPx));
      }

      return MM_COL_MIN_W;
    },
    [columnValueWidths, tableRowsToShow]
  );

  const mmApplyAutoFit = useCallback(
    (k: MmColKey) => {
      const w = mmFitColPx(k);
      setColWidthsPx((p) => ({ ...p, [k]: w }));
    },
    [mmFitColPx]
  );

  const mmBeginResize = useCallback((e: ReactPointerEvent<HTMLSpanElement>, k: MmColKey) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest("th");
    const rect = th?.getBoundingClientRect();
    if (!rect?.width || !Number.isFinite(rect.width)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      //
    }
    dragMmColRef.current = {
      key: k,
      startX: e.clientX,
      startW: colWidthsPxRef.current?.[k] ?? rect.width,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MM_COL_WIDTH_LS_KEY, JSON.stringify(colWidthsPx));
    } catch {
      //
    }
  }, [colWidthsPx]);

  useEffect(() => {
    function finishDrag() {
      if (!dragMmColRef.current) return;
      dragMmColRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    function onMove(ev: PointerEvent) {
      const d = dragMmColRef.current;
      if (!d) return;
      const next = clampMmColW(d.startW + (ev.clientX - d.startX));
      setColWidthsPx((prev) => {
        if (prev[d.key] === next) return prev;
        return { ...prev, [d.key]: next };
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      finishDrag();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "var(--ws-bg2)" }}>
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>Loading market monitor…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "var(--ws-bg2)" }}>
        <p className="text-sm" style={{ color: "var(--ws-red)" }}>{error}</p>
      </div>
    );
  }

  const openMmModal = (metric: MarketMonitorMetricKey, rowDate: string) => {
    if (!onSymbolSelect || !isMmMetricDrilldownAllowed(metric, rowDate)) return;
    setMmModal({ date: rowDate, metric });
  };

  const topIndustryColSpan = topIndustriesExpanded ? 4 : 1;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-visible px-1 sm:px-2 py-2 sm:py-3" style={{ background: "var(--ws-bg2)" }}>
      {mmModal && onSymbolSelect && (
        <MarketMonitorConstituentsModal
          open
          onClose={() => setMmModal(null)}
          date={mmModal.date}
          metric={mmModal.metric}
          indicatorTitle={MM_MODAL_TITLES[mmModal.metric]}
          onSymbolSelect={onSymbolSelect}
          onListCreated={onWatchlistListCreated}
        />
      )}
      {staleBanner && (
        <div
          className="mb-3 rounded-md border px-3 py-2 text-sm"
          style={{
            background: "var(--ws-amber-bg, rgba(245, 158, 11, 0.12))",
            borderColor: "var(--ws-amber, #d97706)",
            color: "var(--ws-text)",
          }}
          role="status"
        >
          {staleBanner}
        </div>
      )}
      <div
        className="mx-auto w-max max-w-none overflow-x-visible overflow-y-visible rounded-md shadow-sm"
        style={{ background: "var(--ws-bg)", border: "1px solid var(--ws-border)" }}
      >
        <table className="min-w-max whitespace-nowrap text-ws-body text-center border-collapse">
          <colgroup>
            <col style={mmColStyle(colWidthsPx.date)} />
            {(topIndustriesExpanded ? [0, 1, 2, 3] : [0]).map((ti) => {
              const tk = mmTopColKey(ti as 0 | 1 | 2 | 3);
              return <col key={tk} style={mmColStyle(colWidthsPx[tk])} />;
            })}
            {MM_AUTOFIT_BREADTH.map((row) => (
              <col key={row.colKey} style={mmColStyle(colWidthsPx[row.colKey])} />
            ))}
            <col style={mmColStyle(colWidthsPx.universe)} />
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-r"
                style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }}
              />
              <th
                scope="colgroup"
                colSpan={topIndustryColSpan}
                className="sticky top-0 z-10 relative border-b-2 border-r px-2 py-1.5 text-left text-ws-body font-bold tracking-wide"
                style={{ background: "var(--ws-bg2)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0">Top industries</span>
                  <button
                    type="button"
                    className="ws-focus-ring shrink-0 rounded px-1 py-px text-ws-caption font-semibold tabular-nums leading-none"
                    style={{
                      color: "var(--ws-cyan)",
                      border: "1px solid var(--ws-border)",
                      background: "var(--ws-bg3)",
                    }}
                    aria-expanded={topIndustriesExpanded}
                    aria-label={
                      topIndustriesExpanded
                        ? "Show only top industry for Up %"
                        : "Show top industries for Up %, Up 25% (Q), Up 25% (M), Up 50% (M)"
                    }
                    title={topIndustriesExpanded ? "Collapse to Up % only" : "Expand all four metrics"}
                    onClick={() => setTopIndustriesExpanded((e) => !e)}
                  >
                    {topIndustriesExpanded ? "−" : "+"}
                  </button>
                </div>
                {!topIndustriesExpanded ? (
                  <MmColResizeGrip
                    onPointerDown={(e) => mmBeginResize(e, "top0")}
                    onDoubleClick={() => mmApplyAutoFit("top0")}
                  />
                ) : null}
              </th>
              <th
                scope="colgroup"
                className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 text-center text-ws-body font-bold tracking-wide"
                colSpan={6}
                style={{ background: "var(--ws-mm-header-gold)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Primary Breadth Indicators
              </th>
              <th
                scope="colgroup"
                className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-l text-center text-ws-body font-bold tracking-wide"
                colSpan={8}
                style={{ background: "var(--ws-mm-header-green)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Secondary Breadth Indicators
              </th>
              <th scope="col" className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-l text-center" style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }} />
            </tr>
            <tr>
              <th
                scope="col"
                className="sticky top-[2.125rem] z-10 relative px-1 py-0.5 border-b border-l border-r text-left text-ws-body font-bold"
                style={{ background: "var(--ws-bg2)", borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
              >
                Date
                <MmColResizeGrip
                  onPointerDown={(e) => mmBeginResize(e, "date")}
                  onDoubleClick={() => mmApplyAutoFit("date")}
                />
              </th>
              {(topIndustriesExpanded ? MM_TOP_INDUSTRY_HEADERS : [MM_TOP_INDUSTRY_HEADERS[0]]).map((label, hi) => {
                const ti = (topIndustriesExpanded ? hi : 0) as 0 | 1 | 2 | 3;
                const ck = mmTopColKey(ti);
                return (
                  <th
                    key={`mm-top-ind-${hi}`}
                    scope="col"
                    className="sticky top-[2.125rem] z-10 relative overflow-hidden border-b border-r px-1 py-0.5 text-left text-ws-body font-bold"
                    style={{
                      background: "var(--ws-bg2)",
                      borderColor: "var(--ws-border)",
                      color: "var(--ws-text)",
                      ...mmColStyle(colWidthsPx[ck]),
                    }}
                  >
                    {label}
                    <MmColResizeGrip
                      onPointerDown={(e) => mmBeginResize(e, ck)}
                      onDoubleClick={() => mmApplyAutoFit(ck)}
                    />
                  </th>
                );
              })}
              {MM_TABLE_HEADERS_AFTER_DATE.map((label, i) => {
                const hdr =
                  i <= 5
                    ? { background: "var(--ws-mm-header-gold)", color: "var(--ws-mm-header-text)" }
                    : { background: "var(--ws-mm-header-green)", color: "var(--ws-mm-header-text)" };
                const edge = i === 6 ? " border-l border-r" : "";
                const bk = MM_AUTOFIT_BREADTH[i].colKey;
                return (
                  <th
                    scope="col"
                    key={label}
                    className={`sticky top-[2.125rem] z-10 relative px-1 py-0.5 border-b text-center text-ws-body font-bold${edge}`}
                    style={{ ...hdr, borderColor: "var(--ws-border)" }}
                  >
                    {label}
                    <MmColResizeGrip
                      onPointerDown={(e) => mmBeginResize(e, bk)}
                      onDoubleClick={() => mmApplyAutoFit(bk)}
                    />
                  </th>
                );
              })}
              <th
                scope="col"
                className="sticky top-[2.125rem] z-10 relative px-1 py-0.5 border-b border-l text-center text-ws-body font-bold"
                style={{ background: "var(--ws-mm-header-gold)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Stock Universe
                <MmColResizeGrip
                  onPointerDown={(e) => mmBeginResize(e, "universe")}
                  onDoubleClick={() => mmApplyAutoFit("universe")}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRowsToShow.map((row) => {
              const drillable = Boolean(onSymbolSelect) && isMmIndicatorDrilldownDate(row.date);
              const drillableSignals = Boolean(onSymbolSelect);
              const pair4 = getPairCellClassFull(row.up4pct, row.down4pct);
              const pairQ = getPairCellClassFull(row.up25pct_qtr, row.down25pct_qtr);
              const pairM = getPairCellClassFull(row.up25pct_month, row.down25pct_month);
              const pair50 = getPairCellClassFull(row.up50pct_month, row.down50pct_month);
              const pair52w = getPairCellClassFull(row.nnh52wHighs ?? 0, row.nnh52wLows ?? 0);
              const topIndustryVals = getTopIndustryValues(row.topUpIndustries);
              const topCells = topIndustriesExpanded ? topIndustryVals : [topIndustryVals[0]];
              return (
              <tr key={row.date} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                <td
                  className={`${MM_BODY_TD} whitespace-nowrap border-l border-r`}
                  style={{ borderColor: "var(--ws-border)" }}
                >
                  <MmDateCellLeft>
                    <MmTabularInner widthCh={MM_TAB_DATE_CH} textAlign="left" widthPx={colWidthsPx.date}>{formatDateDmy(row.date)}</MmTabularInner>
                  </MmDateCellLeft>
                </td>
                {topCells.map((ind, ti) => {
                  const colIdx = (topIndustriesExpanded ? ti : 0) as 0 | 1 | 2 | 3;
                  const ck = mmTopColKey(colIdx);
                  return (
                    <td
                      key={ti}
                      className={`${MM_BODY_TD} overflow-hidden border-r`}
                      style={{ borderColor: "var(--ws-border)", ...mmColStyle(colWidthsPx[ck]) }}
                    >
                      <MmTopIndustryBodyCell industry={ind} widthPx={colWidthsPx[ck]} />
                    </td>
                  );
                })}
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pair4}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up4pct", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up4pct} widthPx={colWidthsPx.b0}>{fmtInt(row.up4pct)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair4}>
                      <MmTabularInner widthCh={columnValueWidths.up4pct} widthPx={colWidthsPx.b0}>{fmtInt(row.up4pct)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pair4}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down4pct", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down4pct} widthPx={colWidthsPx.b1}>{fmtInt(row.down4pct)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair4}>
                      <MmTabularInner widthCh={columnValueWidths.down4pct} widthPx={colWidthsPx.b1}>{fmtInt(row.down4pct)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  <MmNumericCellCenter
                    className={getRatioCellClass(row.ratio5d)}
                  >
                    <MmTabularInner widthCh={columnValueWidths.ratio5d} widthPx={colWidthsPx.b2}>{fmtRatio(row.ratio5d)}</MmTabularInner>
                  </MmNumericCellCenter>
                </td>
                <td className={MM_BODY_TD}>
                  <MmNumericCellCenter
                    className={getRatioCellClass(row.ratio10d)}
                  >
                    <MmTabularInner widthCh={columnValueWidths.ratio10d} widthPx={colWidthsPx.b3}>{fmtRatio(row.ratio10d)}</MmTabularInner>
                  </MmNumericCellCenter>
                </td>
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pairQ}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up25pct_qtr", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up25pctQtr} widthPx={colWidthsPx.b4}>{fmtInt(row.up25pct_qtr)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairQ}>
                      <MmTabularInner widthCh={columnValueWidths.up25pctQtr} widthPx={colWidthsPx.b4}>{fmtInt(row.up25pct_qtr)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pairQ}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down25pct_qtr", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down25pctQtr} widthPx={colWidthsPx.b5}>{fmtInt(row.down25pct_qtr)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairQ}>
                      <MmTabularInner widthCh={columnValueWidths.down25pctQtr} widthPx={colWidthsPx.b5}>{fmtInt(row.down25pct_qtr)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={`${MM_BODY_TD} border-l`} style={{ borderColor: "var(--ws-border)" }}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pairM}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up25pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up25pctMonth} widthPx={colWidthsPx.b6}>{fmtInt(row.up25pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairM}>
                      <MmTabularInner widthCh={columnValueWidths.up25pctMonth} widthPx={colWidthsPx.b6}>{fmtInt(row.up25pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pairM}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down25pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down25pctMonth} widthPx={colWidthsPx.b7}>{fmtInt(row.down25pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairM}>
                      <MmTabularInner widthCh={columnValueWidths.down25pctMonth} widthPx={colWidthsPx.b7}>{fmtInt(row.down25pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pair50}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up50pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up50pctMonth} widthPx={colWidthsPx.b8}>{fmtInt(row.up50pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair50}>
                      <MmTabularInner widthCh={columnValueWidths.up50pctMonth} widthPx={colWidthsPx.b8}>{fmtInt(row.up50pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pair50}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down50pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down50pctMonth} widthPx={colWidthsPx.b9}>{fmtInt(row.down50pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair50}>
                      <MmTabularInner widthCh={columnValueWidths.down50pctMonth} widthPx={colWidthsPx.b9}>{fmtInt(row.down50pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={`${MM_BODY_TD} border-l`} style={{ borderColor: "var(--ws-border)" }}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pair52w}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("nnh52w_highs", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.nnh52wHighs} widthPx={colWidthsPx.b10}>{fmtInt(row.nnh52wHighs ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair52w}>
                      <MmTabularInner widthCh={columnValueWidths.nnh52wHighs} widthPx={colWidthsPx.b10}>{fmtInt(row.nnh52wHighs ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit ${pair52w}`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("nnh52w_lows", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.nnh52wLows} widthPx={colWidthsPx.b11}>{fmtInt(row.nnh52wLows ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair52w}>
                      <MmTabularInner widthCh={columnValueWidths.nnh52wLows} widthPx={colWidthsPx.b11}>{fmtInt(row.nnh52wLows ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillableSignals ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("count_7x_atr_50d", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.count7xAtr50d} widthPx={colWidthsPx.b12}>{fmtInt(row.count7xAtr50d ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter>
                      <MmTabularInner widthCh={columnValueWidths.count7xAtr50d} widthPx={colWidthsPx.b12}>{fmtInt(row.count7xAtr50d ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={MM_BODY_TD}>
                  {drillableSignals ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill ${MM_CELL_FILL} text-inherit`.trim()}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("count_episodic_pivot", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.countEpisodicPivot} widthPx={colWidthsPx.b13}>{fmtInt(row.countEpisodicPivot ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter>
                      <MmTabularInner widthCh={columnValueWidths.countEpisodicPivot} widthPx={colWidthsPx.b13}>{fmtInt(row.countEpisodicPivot ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={`${MM_BODY_TD} border-l`} style={{ borderColor: "var(--ws-border)" }}>
                  <MmNumericCellCenter>
                    <MmTabularInner widthCh={columnValueWidths.universe} widthPx={colWidthsPx.universe}>{fmtInt(row.universe)}</MmTabularInner>
                  </MmNumericCellCenter>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
