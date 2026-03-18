"use client";

type QuarterlyRow = {
  period: string;
  date?: string;
  eps: number | null;
  epsGrowth: number | null;
  sales: number | null;
  salesGrowth: number | null;
};
type OwnershipRow = {
  report_date: string;
  num_funds: number | null;
  num_funds_change: number | null;
};

type QuarterlyBoxProps = {
  rows: QuarterlyRow[];
  ownershipRows?: OwnershipRow[];
  loading?: boolean;
};

function fmtNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function quarterKeyFromDate(date?: string): string | null {
  if (!date) return null;
  const y = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  if (!Number.isFinite(month)) return null;
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `${y}-Q${q}`;
}

function quarterKeyFromPeriod(period: string, date?: string): string | null {
  // Ownership is reported on calendar quarter-end dates, so prefer the row date
  // (calendar quarter) instead of fiscal period labels like Q1/Q2.
  if (date) return quarterKeyFromDate(date);
  const y = period.match(/\d{4}/)?.[0] || "";
  const p = period.match(/Q([1-4])/i)?.[1];
  if (y && p) return `${y}-Q${p}`;
  return quarterKeyFromDate(date);
}

export default function QuarterlyBox({ rows, ownershipRows = [], loading }: QuarterlyBoxProps) {
  if (loading) {
    return (
      <div className="w-full border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 shrink-0">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading quarterly data…</p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="w-full border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 shrink-0">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No quarterly data</p>
      </div>
    );
  }

  // At least 8 quarters including the most recent; then sort by year and Q1→Q4 so headers are in order
  const last8 = [...rows].reverse().slice(-8);
  function yearFromPeriod(period: string, date?: string): string {
    if (date) return date.slice(0, 4);
    const m = period.match(/\d{4}/);
    return m ? m[0] : "";
  }
  function quarterNum(period: string, date?: string): number {
    const q = period.match(/Q([1-4])/i)?.[1];
    if (q) return Number(q);
    if (date) {
      const month = Number(date.slice(5, 7));
      if (month <= 3) return 1;
      if (month <= 6) return 2;
      if (month <= 9) return 3;
      return 4;
    }
    return 0;
  }
  const ordered = [...last8].sort((a, b) => {
    const yA = yearFromPeriod(a.period, a.date);
    const yB = yearFromPeriod(b.period, b.date);
    if (yA !== yB) return yA.localeCompare(yB);
    return quarterNum(a.period, a.date) - quarterNum(b.period, b.date);
  });

  const yearGroups: { year: string; count: number }[] = [];
  let prevYear = "";
  for (const row of ordered) {
    const y = yearFromPeriod(row.period, row.date) || "NA";
    if (y === prevYear) yearGroups[yearGroups.length - 1].count++;
    else yearGroups.push({ year: y, count: 1 });
    prevYear = y;
  }

  // Column indices that are the last quarter of a year (add vertical border after these)
  const yearEndColIndices = new Set<number>();
  let colIndex = 0;
  for (const g of yearGroups) {
    colIndex += g.count;
    yearEndColIndices.add(colIndex - 1);
  }
  yearEndColIndices.delete(ordered.length - 1);

  const cellBorder = "border-r border-zinc-200 dark:border-zinc-700";
  const ownershipByQuarter = new Map(
    ownershipRows
      .map((r) => [quarterKeyFromDate(r.report_date), r] as const)
      .filter((e): e is [string, OwnershipRow] => Boolean(e[0]))
  );

  return (
    <div className="w-full border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden shrink-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="py-0.5 px-2 font-medium text-zinc-600 dark:text-zinc-400 text-left whitespace-nowrap w-20 border-r border-zinc-200 dark:border-zinc-700" />
              {yearGroups.map((g) => (
                <th
                  key={g.year + g.count}
                  colSpan={g.count}
                  className="py-0.5 px-2 font-medium text-zinc-600 dark:text-zinc-400 text-center whitespace-nowrap min-w-[3.5rem]"
                >
                  {g.year}
                </th>
              ))}
            </tr>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="py-0.5 px-2 font-medium text-zinc-500 dark:text-zinc-400 text-left whitespace-nowrap w-20 border-r border-zinc-200 dark:border-zinc-700" />
              {ordered.map((row, i) => (
                <th
                  key={row.date ?? `${row.period}-${i}`}
                  className={`py-0.5 px-2 font-medium text-zinc-500 dark:text-zinc-400 text-center whitespace-nowrap min-w-[3.5rem] ${yearEndColIndices.has(i) ? cellBorder : ""}`}
                >
                  {row.period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-0.5 px-2 text-zinc-500 dark:text-zinc-400 text-left whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700">EPS</td>
              {ordered.map((row, i) => (
                <td
                  key={row.date ?? `eps-${i}`}
                  className={`py-0.5 px-2 tabular-nums text-zinc-900 dark:text-zinc-100 text-center whitespace-nowrap ${yearEndColIndices.has(i) ? cellBorder : ""}`}
                >
                  {row.eps != null ? row.eps.toFixed(2) : "NA"}
                </td>
              ))}
            </tr>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-0.5 px-2 text-zinc-500 dark:text-zinc-400 text-left whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700">EPS Chg %</td>
              {ordered.map((row, i) => (
                <td
                  key={row.date ?? `epspct-${i}`}
                  className={`py-0.5 px-2 tabular-nums text-center whitespace-nowrap ${yearEndColIndices.has(i) ? cellBorder : ""} ${row.epsGrowth != null ? (row.epsGrowth >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-zinc-600 dark:text-zinc-400"}`}
                >
                  {row.epsGrowth != null ? fmtPct(row.epsGrowth) : "NA"}
                </td>
              ))}
            </tr>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-0.5 px-2 text-zinc-500 dark:text-zinc-400 text-left whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700">Sales</td>
              {ordered.map((row, i) => (
                <td
                  key={row.date ?? `sales-${i}`}
                  className={`py-0.5 px-2 tabular-nums text-zinc-900 dark:text-zinc-100 text-center whitespace-nowrap ${yearEndColIndices.has(i) ? cellBorder : ""}`}
                >
                  {row.sales != null ? fmtNum(row.sales) : "NA"}
                </td>
              ))}
            </tr>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-0.5 px-2 text-zinc-500 dark:text-zinc-400 text-left whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700">Sales Chg %</td>
              {ordered.map((row, i) => (
                <td
                  key={row.date ?? `salespct-${i}`}
                  className={`py-0.5 px-2 tabular-nums text-center whitespace-nowrap ${yearEndColIndices.has(i) ? cellBorder : ""} ${row.salesGrowth != null ? (row.salesGrowth >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-zinc-600 dark:text-zinc-400"}`}
                >
                  {row.salesGrowth != null ? fmtPct(row.salesGrowth) : "NA"}
                </td>
              ))}
            </tr>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-0.5 px-2 text-zinc-500 dark:text-zinc-400 text-left whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700"># of Funds</td>
              {ordered.map((row, i) => {
                const qk = quarterKeyFromPeriod(row.period, row.date);
                const own = qk ? ownershipByQuarter.get(qk) : undefined;
                return (
                  <td
                    key={row.date ?? `fundcount-${i}`}
                    className={`py-0.5 px-2 tabular-nums text-zinc-900 dark:text-zinc-100 text-center whitespace-nowrap ${yearEndColIndices.has(i) ? cellBorder : ""}`}
                  >
                    {own?.num_funds != null ? Number(own.num_funds).toLocaleString() : "NA"}
                  </td>
                );
              })}
            </tr>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-0.5 px-2 text-zinc-500 dark:text-zinc-400 text-left whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700">Funds Chg</td>
              {ordered.map((row, i) => {
                const qk = quarterKeyFromPeriod(row.period, row.date);
                const own = qk ? ownershipByQuarter.get(qk) : undefined;
                const chg = own?.num_funds_change;
                return (
                  <td
                    key={row.date ?? `fundchg-${i}`}
                    className={`py-0.5 px-2 tabular-nums text-center whitespace-nowrap ${yearEndColIndices.has(i) ? cellBorder : ""} ${
                      chg != null ? (chg >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {chg != null ? Number(chg).toLocaleString() : "NA"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
