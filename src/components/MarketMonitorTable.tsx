import { useEffect, useState } from "react";
import { formatDisplayDate } from "@/lib/date-format";
import type { MarketMonitorRow } from "@/app/api/market-monitor/route";

type ApiResponse = {
  rows: MarketMonitorRow[];
  latestDate: string | null;
  startDate: string | null;
  error?: string;
};

function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return n.toLocaleString();
}

function fmtRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function fmtPctCell(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${n.toFixed(1)}%`;
}

function getBreadthPctCellClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 30) return "bg-[#5f4147] text-white";
  if (n < 40) return "bg-[#a54557] text-white";
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

function getPairCellClass(up: number | null | undefined, down: number | null | undefined): string {
  const upVal = Number(up ?? 0);
  const downVal = Number(down ?? 0);
  if (upVal > downVal) return "bg-[#0a8963] text-white";
  if (downVal > upVal) return "bg-[#a54557] text-white";
  return "";
}

export default function MarketMonitorTable() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [tableRowsToShow, setTableRowsToShow] = useState<MarketMonitorRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market-monitor")
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
        } else {
          setError(null);
          setLatestDate(json.latestDate ?? null);
          const all = json.rows ?? [];
          if (all.length > 0) {
            const latest = new Date(`${all[0].date}T00:00:00Z`);
            const cutoff = new Date(latest);
            cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
            const cutoffStr = cutoff.toISOString().slice(0, 10);
            setTableRowsToShow(all.filter((r) => r.date >= cutoffStr));
          } else {
            setTableRowsToShow([]);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load market monitor");
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

  return (
    <div className="flex-1 min-h-0 overflow-auto px-2 sm:px-4 py-3 sm:py-4" style={{ background: "var(--ws-bg2)" }}>
      <div className="relative mb-3">
        <h2 className="text-base font-semibold text-center" style={{ color: "var(--ws-text)" }}>
          Market Monitor
        </h2>
        <p className="text-[10px] text-center -mt-0.5" style={{ color: "var(--ws-text-vdim)" }}>
          Credit: Stockbee
        </p>
      </div>
      <div className="max-w-full overflow-auto rounded-md shadow-sm" style={{ background: "var(--ws-bg2)", border: "1px solid var(--ws-border)" }}>
        <table className="min-w-full text-xs sm:text-sm text-center border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 bg-[var(--ws-bg3)] px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 border-l border-r border-zinc-300 dark:border-zinc-700" />
              <th
                className="sticky top-0 z-10 bg-emerald-100/80 dark:bg-emerald-900/40 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 text-[13px] font-semibold text-emerald-900 dark:text-emerald-100"
                colSpan={6}
              >
                Primary Breadth Indicators
              </th>
              <th
                className="sticky top-0 z-10 bg-sky-100/80 dark:bg-sky-900/40 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 text-[13px] font-semibold border-l border-zinc-300 dark:border-zinc-700 text-sky-900 dark:text-sky-100"
                colSpan={4}
              >
                Secondary Breadth Indicators
              </th>
              <th
                className="sticky top-0 z-10 bg-violet-100/80 dark:bg-violet-900/40 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 text-[13px] font-semibold border-l border-zinc-300 dark:border-zinc-700 text-violet-900 dark:text-violet-100"
                colSpan={2}
              >
                S&amp;P 500 Breadth
              </th>
              <th
                className="sticky top-0 z-10 bg-violet-100/80 dark:bg-violet-900/40 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 text-[13px] font-semibold text-violet-900 dark:text-violet-100"
                colSpan={2}
              >
                Nasdaq Breadth
              </th>
              <th className="sticky top-0 z-10 bg-[var(--ws-bg3)] px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 border-l border-zinc-300 dark:border-zinc-700" />
            </tr>
            <tr>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium border-l border-r border-zinc-300 dark:border-zinc-700">
                Date
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Up %
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down %
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                5D Ratio
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                10D Ratio
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Up 25% (Q)
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down 25% (Q)
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium border-l border-zinc-300 dark:border-zinc-700">
                Up 25% (M)
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down 25% (M)
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Up 50% (M)
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down 50% (M)
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium border-l border-zinc-300 dark:border-zinc-700">
                % &gt; 50 SMA
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium">
                % &gt; 200 SMA
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium">
                % &gt; 50 SMA
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium">
                % &gt; 200 SMA
              </th>
              <th className="sticky top-8 z-10 bg-[var(--ws-bg3)] px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium border-l border-zinc-300 dark:border-zinc-700">
                Stock Universe
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRowsToShow.map((row) => (
              <tr key={row.date} className="odd:bg-[var(--ws-bg2)] even:bg-[var(--ws-bg)] border-b border-zinc-100 dark:border-zinc-800">
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 whitespace-nowrap text-right tabular-nums border-l border-r border-zinc-300 dark:border-zinc-700">
                  {formatDateDmy(row.date)}
                </td>
                <td
                  className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${
                    row.up4pct > row.down4pct && row.up4pct >= 267
                      ? "bg-[#2d5749] text-white"
                      : getPairCellClass(row.up4pct, row.down4pct)
                  }`}
                >
                  {fmtInt(row.up4pct)}
                </td>
                <td
                  className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${
                    row.down4pct > row.up4pct && row.down4pct >= 233
                      ? "bg-[#5f4147] text-white"
                      : getPairCellClass(row.up4pct, row.down4pct)
                  }`}
                >
                  {fmtInt(row.down4pct)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtRatio(row.ratio5d)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtRatio(row.ratio10d)}
                </td>
                <td className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getPairCellClass(row.up25pct_qtr, row.down25pct_qtr)}`}>
                  {fmtInt(row.up25pct_qtr)}
                </td>
                <td className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getPairCellClass(row.up25pct_qtr, row.down25pct_qtr)}`}>
                  {fmtInt(row.down25pct_qtr)}
                </td>
                <td className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums border-l border-zinc-300 dark:border-zinc-700 ${getPairCellClass(row.up25pct_month, row.down25pct_month)}`}>
                  {fmtInt(row.up25pct_month)}
                </td>
                <td className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getPairCellClass(row.up25pct_month, row.down25pct_month)}`}>
                  {fmtInt(row.down25pct_month)}
                </td>
                <td className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getPairCellClass(row.up50pct_month, row.down50pct_month)}`}>
                  {fmtInt(row.up50pct_month)}
                </td>
                <td className={`pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getPairCellClass(row.up50pct_month, row.down50pct_month)}`}>
                  {fmtInt(row.down50pct_month)}
                </td>
                <td
                  className={`pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums border-l border-zinc-300 dark:border-zinc-700 ${getBreadthPctCellClass(
                    row.sp500PctAbove50d
                  )}`}
                >
                  {fmtPctCell(row.sp500PctAbove50d)}
                </td>
                <td
                  className={`pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getBreadthPctCellClass(
                    row.sp500PctAbove200d
                  )}`}
                >
                  {fmtPctCell(row.sp500PctAbove200d)}
                </td>
                <td
                  className={`pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getBreadthPctCellClass(
                    row.nasdaqPctAbove50d
                  )}`}
                >
                  {fmtPctCell(row.nasdaqPctAbove50d)}
                </td>
                <td
                  className={`pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums ${getBreadthPctCellClass(
                    row.nasdaqPctAbove200d
                  )}`}
                >
                  {fmtPctCell(row.nasdaqPctAbove200d)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums border-l border-zinc-300 dark:border-zinc-700">
                  {fmtInt(row.universe)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

