import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
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

function fmtPctCell(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${n.toFixed(1)}%`;
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

function formatLongDate(input: string): string {
  const d = new Date(input.trim());
  if (Number.isNaN(d.getTime())) return input;
  const day = d.getDate();
  const rem10 = day % 10;
  const rem100 = day % 100;
  const suffix =
    rem10 === 1 && rem100 !== 11
      ? "st"
      : rem10 === 2 && rem100 !== 12
        ? "nd"
        : rem10 === 3 && rem100 !== 13
          ? "rd"
          : "th";
  const month = d.toLocaleString("en-GB", { month: "long" });
  return `${day}${suffix} ${month} ${d.getFullYear()}`;
}

function getPairCellClass(up: number | null | undefined, down: number | null | undefined): string {
  const upVal = Number(up ?? 0);
  const downVal = Number(down ?? 0);
  if (upVal > downVal) return "bg-[#0a8963] text-white";
  if (downVal > upVal) return "bg-[#a54557] text-white";
  return "";
}

function NetTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const net = Number(payload[0]?.value ?? 0);
  return (
    <div
      style={{
        background: "#1c1c1f",
        border: "1px solid #2e2e35",
        borderRadius: 6,
        padding: "3px 6px",
        fontSize: 10,
        lineHeight: 1.2,
      }}
    >
      <div style={{ color: "#d4d4d8" }}>{formatDateDmy(String(label ?? ""))}</div>
      <div style={{ color: net >= 0 ? "#34d399" : "#fca5a5" }}>
        Net: {net >= 0 ? "+" : ""}
        {net}
      </div>
    </div>
  );
}

function MiniBarSeries({
  title,
  series,
}: {
  title: string;
  series: Array<{ date: string; net: number }>;
}) {
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
  const interval = Math.max(0, Math.floor(series.length / 5));
  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-700 px-2 py-2 bg-zinc-50/40 dark:bg-zinc-800/30">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
        <p
          className={`text-xs tabular-nums ml-2 shrink-0 ${
            latest >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {latest >= 0 ? "+" : ""}
          {latest}
        </p>
      </div>
      <div className="mt-1">
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={series} margin={{ top: 0, right: 1, left: -18, bottom: -2 }} barCategoryGap="2%">
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              interval={interval}
              tick={{ fontSize: 7, fill: "#4a475a", fontFamily: "Outfit" }}
            />
            <YAxis tick={false} axisLine={false} tickLine={false} domain={[-maxAbs, maxAbs]} />
            <ReferenceLine y={0} stroke="#2e2e35" />
            <Tooltip content={<NetTooltip />} />
            <Bar dataKey="net" maxBarSize={5} minPointSize={2} radius={[2, 2, 0, 0]}>
              {series.map((entry) => (
                <Cell
                  key={entry.date}
                  fill={entry.net >= 0 ? "#34d399" : "#f87171"}
                  fillOpacity={0.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function MarketMonitorTable() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [netNewHighs, setNetNewHighs] = useState<ApiResponse["netNewHighs"]>(undefined);
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
      <div className="relative mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 text-center">
          Market Monitor
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 text-right">
          Last updated:{" "}
          <span className="tabular-nums">
            {latestDate ? formatLongDate(latestDate) : "—"}
          </span>
        </p>
      </div>
      <div className="mb-4 rounded border border-zinc-200 dark:border-zinc-700 p-3 bg-white dark:bg-zinc-900 shadow-sm">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 uppercase tracking-wide mb-2">
          Net New Highs (Highs - Lows)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          <MiniBarSeries title="1M" series={netNewHighs?.oneMonth ?? []} />
          <MiniBarSeries title="3M" series={netNewHighs?.threeMonths ?? []} />
          <MiniBarSeries title="6M" series={netNewHighs?.sixMonths ?? []} />
          <MiniBarSeries title="52W" series={netNewHighs?.fiftyTwoWeek ?? []} />
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
                className="sticky top-0 z-10 bg-fuchsia-100/80 dark:bg-fuchsia-900/40 px-3 py-2 border-b border-zinc-300 dark:border-zinc-700 text-[13px] font-semibold text-fuchsia-900 dark:text-fuchsia-100"
                colSpan={2}
              >
                Nasdaq Breadth
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
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium border-l border-zinc-300 dark:border-zinc-700">
                % &gt; 50 SMA
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium">
                % &gt; 200 SMA
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium">
                % &gt; 50 SMA
              </th>
              <th className="sticky top-8 z-10 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 text-[11px] font-medium">
                % &gt; 200 SMA
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
                <td className="pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums border-l border-zinc-300 dark:border-zinc-700">
                  {fmtPctCell(row.sp500PctAbove50d)}
                </td>
                <td className="pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtPctCell(row.sp500PctAbove200d)}
                </td>
                <td className="pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
                  {fmtPctCell(row.nasdaqPctAbove50d)}
                </td>
                <td className="pl-3 pr-5 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-right tabular-nums">
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

