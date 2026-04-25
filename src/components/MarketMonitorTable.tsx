import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MarketMonitorRow, MarketMonitorApiPayload } from "@/app/api/market-monitor/route";
import type { MarketMonitorMetricKey } from "@/lib/screener-db-native";
import MarketMonitorConstituentsModal, {
  type MarketMonitorListCreatedInfo,
} from "@/components/MarketMonitorConstituentsModal";

const MARKET_MONITOR_FETCH_VERSION = "7x-atr-v1";

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

type RatioThresholds = {
  ratio5dLow: number | null;
  ratio5dHigh: number | null;
  ratio10dLow: number | null;
  ratio10dHigh: number | null;
};

function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toLocaleString();
}

function fmtRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function fmtUniverseBreadthPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${n.toFixed(1)}%`;
}

function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * weight;
}

function computeRatioThresholds(rows: MarketMonitorRow[]): RatioThresholds {
  const ratio5dVals = rows
    .map((r) => r.ratio5d)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const ratio10dVals = rows
    .map((r) => r.ratio10d)
    .filter((v): v is number => v != null && Number.isFinite(v));

  return {
    ratio5dLow: quantile(ratio5dVals, 0.1),
    ratio5dHigh: quantile(ratio5dVals, 0.9),
    ratio10dLow: quantile(ratio10dVals, 0.1),
    ratio10dHigh: quantile(ratio10dVals, 0.9),
  };
}

function getRatioExtremeCellClass(
  value: number | null | undefined,
  low: number | null,
  high: number | null
): string {
  if (value == null || !Number.isFinite(value)) return "";
  if (low != null && value <= low) return "ws-mm-heat-red-very";
  if (high != null && value >= high) return "ws-mm-heat-green-very";
  return "";
}

function getUniverseBreadthFloorClass(value: number | null | undefined, floor: number, inclusive: boolean): string {
  if (value == null || !Number.isFinite(value)) return "";
  return inclusive ? (value <= floor ? "ws-mm-heat-red-strong" : "") : (value < floor ? "ws-mm-heat-red-strong" : "");
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
const MM_TAB_MIN_PCT_CH = 5;

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
  children,
  className = "",
}: {
  widthCh: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-block text-right tabular-nums ${className}`.trim()}
      style={{ width: `${widthCh}ch`, minWidth: `${widthCh}ch` }}
    >
      {children}
    </span>
  );
}

