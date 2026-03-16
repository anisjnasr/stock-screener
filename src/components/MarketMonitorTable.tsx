import { useEffect, useState } from "react";
import type { MarketMonitorRow } from "@/app/api/market-monitor/route";

type ApiResponse = {
  rows: MarketMonitorRow[];
  latestDate: string | null;
  startDate: string | null;
  breadth?: {
    sp500PctAbove50d: number | null;
    nasdaqPctAbove50d: number | null;
    sp500PctAbove200d: number | null;
    nasdaqPctAbove200d: number | null;
  };
  netNewHighs?: {
    oneMonth: Array<{ date: string; highs: number; lows: number; net: number }>;
    threeMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    sixMonths: Array<{ date: string; highs: number; lows: number; net: number }>;
    fiftyTwoWeek: Array<{ date: string; highs: number; lows: number; net: number }>;
  };
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

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(0)}%`;
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

export default function MarketMonitorTable() {
  const [data, setData] = useState<MarketMonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [breadth, setBreadth] = useState<ApiResponse["breadth"]>(undefined);
  const [netNewHighs, setNetNewHighs] = useState<ApiResponse["netNewHighs"]>(undefined);
  const [tableRowsToShow, setTableRowsToShow] = useState<MarketMonitorRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/market-monitor")
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setData([]);
        } else {
          setError(null);
          setData(json.rows ?? []);
          setLatestDate(json.latestDate ?? null);
          setBreadth(json.breadth);
          setNetNewHighs(json.netNewHighs);
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
        setData([]);
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
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading market monitor…</p>
      </div>
    );
  }

  const MiniBarSeries = ({
    title,
    series,
  }: {
    title: string;
    series: Array<{ date: string; net: number }>;
  }) => {
    if (!series || series.length === 0) {
      return (
        <div className="rounded border border-zinc-200 dark:border-zinc-700 p-2">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">No data</p>
        </div>
      );
    }
    const maxAbs = Math.max(1, ...series.map((s) => Math.abs(s.net)));
    const latest = series[series.length - 1]?.net ?? 0;
    return (
      <div className="rounded border border-zinc-200 dark:border-zinc-700 p-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
          <p className={`text-xs tabular-nums ${latest >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {latest >= 0 ? "+" : ""}{latest}
          </p>
        </div>
        <div className="mt-2 h-16 flex items-end gap-[2px]">
          {series.map((s) => {
            const hPct = Math.max(4, Math.round((Math.abs(s.net) / maxAbs) * 100));
            const positive = s.net >= 0;
            return (
              <div
                key={s.date}
                className={`w-1 flex-1 rounded-sm ${positive ? "bg-emerald-500" : "bg-rose-500"}`}
                style={{ height: `${hPct}%` }}
                title={`${formatDateDmy(s.date)}: ${s.net >= 0 ? "+" : ""}${s.net}`}
              />
            );
          })}
        </div>
      </div>
    );
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-zinc-900">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-zinc-900 px-4 py-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Market Monitor
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Last updated:{" "}
          <span className="tabular-nums">
            {latestDate ? formatDateDmy(latestDate) : "—"}
          </span>
        </p>
      </div>
      <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded border border-zinc-200 dark:border-zinc-700 p-3 bg-white dark:bg-zinc-900">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide mb-2">
            % Stocks Above Moving Averages
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-zinc-200 dark:border-zinc-700 p-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">50-Day MA</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">S&P 500</p>
              <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{fmtPct(breadth?.sp500PctAbove50d)}</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">Nasdaq</p>
              <p className="text-lg font-semibold text-amber-500 dark:text-amber-400">{fmtPct(breadth?.nasdaqPctAbove50d)}</p>
            </div>
            <div className="rounded border border-zinc-200 dark:border-zinc-700 p-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">200-Day MA</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">S&P 500</p>
              <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{fmtPct(breadth?.sp500PctAbove200d)}</p>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">Nasdaq</p>
              <p className="text-lg font-semibold text-amber-500 dark:text-amber-400">{fmtPct(breadth?.nasdaqPctAbove200d)}</p>
            </div>
          </div>
        </div>
        <div className="rounded border border-zinc-200 dark:border-zinc-700 p-3 bg-white dark:bg-zinc-900">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide mb-2">
            Net New Highs (Highs - Lows)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <MiniBarSeries title="1M" series={netNewHighs?.oneMonth ?? []} />
            <MiniBarSeries title="3M" series={netNewHighs?.threeMonths ?? []} />
            <MiniBarSeries title="6M" series={netNewHighs?.sixMonths ?? []} />
            <MiniBarSeries title="52W" series={netNewHighs?.fiftyTwoWeek ?? []} />
          </div>
        </div>
      </div>
      <div className="max-w-full overflow-auto border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 shadow-sm">
        <table className="min-w-full text-sm text-center border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 bg-zinc-900 dark:bg-zinc-900 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 border-l border-r border-zinc-300 dark:border-zinc-700" />
              <th
                className="sticky top-0 z-10 bg-emerald-100/80 dark:bg-emerald-900/40 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 text-[13px] font-semibold text-emerald-900 dark:text-emerald-100"
                colSpan={6}
              >
                Primary Breadth Indicators
              </th>
              <th
                className="sticky top-0 z-10 bg-sky-100/80 dark:bg-sky-900/40 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 text-[13px] font-semibold border-l border-zinc-300 dark:border-zinc-700 text-sky-900 dark:text-sky-100"
                colSpan={6}
              >
                Secondary Breadth Indicators
              </th>
              <th className="sticky top-0 z-10 bg-zinc-900 dark:bg-zinc-900 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 border-l border-zinc-300 dark:border-zinc-700" />
            </tr>
            <tr>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium border-l border-r border-zinc-300 dark:border-zinc-700">
                Date
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Up %
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down %
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                5D Ratio
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                10D Ratio
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Up 25% (Q)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down 25% (Q)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium border-l border-zinc-300 dark:border-zinc-700">
                Up 25% (M)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down 25% (M)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Up 50% (M)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down 50% (M)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Up 13% (M)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium">
                Down 13% (M)
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 text-[12px] font-medium border-l border-zinc-300 dark:border-zinc-700">
                Stock Universe
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRowsToShow.map((row) => (
              <tr key={row.date} className="odd:bg-white even:bg-zinc-50/60 dark:odd:bg-zinc-900 dark:even:bg-zinc-900/60 border-b border-zinc-100 dark:border-zinc-800">
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 whitespace-nowrap text-right tabular-nums border-l border-r border-zinc-300 dark:border-zinc-700">
                  {formatDateDmy(row.date)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.up4pct)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.down4pct)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtRatio(row.ratio5d)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtRatio(row.ratio10d)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.up25pct_qtr)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.down25pct_qtr)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums border-l border-zinc-300 dark:border-zinc-700">
                  {fmtInt(row.up25pct_month)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.down25pct_month)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.up50pct_month)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.down50pct_month)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.up13pct_34d)}
                </td>
                <td className="pl-3 pr-7 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtInt(row.down13pct_34d)}
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

