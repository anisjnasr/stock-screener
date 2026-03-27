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
  if (n < 30) return "bg-[var(--ws-heat-red-deep)] text-white";
  if (n < 40) return "bg-[var(--ws-heat-red)] text-white";
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
  if (upVal > downVal) return "bg-[var(--ws-heat-green)] text-white";
  if (downVal > upVal) return "bg-[var(--ws-heat-red)] text-white";
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
      <div className="max-w-full overflow-auto rounded-md shadow-sm" style={{ background: "var(--ws-bg)", border: "1px solid var(--ws-border)" }}>
        <table className="min-w-full text-sm text-center border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 px-3 py-2 border-b border-r" style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }} />
              <th
                className="sticky top-0 z-10 px-3 py-2 border-b text-[14px] font-semibold"
                colSpan={6}
                style={{ background: "rgba(10,137,99,0.18)", borderColor: "var(--ws-border)", color: "#6ee7b7" }}
              >
                Primary Breadth Indicators
              </th>
              <th
                className="sticky top-0 z-10 px-3 py-2 border-b border-l text-[14px] font-semibold"
                colSpan={4}
                style={{ background: "rgba(14,116,187,0.18)", borderColor: "var(--ws-border)", color: "#7dd3fc" }}
              >
                Secondary Breadth Indicators
              </th>
              <th
                className="sticky top-0 z-10 px-3 py-2 border-b border-l text-[14px] font-semibold"
                colSpan={2}
                style={{ background: "rgba(109,76,186,0.18)", borderColor: "var(--ws-border)", color: "#c4b5fd" }}
              >
                S&amp;P 500 Breadth
              </th>
              <th
                className="sticky top-0 z-10 px-3 py-2 border-b text-[14px] font-semibold"
                colSpan={2}
                style={{ background: "rgba(109,76,186,0.18)", borderColor: "var(--ws-border)", color: "#c4b5fd" }}
              >
                Nasdaq Breadth
              </th>
              <th className="sticky top-0 z-10 px-3 py-2 border-b border-l" style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)" }} />
            </tr>
            <tr>
              {["Date", "Up %", "Down %", "5D Ratio", "10D Ratio", "Up 25% (Q)", "Down 25% (Q)", "Up 25% (M)", "Down 25% (M)", "Up 50% (M)", "Down 50% (M)"].map((label, idx) => (
                <th
                  key={label}
                  className={`sticky top-8 z-10 px-3 py-1.5 border-b text-[13px] font-medium${idx === 0 || idx === 7 ? " border-l border-r" : ""}`}
                  style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
                >
                  {label}
                </th>
              ))}
              {["% > 50 SMA", "% > 200 SMA", "% > 50 SMA", "% > 200 SMA"].map((label, idx) => (
                <th
                  key={`breadth-${idx}`}
                  className={`sticky top-8 z-10 px-2 py-1 border-b text-[12px] font-medium${idx === 0 ? " border-l" : ""}`}
                  style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
                >
                  {label}
                </th>
              ))}
              <th
                className="sticky top-8 z-10 px-3 py-1.5 border-b border-l text-[13px] font-medium"
                style={{ background: "var(--ws-bg)", borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}
              >
                Stock Universe
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRowsToShow.map((row) => (
              <tr key={row.date} className="border-b" style={{ borderColor: "var(--ws-border)" }}>
                <td className="pl-3 pr-7 py-1.5 whitespace-nowrap text-right tabular-nums border-l border-r" style={{ borderColor: "var(--ws-border)" }}>
                  {formatDateDmy(row.date)}
                </td>
                <td
                  className={`pl-3 pr-7 py-1.5 text-right tabular-nums ${
                    row.up4pct > row.down4pct && row.up4pct >= 267
                      ? "bg-[var(--ws-heat-green-deep)] text-white"
                      : getPairCellClass(row.up4pct, row.down4pct)
                  }`}
                >
                  {fmtInt(row.up4pct)}
                </td>
                <td
                  className={`pl-3 pr-7 py-1.5 text-right tabular-nums ${
                    row.down4pct > row.up4pct && row.down4pct >= 233
                      ? "bg-[var(--ws-heat-red-deep)] text-white"
                      : getPairCellClass(row.up4pct, row.down4pct)
                  }`}
                >
                  {fmtInt(row.down4pct)}
                </td>
                <td className="pl-3 pr-7 py-1.5 text-right tabular-nums">{fmtRatio(row.ratio5d)}</td>
                <td className="pl-3 pr-7 py-1.5 text-right tabular-nums">{fmtRatio(row.ratio10d)}</td>
                <td className={`pl-3 pr-7 py-1.5 text-right tabular-nums ${getPairCellClass(row.up25pct_qtr, row.down25pct_qtr)}`}>{fmtInt(row.up25pct_qtr)}</td>
                <td className={`pl-3 pr-7 py-1.5 text-right tabular-nums ${getPairCellClass(row.up25pct_qtr, row.down25pct_qtr)}`}>{fmtInt(row.down25pct_qtr)}</td>
                <td className={`pl-3 pr-7 py-1.5 text-right tabular-nums border-l ${getPairCellClass(row.up25pct_month, row.down25pct_month)}`} style={{ borderColor: "var(--ws-border)" }}>{fmtInt(row.up25pct_month)}</td>
                <td className={`pl-3 pr-7 py-1.5 text-right tabular-nums ${getPairCellClass(row.up25pct_month, row.down25pct_month)}`}>{fmtInt(row.down25pct_month)}</td>
                <td className={`pl-3 pr-7 py-1.5 text-right tabular-nums ${getPairCellClass(row.up50pct_month, row.down50pct_month)}`}>{fmtInt(row.up50pct_month)}</td>
                <td className={`pl-3 pr-7 py-1.5 text-right tabular-nums ${getPairCellClass(row.up50pct_month, row.down50pct_month)}`}>{fmtInt(row.down50pct_month)}</td>
                <td className={`pl-3 pr-5 py-1.5 text-right tabular-nums border-l ${getBreadthPctCellClass(row.sp500PctAbove50d)}`} style={{ borderColor: "var(--ws-border)" }}>{fmtPctCell(row.sp500PctAbove50d)}</td>
                <td className={`pl-3 pr-5 py-1.5 text-right tabular-nums ${getBreadthPctCellClass(row.sp500PctAbove200d)}`}>{fmtPctCell(row.sp500PctAbove200d)}</td>
                <td className={`pl-3 pr-5 py-1.5 text-right tabular-nums ${getBreadthPctCellClass(row.nasdaqPctAbove50d)}`}>{fmtPctCell(row.nasdaqPctAbove50d)}</td>
                <td className={`pl-3 pr-5 py-1.5 text-right tabular-nums ${getBreadthPctCellClass(row.nasdaqPctAbove200d)}`}>{fmtPctCell(row.nasdaqPctAbove200d)}</td>
                <td className="pl-3 pr-7 py-1.5 text-right tabular-nums border-l" style={{ borderColor: "var(--ws-border)" }}>{fmtInt(row.universe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

