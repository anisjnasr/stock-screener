"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarningsCalendarBucket, EarningsCalendarPublic, EarningsCalendarResponse } from "@/types/earnings-calendar";

type EarningsSortKey = "ticker" | "name" | "eps" | "rev";
type SortDir = "asc" | "desc";

function defaultEarningsSortDir(k: EarningsSortKey): SortDir {
  return k === "eps" || k === "rev" ? "desc" : "asc";
}

function compareEarningsRows(a: EarningsCalendarPublic, b: EarningsCalendarPublic, key: EarningsSortKey, asc: boolean): number {
  const mul = asc ? 1 : -1;
  switch (key) {
    case "ticker": {
      const d = a.ticker.localeCompare(b.ticker);
      return mul * d;
    }
    case "name": {
      const an = (a.company_name ?? "").trim() || "\uffff";
      const bn = (b.company_name ?? "").trim() || "\uffff";
      const d = an.localeCompare(bn);
      return mul * d;
    }
    case "eps":
    case "rev": {
      const pa = key === "eps" ? a.current_quarter_eps_surprise_pct : a.current_quarter_rev_surprise_pct;
      const pb = key === "eps" ? b.current_quarter_eps_surprise_pct : b.current_quarter_rev_surprise_pct;
      const na = pa == null || !Number.isFinite(pa);
      const nb = pb == null || !Number.isFinite(pb);
      if (na && nb) return a.ticker.localeCompare(b.ticker);
      if (na) return 1;
      if (nb) return -1;
      const d = pa! - pb!;
      if (d !== 0) return mul * d;
      return a.ticker.localeCompare(b.ticker);
    }
    default:
      return 0;
  }
}