function MmNumericCellCenter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex w-full justify-center items-center py-1 ${className}`.trim()}>{children}</div>;
}

function MmDateCellLeft({ children }: { children: ReactNode }) {
  return <div className="flex w-full justify-start items-center px-1 py-1">{children}</div>;
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
  const [ratioThresholds, setRatioThresholds] = useState<RatioThresholds>({
    ratio5dLow: null,
    ratio5dHigh: null,
    ratio10dLow: null,
    ratio10dHigh: null,
  });
  const [staleBanner, setStaleBanner] = useState<string | null>(null);

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
          setRatioThresholds(computeRatioThresholds(all));
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
      const pctWidth = (value: (row: MarketMonitorRow) => number | null | undefined) =>
        maxFormattedCh(tableRowsToShow, (row) => [fmtUniverseBreadthPct(value(row))], MM_TAB_MIN_PCT_CH);

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
        universePctAbove50d: pctWidth((row) => row.universePctAbove50d),
        universePctAbove200d: pctWidth((row) => row.universePctAbove200d),
        universe: intWidth((row) => row.universe),
      };
    },
    [tableRowsToShow]
  );

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
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-r text-center" style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }} />
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
                colSpan={10}
                style={{ background: "var(--ws-mm-header-green)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Secondary Breadth Indicators
              </th>
              <th scope="col" className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-l text-center" style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }} />
            </tr>
            <tr>
              {[
                "Date",
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
                ">50D",
                ">200D",
              ].map((label, idx) => {
                const isGold = idx === 0 || (idx >= 1 && idx <= 6);
                const isGreen = idx >= 7 && idx <= 16;
                const hdr = isGold
                  ? { background: "var(--ws-mm-header-gold)", color: "var(--ws-mm-header-text)" }
                  : isGreen
                    ? { background: "var(--ws-mm-header-green)", color: "var(--ws-mm-header-text)" }
                    : { background: "var(--ws-bg2)", color: "var(--ws-text)" };
                const edge = idx === 0 || idx === 7 ? " border-l border-r" : "";
                return (
                  <th
                    scope="col"
                    key={label}
                    className={`sticky top-[2.125rem] z-10 px-1 py-0.5 border-b text-center text-ws-body font-bold${edge}`}
                    style={{ ...hdr, borderColor: "var(--ws-border)" }}
                  >
                    {label}
                  </th>
                );
              })}
              <th
                scope="col"
                className="sticky top-[2.125rem] z-10 px-1 py-0.5 border-b border-l text-center text-ws-body font-bold"
                style={{ background: "var(--ws-mm-header-gold)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Stock Universe
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
              return (
              <tr key={row.date} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                <td className="p-0 whitespace-nowrap border-l border-r" style={{ borderColor: "var(--ws-border)" }}>
                  <MmDateCellLeft>
                    <MmTabularInner widthCh={MM_TAB_DATE_CH} className="text-left">{formatDateDmy(row.date)}</MmTabularInner>
                  </MmDateCellLeft>
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pair4}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up4pct", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up4pct}>{fmtInt(row.up4pct)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair4}>
                      <MmTabularInner widthCh={columnValueWidths.up4pct}>{fmtInt(row.up4pct)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pair4}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down4pct", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down4pct}>{fmtInt(row.down4pct)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair4}>
                      <MmTabularInner widthCh={columnValueWidths.down4pct}>{fmtInt(row.down4pct)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={`p-0 ${getRatioExtremeCellClass(row.ratio5d, ratioThresholds.ratio5dLow, ratioThresholds.ratio5dHigh)}`}>
                  <MmNumericCellCenter>
                    <MmTabularInner widthCh={columnValueWidths.ratio5d}>{fmtRatio(row.ratio5d)}</MmTabularInner>
                  </MmNumericCellCenter>
                </td>
                <td className={`p-0 ${getRatioExtremeCellClass(row.ratio10d, ratioThresholds.ratio10dLow, ratioThresholds.ratio10dHigh)}`}>
                  <MmNumericCellCenter>
                    <MmTabularInner widthCh={columnValueWidths.ratio10d}>{fmtRatio(row.ratio10d)}</MmTabularInner>
                  </MmNumericCellCenter>
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pairQ}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up25pct_qtr", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up25pctQtr}>{fmtInt(row.up25pct_qtr)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairQ}>
                      <MmTabularInner widthCh={columnValueWidths.up25pctQtr}>{fmtInt(row.up25pct_qtr)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pairQ}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down25pct_qtr", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down25pctQtr}>{fmtInt(row.down25pct_qtr)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairQ}>
                      <MmTabularInner widthCh={columnValueWidths.down25pctQtr}>{fmtInt(row.down25pct_qtr)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0 border-l" style={{ borderColor: "var(--ws-border)" }}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pairM}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up25pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up25pctMonth}>{fmtInt(row.up25pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairM}>
                      <MmTabularInner widthCh={columnValueWidths.up25pctMonth}>{fmtInt(row.up25pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pairM}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down25pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down25pctMonth}>{fmtInt(row.down25pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pairM}>
                      <MmTabularInner widthCh={columnValueWidths.down25pctMonth}>{fmtInt(row.down25pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pair50}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up50pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.up50pctMonth}>{fmtInt(row.up50pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair50}>
                      <MmTabularInner widthCh={columnValueWidths.up50pctMonth}>{fmtInt(row.up50pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pair50}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down50pct_month", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.down50pctMonth}>{fmtInt(row.down50pct_month)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair50}>
                      <MmTabularInner widthCh={columnValueWidths.down50pctMonth}>{fmtInt(row.down50pct_month)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0 border-l" style={{ borderColor: "var(--ws-border)" }}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pair52w}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("nnh52w_highs", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.nnh52wHighs}>{fmtInt(row.nnh52wHighs ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair52w}>
                      <MmTabularInner widthCh={columnValueWidths.nnh52wHighs}>{fmtInt(row.nnh52wHighs ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit ${pair52w}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("nnh52w_lows", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.nnh52wLows}>{fmtInt(row.nnh52wLows ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter className={pair52w}>
                      <MmTabularInner widthCh={columnValueWidths.nnh52wLows}>{fmtInt(row.nnh52wLows ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillableSignals ? (
                    <button
                      type="button"
                      className="ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit"
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("count_7x_atr_50d", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.count7xAtr50d}>{fmtInt(row.count7xAtr50d ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter>
                      <MmTabularInner widthCh={columnValueWidths.count7xAtr50d}>{fmtInt(row.count7xAtr50d ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0">
                  {drillableSignals ? (
                    <button
                      type="button"
                      className="ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit"
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("count_episodic_pivot", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.countEpisodicPivot}>{fmtInt(row.countEpisodicPivot ?? 0)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter>
                      <MmTabularInner widthCh={columnValueWidths.countEpisodicPivot}>{fmtInt(row.countEpisodicPivot ?? 0)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={`p-0 ${getUniverseBreadthFloorClass(row.universePctAbove50d, 30, true)}`}>
                  {drillable ? (
                    <button
                      type="button"
                      className="ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit"
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("universe_above_50d", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.universePctAbove50d}>{fmtUniverseBreadthPct(row.universePctAbove50d)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter>
                      <MmTabularInner widthCh={columnValueWidths.universePctAbove50d}>{fmtUniverseBreadthPct(row.universePctAbove50d)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className={`p-0 ${getUniverseBreadthFloorClass(row.universePctAbove200d, 30, false)}`}>
                  {drillable ? (
                    <button
                      type="button"
                      className="ws-mm-cell-drill w-full flex justify-center items-center py-1 text-inherit"
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("universe_above_200d", row.date)}
                    >
                      <MmTabularInner widthCh={columnValueWidths.universePctAbove200d}>{fmtUniverseBreadthPct(row.universePctAbove200d)}</MmTabularInner>
                    </button>
                  ) : (
                    <MmNumericCellCenter>
                      <MmTabularInner widthCh={columnValueWidths.universePctAbove200d}>{fmtUniverseBreadthPct(row.universePctAbove200d)}</MmTabularInner>
                    </MmNumericCellCenter>
                  )}
                </td>
                <td className="p-0 border-l" style={{ borderColor: "var(--ws-border)" }}>
                  <MmNumericCellCenter>
                    <MmTabularInner widthCh={columnValueWidths.universe}>{fmtInt(row.universe)}</MmTabularInner>
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
