import { useEffect, useState } from "react";
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
            {data.map((row) => (
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

