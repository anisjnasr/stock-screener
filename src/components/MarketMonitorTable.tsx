import { useEffect, useState } from "react";
import type { MarketMonitorRow, MarketMonitorApiPayload } from "@/app/api/market-monitor/route";
import type { MarketMonitorMetricKey } from "@/lib/screener-db-native";
import MarketMonitorConstituentsModal, {
  type MarketMonitorListCreatedInfo,
} from "@/components/MarketMonitorConstituentsModal";

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
  universe_above_50d: ">50D",
  universe_above_200d: ">200D",
};

/** Earliest session date for which primary-breadth indicator counts are drillable (ISO YYYY-MM-DD). */
const MM_INDICATOR_DRILLDOWN_MIN_DATE = "2026-03-26";

function isMmIndicatorDrilldownDate(rowDate: string): boolean {
  return rowDate.trim() >= MM_INDICATOR_DRILLDOWN_MIN_DATE;
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

function formatDateDmy(input: string): string {
  const d = new Date(input.trim());
  if (Number.isNaN(d.getTime())) return input;
  const day = d.getDate().toString().padStart(2, "0");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
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
    fetch("/api/market-monitor")
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
    if (!onSymbolSelect || !isMmIndicatorDrilldownDate(rowDate)) return;
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
              <th scope="col" className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-r" style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }} />
              <th
                scope="colgroup"
                className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 text-xs font-bold tracking-wide"
                colSpan={6}
                style={{ background: "var(--ws-mm-header-gold)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Primary Breadth Indicators
              </th>
              <th
                scope="colgroup"
                className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-l text-xs font-bold tracking-wide"
                colSpan={8}
                style={{ background: "var(--ws-mm-header-green)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Secondary Breadth Indicators
              </th>
              <th scope="col" className="sticky top-0 z-10 px-1.5 py-1.5 border-b-2 border-l" style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }} />
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
                ">50D",
                ">200D",
              ].map((label, idx) => {
                const isGold = idx === 0 || (idx >= 1 && idx <= 6);
                const isGreen = idx >= 7 && idx <= 14;
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
                    className={`sticky top-[2.125rem] z-10 px-1 py-0.5 border-b text-[11px] font-bold${edge}`}
                    style={{ ...hdr, borderColor: "var(--ws-border)" }}
                  >
                    {label}
                  </th>
                );
              })}
              <th
                scope="col"
                className="sticky top-[2.125rem] z-10 px-1 py-0.5 border-b border-l text-[11px] font-bold"
                style={{ background: "var(--ws-mm-header-gold)", borderColor: "var(--ws-border)", color: "var(--ws-mm-header-text)" }}
              >
                Stock Universe
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRowsToShow.map((row) => {
              const drillable = Boolean(onSymbolSelect) && isMmIndicatorDrilldownDate(row.date);
              const pair4 = getPairCellClassFull(row.up4pct, row.down4pct);
              const pairQ = getPairCellClassFull(row.up25pct_qtr, row.down25pct_qtr);
              const pairM = getPairCellClassFull(row.up25pct_month, row.down25pct_month);
              const pair50 = getPairCellClassFull(row.up50pct_month, row.down50pct_month);
              const pair52w = getPairCellClassFull(row.nnh52wHighs ?? 0, row.nnh52wLows ?? 0);
              return (
              <tr key={row.date} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                <td className="pl-1 pr-1.5 py-1 whitespace-nowrap text-right tabular-nums border-l border-r" style={{ borderColor: "var(--ws-border)" }}>
                  {formatDateDmy(row.date)}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pair4}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up4pct", row.date)}
                    >
                      {fmtInt(row.up4pct)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pair4}`}>{fmtInt(row.up4pct)}</span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pair4}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down4pct", row.date)}
                    >
                      {fmtInt(row.down4pct)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pair4}`}>{fmtInt(row.down4pct)}</span>
                  )}
                </td>
                <td className={`pl-1 pr-1.5 py-1 text-right tabular-nums ${getRatioExtremeCellClass(row.ratio5d, ratioThresholds.ratio5dLow, ratioThresholds.ratio5dHigh)}`}>
                  {fmtRatio(row.ratio5d)}
                </td>
                <td className={`pl-1 pr-1.5 py-1 text-right tabular-nums ${getRatioExtremeCellClass(row.ratio10d, ratioThresholds.ratio10dLow, ratioThresholds.ratio10dHigh)}`}>
                  {fmtRatio(row.ratio10d)}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pairQ}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up25pct_qtr", row.date)}
                    >
                      {fmtInt(row.up25pct_qtr)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pairQ}`}>{fmtInt(row.up25pct_qtr)}</span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pairQ}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down25pct_qtr", row.date)}
                    >
                      {fmtInt(row.down25pct_qtr)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pairQ}`}>{fmtInt(row.down25pct_qtr)}</span>
                  )}
                </td>
                <td className="p-0 border-l" style={{ borderColor: "var(--ws-border)" }}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pairM}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up25pct_month", row.date)}
                    >
                      {fmtInt(row.up25pct_month)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pairM}`}>{fmtInt(row.up25pct_month)}</span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pairM}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down25pct_month", row.date)}
                    >
                      {fmtInt(row.down25pct_month)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pairM}`}>{fmtInt(row.down25pct_month)}</span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pair50}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("up50pct_month", row.date)}
                    >
                      {fmtInt(row.up50pct_month)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pair50}`}>{fmtInt(row.up50pct_month)}</span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pair50}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("down50pct_month", row.date)}
                    >
                      {fmtInt(row.down50pct_month)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pair50}`}>{fmtInt(row.down50pct_month)}</span>
                  )}
                </td>
                <td className="p-0 border-l" style={{ borderColor: "var(--ws-border)" }}>
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pair52w}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("nnh52w_highs", row.date)}
                    >
                      {fmtInt(row.nnh52wHighs ?? 0)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums border-l ${pair52w}`} style={{ borderColor: "var(--ws-border)" }}>
                      {fmtInt(row.nnh52wHighs ?? 0)}
                    </span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className={`ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit ${pair52w}`}
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("nnh52w_lows", row.date)}
                    >
                      {fmtInt(row.nnh52wLows ?? 0)}
                    </button>
                  ) : (
                    <span className={`block pl-1 pr-1.5 py-1 text-right tabular-nums ${pair52w}`}>{fmtInt(row.nnh52wLows ?? 0)}</span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className="ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit"
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("universe_above_50d", row.date)}
                    >
                      {fmtUniverseBreadthPct(row.universePctAbove50d)}
                    </button>
                  ) : (
                    <span className="block pl-1 pr-1.5 py-1 text-right tabular-nums">
                      {fmtUniverseBreadthPct(row.universePctAbove50d)}
                    </span>
                  )}
                </td>
                <td className="p-0">
                  {drillable ? (
                    <button
                      type="button"
                      className="ws-mm-cell-drill w-full pl-1 pr-1.5 py-1 text-right tabular-nums text-inherit"
                      style={{ font: "inherit", border: "none", cursor: "pointer" }}
                      onClick={() => openMmModal("universe_above_200d", row.date)}
                    >
                      {fmtUniverseBreadthPct(row.universePctAbove200d)}
                    </button>
                  ) : (
                    <span className="block pl-1 pr-1.5 py-1 text-right tabular-nums">
                      {fmtUniverseBreadthPct(row.universePctAbove200d)}
                    </span>
                  )}
                </td>
                <td className="pl-1 pr-1.5 py-1 text-right tabular-nums border-l" style={{ borderColor: "var(--ws-border)" }}>{fmtInt(row.universe)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
