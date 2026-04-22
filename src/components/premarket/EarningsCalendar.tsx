"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEpsDollarPair, formatRevDollarPair } from "@/components/premarket/earnings-calendar-format";
import type { EarningsCalendarBucket, EarningsCalendarPublic, EarningsCalendarResponse } from "@/types/earnings-calendar";

const TIME_ORDER: Record<string, number> = { bmo: 0, dmh: 1, amc: 2 };

type EarningsSortKey =
  | "ticker"
  | "company_name"
  | "when"
  | "rev"
  | "rev_surprise"
  | "eps"
  | "eps_surprise";

type SortDir = "asc" | "desc";

function defaultSortDir(key: EarningsSortKey): SortDir {
  return key === "ticker" || key === "company_name" || key === "when" ? "asc" : "desc";
}

function whenOrder(t: string | null): number {
  const x = t ?? "dmh";
  return TIME_ORDER[x] ?? 1;
}

function cmpNum(a: number | null, b: number | null, asc: boolean): number {
  const aOk = a != null && Number.isFinite(a);
  const bOk = b != null && Number.isFinite(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return asc ? a - b : b - a;
}

function compareRows(a: EarningsCalendarPublic, b: EarningsCalendarPublic, key: EarningsSortKey, asc: boolean): number {
  switch (key) {
    case "ticker": {
      const c = a.ticker.localeCompare(b.ticker);
      return asc ? c : -c;
    }
    case "company_name": {
      const as = (a.company_name ?? "").toLowerCase();
      const bs = (b.company_name ?? "").toLowerCase();
      const c = as.localeCompare(bs);
      return asc ? c : -c;
    }
    case "when": {
      const d = whenOrder(a.report_time) - whenOrder(b.report_time);
      if (d !== 0) return asc ? d : -d;
      const c = a.ticker.localeCompare(b.ticker);
      return asc ? c : -c;
    }
    case "rev": {
      const d = cmpNum(a.revenue_actual, b.revenue_actual, asc);
      if (d !== 0) return d;
      return cmpNum(a.prior_revenue_actual, b.prior_revenue_actual, asc);
    }
    case "rev_surprise":
      return cmpNum(a.current_quarter_rev_surprise_pct, b.current_quarter_rev_surprise_pct, asc);
    case "eps": {
      const d = cmpNum(a.eps_actual, b.eps_actual, asc);
      if (d !== 0) return d;
      return cmpNum(a.prior_eps_actual, b.prior_eps_actual, asc);
    }
    case "eps_surprise":
      return cmpNum(a.current_quarter_eps_surprise_pct, b.current_quarter_eps_surprise_pct, asc);
    default:
      return 0;
  }
}

function SortChevrons({ activeAsc, activeDesc }: { activeAsc: boolean; activeDesc: boolean }) {
  const dim = "var(--ws-text-vdim)";
  const hi = "var(--ws-text)";
  return (
    <span className="ml-0.5 inline-flex shrink-0 flex-col items-center justify-center leading-[0.65]" aria-hidden>
      <span style={{ fontSize: "7px", color: activeAsc ? hi : dim }}>▲</span>
      <span style={{ fontSize: "7px", color: activeDesc ? hi : dim }}>▼</span>
    </span>
  );
}

function EarningsSortTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align,
  thClassName = "",
  title: thTitle,
}: {
  label: ReactNode;
  col: EarningsSortKey;
  sortKey: EarningsSortKey;
  sortDir: SortDir;
  onSort: (k: EarningsSortKey) => void;
  align: "left" | "right";
  thClassName?: string;
  title?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      scope="col"
      title={thTitle}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-1.5 font-semibold ${align === "right" ? "text-right" : "text-left"} ${thClassName}`}
      style={{ color: "var(--ws-text-dim)" }}
      onClick={() => onSort(col)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(col);
        }
      }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className={`inline-flex w-full items-center gap-0.5 ${align === "right" ? "justify-end" : "justify-start"}`}>
        <span>{label}</span>
        <SortChevrons activeAsc={active && sortDir === "asc"} activeDesc={active && sortDir === "desc"} />
      </span>
    </th>
  );
}

function formatSurprise(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatDeltaPct(
  surprise: number | null,
  estimate: number | null,
  actual: number | null
): { text: string; title?: string } {
  if (surprise != null && Number.isFinite(surprise)) return { text: formatSurprise(surprise) };
  if (estimate != null && Number.isFinite(estimate) && (actual == null || !Number.isFinite(actual))) {
    return { text: "Pre", title: `Estimate ${estimate}; actual after release` };
  }
  return { text: "—" };
}

function surpriseStyle(pct: number | null): CSSProperties {
  if (pct == null || !Number.isFinite(pct)) return { color: "var(--ws-text-dim)" };
  if (pct >= 0) return { color: "var(--ws-green)" };
  return { color: "var(--ws-red)" };
}

function deltaCellStyle(surprise: number | null, label: string): CSSProperties {
  if (label === "Pre") return { color: "var(--ws-text-dim)" };
  return surpriseStyle(surprise);
}

function timeLabel(t: string | null): string {
  if (t === "bmo") return "BMO";
  if (t === "amc") return "AMC";
  if (t === "dmh") return "DMH";
  return "TBD";
}

function BucketTable({
  title,
  rows,
  sortKey,
  sortDir,
  onSortHeaderClick,
  onOpenTickerInLists,
}: {
  title: string;
  rows: EarningsCalendarPublic[];
  sortKey: EarningsSortKey;
  sortDir: SortDir;
  onSortHeaderClick: (k: EarningsSortKey) => void;
  onOpenTickerInLists?: (sym: string) => void;
}) {
  const sorted = useMemo(() => {
    if (!rows.length) return rows;
    const asc = sortDir === "asc";
    return [...rows].sort((a, b) => compareRows(a, b, sortKey, asc));
  }, [rows, sortKey, sortDir]);

  if (!rows.length) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
        No names in {title}.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
        {title}
      </h3>
      <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--ws-border)" }}>
        <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}>
              <EarningsSortTh label="Ticker" col="ticker" sortKey={sortKey} sortDir={sortDir} onSort={onSortHeaderClick} align="left" />
              <EarningsSortTh
                label="Name"
                col="company_name"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSortHeaderClick}
                align="left"
                thClassName="hidden sm:table-cell"
              />
              <EarningsSortTh label="When" col="when" sortKey={sortKey} sortDir={sortDir} onSort={onSortHeaderClick} align="left" />
              <EarningsSortTh
                label="Rev $"
                col="rev"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSortHeaderClick}
                align="right"
                thClassName="hidden sm:table-cell"
                title="Revenue actual: current quarter / prior quarter (when stored)"
              />
              <EarningsSortTh
                label="Rev Surprise"
                col="rev_surprise"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSortHeaderClick}
                align="right"
                title="vs consensus estimate"
              />
              <EarningsSortTh
                label="EPS $"
                col="eps"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSortHeaderClick}
                align="right"
                thClassName="hidden sm:table-cell"
                title="EPS actual: current quarter / prior quarter (when stored)"
              />
              <EarningsSortTh
                label="EPS Surprise"
                col="eps_surprise"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSortHeaderClick}
                align="right"
                title="vs consensus estimate"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const epsSurprise = formatDeltaPct(r.current_quarter_eps_surprise_pct, r.eps_estimate, r.eps_actual);
              const revSurprise = formatDeltaPct(r.current_quarter_rev_surprise_pct, r.revenue_estimate, r.revenue_actual);
              const revDollars = formatRevDollarPair(r.revenue_actual, r.prior_revenue_actual);
              const epsDollars = formatEpsDollarPair(r.eps_actual, r.prior_eps_actual);
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--ws-border)" }}>
                  <td className="px-2 py-1.5 font-medium">
                    {onOpenTickerInLists ? (
                      <button
                        type="button"
                        className="ws-focus-ring rounded font-medium underline-offset-2 hover:underline"
                        style={{ color: "var(--ws-text)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        onClick={() => onOpenTickerInLists(r.ticker)}
                      >
                        {r.ticker}
                      </button>
                    ) : (
                      <span style={{ color: "var(--ws-text)" }}>{r.ticker}</span>
                    )}
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-2 py-1.5 sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                    {r.company_name ?? "—"}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: "var(--ws-text-dim)" }}>
                    {timeLabel(r.report_time)}
                  </td>
                  <td
                    className="hidden whitespace-nowrap px-2 py-1.5 text-right tabular-nums sm:table-cell"
                    style={{ color: "var(--ws-text)" }}
                  >
                    {revDollars}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={deltaCellStyle(r.current_quarter_rev_surprise_pct, revSurprise.text)}
                    title={revSurprise.title}
                  >
                    {revSurprise.text}
                  </td>
                  <td
                    className="hidden whitespace-nowrap px-2 py-1.5 text-right tabular-nums sm:table-cell"
                    style={{ color: "var(--ws-text)" }}
                  >
                    {epsDollars}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={deltaCellStyle(r.current_quarter_eps_surprise_pct, epsSurprise.text)}
                    title={epsSurprise.title}
                  >
                    {epsSurprise.text}
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

const BUCKET_ORDER: EarningsCalendarBucket[] = ["yesterday", "today", "tomorrow"];

const BUCKET_TITLE: Record<EarningsCalendarBucket, string> = {
  yesterday: "Yesterday (ET)",
  today: "Today (ET)",
  tomorrow: "Tomorrow (ET)",
};

type EarningsCalendarProps = {
  onOpenTickerInLists?: (sym: string) => void;
};

export default function EarningsCalendar({ onOpenTickerInLists }: EarningsCalendarProps) {
  const [data, setData] = useState<EarningsCalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<EarningsSortKey>("ticker");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const onSortHeaderClick = useCallback(
    (key: EarningsSortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(defaultSortDir(key));
      }
    },
    [sortKey]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/earnings-calendar", { cache: "no-store" });
      const json = (await res.json()) as EarningsCalendarResponse & { error?: string };
      if (!res.ok) {
        setData(null);
        setError(json.error ?? res.statusText);
        return;
      }
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
        Loading earnings…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-relaxed" style={{ color: "var(--ws-text-dim)" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border px-2 py-1 text-xs font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
        Big names (&gt;$50B mcap) · anchor {data.anchor} ET
      </p>
      {BUCKET_ORDER.map((b) => (
        <BucketTable
          key={b}
          title={BUCKET_TITLE[b]}
          rows={data.buckets[b]}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortHeaderClick={onSortHeaderClick}
          onOpenTickerInLists={onOpenTickerInLists}
        />
      ))}
      <button
        type="button"
        onClick={() => void load()}
        className="rounded border px-2 py-1 text-xs font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)]"
        style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
      >
        Refresh
      </button>
    </div>
  );
}