function SortChevrons({ activeAsc, activeDesc }: { activeAsc: boolean; activeDesc: boolean }) {
  const dim = "var(--text-tertiary)";
  const hi = "var(--text-primary)";
  return (
    <span className="ml-0.5 inline-flex shrink-0 flex-col items-center justify-center leading-[0.65]" aria-hidden>
      <span style={{ fontSize: "10px", color: activeAsc ? hi : dim }}>▲</span>
      <span style={{ fontSize: "10px", color: activeDesc ? hi : dim }}>▼</span>
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
  className: thClass,
}: {
  label: ReactNode;
  col: EarningsSortKey;
  sortKey: EarningsSortKey;
  sortDir: SortDir;
  onSort: (k: EarningsSortKey) => void;
  align: "left" | "right";
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      scope="col"
      className={`pm-sip-col-head cursor-pointer select-none py-0.5 ${align === "right" ? "pl-1 text-right" : "pr-1 text-left"} ${thClass ?? ""}`}
      style={{ color: "var(--text-tertiary)" }}
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

const BUCKET_ORDER: EarningsCalendarBucket[] = ["yesterday", "today", "tomorrow"];

const BUCKET_TITLE: Record<EarningsCalendarBucket, string> = {
  yesterday: "Yesterday",
  today: "Today",
  tomorrow: "Tomorrow",
};

function slotKey(t: string | null): "bmo" | "amc" | "dmh" {
  if (t === "bmo" || t === "amc" || t === "dmh") return t;
  return "dmh";
}

function sign(x: number | null): number | null {
  if (x == null || !Number.isFinite(x)) return null;
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}

function earningsPillKind(r: EarningsCalendarPublic): "beat" | "miss" | "mixed" | "upcoming" {
  const se = sign(r.current_quarter_eps_surprise_pct);
  const sr = sign(r.current_quarter_rev_surprise_pct);
  if (se === null && sr === null) {
    return "upcoming";
  }
  if (se === null) {
    return sr! >= 0 ? "beat" : "miss";
  }
  if (sr === null) {
    return se >= 0 ? "beat" : "miss";
  }
  if (se >= 0 && sr >= 0) return "beat";
  if (se < 0 && sr < 0) return "miss";
  return "mixed";
}

function pillClass(kind: ReturnType<typeof earningsPillKind>): string {
  switch (kind) {
    case "beat":
      return "earn-pill-beat";
    case "miss":
      return "earn-pill-miss";
    case "mixed":
      return "earn-pill-mixed";
    default:
      return "earn-pill-upcoming";
  }
}

function fmtSurprisePct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const signStr = p > 0 ? "+" : "";
  return `${signStr}${p.toFixed(1)}%`;
}

function surpriseTextColor(p: number | null): string {
  const s = sign(p);
  if (s == null || s === 0) return "var(--text-tertiary)";
  return s > 0 ? "var(--positive)" : "var(--negative)";
}

function TickerPillButton({
  row,
  showSlotTag,
  onOpenTickerInLists,
}: {
  row: EarningsCalendarPublic;
  showSlotTag: boolean;
  onOpenTickerInLists?: (sym: string) => void;
}) {
  const kind = earningsPillKind(row);
  const cls = pillClass(kind);
  const slot = row.report_time === "bmo" ? "BMO" : row.report_time === "amc" ? "AMC" : "DMH";
  const inner = (
    <>
      <span className="pm-mono font-semibold">{row.ticker}</span>
      {showSlotTag ? (
        <span className="pm-site-caption ml-1 opacity-80">
          {slot}
        </span>
      ) : null}
    </>
  );
  if (onOpenTickerInLists) {
    return (
      <button
        type="button"
        className={`pm-focus inline-flex max-w-full min-w-0 items-center rounded-full px-1.5 py-px ${cls}`}
        style={{ fontSize: "var(--ws-fs-caption)", fontFamily: "var(--ws-font-sans)" }}
        onClick={() => onOpenTickerInLists(row.ticker)}
      >
        {inner}
      </button>
    );
  }
  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center rounded-full px-1.5 py-px ${cls}`}
      style={{ fontSize: "var(--ws-fs-caption)", fontFamily: "var(--ws-font-sans)" }}
    >
      {inner}
    </span>
  );
}

function CompactEarningsTable({
  rows,
  showSlotTag,
  onOpenTickerInLists,
}: {
  rows: EarningsCalendarPublic[];
  showSlotTag: boolean;
  onOpenTickerInLists?: (sym: string) => void;
}) {
  const [sortKey, setSortKey] = useState<EarningsSortKey>("ticker");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const onSortHeaderClick = useCallback(
    (key: EarningsSortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(defaultEarningsSortDir(key));
      }
    },
    [sortKey]
  );

  const sortedRows = useMemo(() => {
    if (!rows.length) return rows;
    const asc = sortDir === "asc";
    return [...rows].sort((a, b) => compareEarningsRows(a, b, sortKey, asc));
  }, [rows, sortKey, sortDir]);

  if (!rows.length) {
    return (
      <p className="pm-site-caption m-0 py-1" style={{ color: "var(--text-tertiary)" }}>
        —
      </p>
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="pm-site-caption w-full min-w-0 border-collapse" style={{ color: "var(--text-secondary)" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
            <EarningsSortTh label="Ticker" col="ticker" sortKey={sortKey} sortDir={sortDir} onSort={onSortHeaderClick} align="left" />
            <EarningsSortTh
              label="Name"
              col="name"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSortHeaderClick}
              align="left"
              className="max-w-[7rem]"
            />
            <EarningsSortTh label="EPS Surprise" col="eps" sortKey={sortKey} sortDir={sortDir} onSort={onSortHeaderClick} align="right" />
            <EarningsSortTh label="Rev Surprise" col="rev" sortKey={sortKey} sortDir={sortDir} onSort={onSortHeaderClick} align="right" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: "var(--border-default)" }}>
              <td className="py-0.5 pr-1 align-middle">
                <TickerPillButton row={r} showSlotTag={showSlotTag} onOpenTickerInLists={onOpenTickerInLists} />
              </td>
              <td
                className="pm-site-caption max-w-[7rem] truncate py-0.5 pr-1 align-middle"
                style={{ color: "var(--text-secondary)" }}
                title={r.company_name ?? undefined}
              >
                {r.company_name ?? "—"}
              </td>
              <td
                className="pm-mono whitespace-nowrap py-0.5 pl-1 pr-1 text-right align-middle tabular-nums"
                style={{ color: surpriseTextColor(r.current_quarter_eps_surprise_pct) }}
              >
                {fmtSurprisePct(r.current_quarter_eps_surprise_pct)}
              </td>
              <td
                className="pm-mono whitespace-nowrap py-0.5 pl-1 text-right align-middle tabular-nums"
                style={{ color: surpriseTextColor(r.current_quarter_rev_surprise_pct) }}
              >
                {fmtSurprisePct(r.current_quarter_rev_surprise_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayBucketBlock({
  bucket,
  rows,
  onOpenTickerInLists,
}: {
  bucket: EarningsCalendarBucket;
  rows: EarningsCalendarPublic[];
  onOpenTickerInLists?: (sym: string) => void;
}) {
  const { bmo, amc, dmh } = useMemo(() => {
    const bmo: EarningsCalendarPublic[] = [];
    const amc: EarningsCalendarPublic[] = [];
    const dmh: EarningsCalendarPublic[] = [];
    for (const r of rows) {
      const sk = slotKey(r.report_time);
      if (sk === "bmo") bmo.push(r);
      else if (sk === "amc") amc.push(r);
      else dmh.push(r);
    }
    return { bmo, amc, dmh };
  }, [rows]);

  return (
    <div
      className="rounded border px-2 py-2"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
    >
      <h3 className="pm-section-label mb-2" style={{ color: "var(--text-primary)" }}>
        {BUCKET_TITLE[bucket]}
      </h3>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <p
            className="pm-site-caption m-0 font-semibold"
            style={{ color: "var(--text-secondary)", letterSpacing: "0.02em" }}
          >
            Before market open
          </p>
          <CompactEarningsTable rows={bmo} showSlotTag={false} onOpenTickerInLists={onOpenTickerInLists} />
          {dmh.length > 0 ? (
            <div className="border-t pt-2" style={{ borderColor: "var(--border-default)" }}>
              <p
                className="pm-site-caption mb-1 font-semibold"
                style={{ color: "var(--text-secondary)", letterSpacing: "0.02em" }}
              >
                During market
              </p>
              <CompactEarningsTable rows={dmh} showSlotTag onOpenTickerInLists={onOpenTickerInLists} />
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <p
            className="pm-site-caption mb-1 font-semibold"
            style={{ color: "var(--text-secondary)", letterSpacing: "0.02em" }}
          >
            After market close
          </p>
          <CompactEarningsTable rows={amc} showSlotTag={false} onOpenTickerInLists={onOpenTickerInLists} />
        </div>
      </div>
    </div>
  );
}

type EarningsCalendarProps = {
  onOpenTickerInLists?: (sym: string) => void;
};

export default function EarningsCalendar({ onOpenTickerInLists }: EarningsCalendarProps) {
  const [data, setData] = useState<EarningsCalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
        Loading earnings…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus rounded border px-2 py-1 font-medium"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-label)",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-3">
      <div
        className="pm-site-caption flex flex-wrap gap-2 rounded border px-2 py-1.5"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-panel)" }}
      >
        <span className="earn-pill-beat rounded-full px-2 py-0.5">Beat</span>
        <span className="earn-pill-miss rounded-full px-2 py-0.5">Miss</span>
        <span className="earn-pill-mixed rounded-full px-2 py-0.5">Mixed</span>
        <span className="earn-pill-upcoming rounded-full px-2 py-0.5">Upcoming</span>
      </div>

      <div className="flex flex-col gap-4">
        {BUCKET_ORDER.map((b) => (
          <DayBucketBlock key={b} bucket={b} rows={data.buckets[b]} onOpenTickerInLists={onOpenTickerInLists} />
        ))}
      </div>

      <div
        className="pm-site-caption flex flex-wrap items-center justify-end gap-2 border-t pt-2"
        style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)" }}
      >
        <button
          type="button"
          onClick={() => void load()}
          className="pm-focus rounded border px-2 py-1 font-medium"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-label)",
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
