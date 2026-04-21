"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import type { EarningsCalendarBucket, EarningsCalendarPublic, EarningsCalendarResponse } from "@/types/earnings-calendar";

function formatSurprise(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Surprise % when actual exists; otherwise short hint when only estimates exist (pre-release). */
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

function BucketTable({ title, rows }: { title: string; rows: EarningsCalendarPublic[] }) {
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
        <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--ws-border)", background: "var(--ws-bg)" }}>
              <th className="px-2 py-1.5 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                Ticker
              </th>
              <th className="hidden px-2 py-1.5 font-semibold sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Name
              </th>
              <th className="px-2 py-1.5 font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                When
              </th>
              <th className="px-2 py-1.5 text-right font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                EPS Δ%
              </th>
              <th className="px-2 py-1.5 text-right font-semibold" style={{ color: "var(--ws-text-dim)" }}>
                Rev Δ%
              </th>
              <th className="hidden px-2 py-1.5 text-right font-semibold md:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Prior EPS
              </th>
              <th className="hidden px-2 py-1.5 text-right font-semibold lg:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                Prior Rev
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const epsCell = formatDeltaPct(
                r.current_quarter_eps_surprise_pct,
                r.eps_estimate,
                r.eps_actual
              );
              const revCell = formatDeltaPct(
                r.current_quarter_rev_surprise_pct,
                r.revenue_estimate,
                r.revenue_actual
              );
              return (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--ws-border)" }}>
                <td className="px-2 py-1.5 font-medium" style={{ color: "var(--ws-text)" }}>
                  {r.ticker}
                </td>
                <td className="hidden max-w-[10rem] truncate px-2 py-1.5 sm:table-cell" style={{ color: "var(--ws-text-dim)" }}>
                  {r.company_name ?? "—"}
                </td>
                <td className="px-2 py-1.5" style={{ color: "var(--ws-text-dim)" }}>
                  {timeLabel(r.report_time)}
                </td>
                <td
                  className="px-2 py-1.5 text-right tabular-nums"
                  style={deltaCellStyle(r.current_quarter_eps_surprise_pct, epsCell.text)}
                  title={epsCell.title}
                >
                  {epsCell.text}
                </td>
                <td
                  className="px-2 py-1.5 text-right tabular-nums"
                  style={deltaCellStyle(r.current_quarter_rev_surprise_pct, revCell.text)}
                  title={revCell.title}
                >
                  {revCell.text}
                </td>
                <td
                  className="hidden px-2 py-1.5 text-right tabular-nums md:table-cell"
                  style={surpriseStyle(r.prior_quarter_eps_surprise_pct)}
                >
                  {formatSurprise(r.prior_quarter_eps_surprise_pct)}
                </td>
                <td
                  className="hidden px-2 py-1.5 text-right tabular-nums lg:table-cell"
                  style={surpriseStyle(r.prior_quarter_rev_surprise_pct)}
                >
                  {formatSurprise(r.prior_quarter_rev_surprise_pct)}
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

export default function EarningsCalendar() {
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
        Big names · anchor {data.anchor} ET
      </p>
      {BUCKET_ORDER.map((b) => (
        <BucketTable key={b} title={BUCKET_TITLE[b]} rows={data.buckets[b]} />
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
