"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GapperRow, GappersRequestBody } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import type { SipCatalyst } from "@/types/sip-catalyst";
import { gapperFilterStateToRequestBody, type GapperFilterState } from "@/components/premarket/gapper-filters-storage";
import { formatScreenerCompact } from "@/components/premarket/premarket-number-display";
import { ymdInEt } from "@/lib/et-ymd";
import { truncateSipRationale } from "@/lib/premarket/sip-rationale-truncate";
import { sipCatalystBadge } from "@/components/premarket/sip-badge-map";

const SIP_FIRST_AUTO_YMD_KEY = "premarket-sip-first-auto-ymd";

type StocksInPlayProps = {
  collapsed: boolean;
  gapperFilters: GapperFilterState;
  filtersHydrated: boolean;
  onOpenTickerInLists?: (sym: string) => void;
};

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function NewsCompact({ items }: { items: PythonNewsItem[] }) {
  const slice = items.slice(0, 3);
  if (slice.length === 0) {
    return <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-9)" }}>No headlines in window.</span>;
  }
  return (
    <ul className="m-0 list-none space-y-0.5 p-0" style={{ fontSize: "var(--fs-9)", color: "var(--text-secondary)" }}>
      {slice.map((it, i) => (
        <li key={i} className="truncate">
          {it.link ? (
            <a
              href={it.link}
              target="_blank"
              rel="noopener noreferrer"
              className="pm-focus rounded underline-offset-2 hover:underline"
              style={{ color: "var(--text-primary)" }}
            >
              {it.title}
            </a>
          ) : (
            <span>{it.title}</span>
          )}
          {it.publisher ? <span style={{ color: "var(--text-tertiary)" }}> · {it.publisher}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export default function StocksInPlay({ collapsed, gapperFilters, filtersHydrated, onOpenTickerInLists }: StocksInPlayProps) {
  const [rows, setRows] = useState<GapperRow[] | null>(null);
  const [news, setNews] = useState<Record<string, PythonNewsItem[]> | null>(null);
  const [catalyst, setCatalyst] = useState<Record<string, SipCatalyst> | null>(null);
  const [catalystError, setCatalystError] = useState<string | null>(null);
  const [catalystSkipped, setCatalystSkipped] = useState(false);
  const [pythonConfigured, setPythonConfigured] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionNeedsManualRefresh, setSessionNeedsManualRefresh] = useState(false);
  const filtersRef = useRef(gapperFilters);
  filtersRef.current = gapperFilters;

  const load = useCallback(async (signal: AbortSignal, scanBody: GappersRequestBody): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setNewsError(null);
    setCatalystError(null);
    try {
      const res = await fetch("/api/premarket/stocks-in-play", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(scanBody),
        cache: "no-store",
        signal,
      });
      const json = (await res.json()) as StocksInPlaySuccess | { ok?: false; error?: string };
      if (!res.ok || !json.ok) {
        setRows(null);
        setNews(null);
        setCatalyst(null);
        setCatalystSkipped(false);
        setPythonConfigured(false);
        setError((json as { error?: string }).error ?? res.statusText);
        return false;
      }
      setRows(json.rows);
      setNews(json.news);
      setCatalyst(json.catalyst);
      setCatalystError(json.catalystError ?? null);
      setCatalystSkipped(Boolean(json.catalystSkipped));
      setPythonConfigured(json.pythonConfigured);
      setNewsError(json.newsError ?? null);
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      setRows(null);
      setNews(null);
      setCatalyst(null);
      setCatalystSkipped(false);
      setError(e instanceof Error ? e.message : "Failed to load");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (collapsed || !filtersHydrated) return;
    const todayYmd = ymdInEt();
    if (typeof window !== "undefined" && window.localStorage.getItem(SIP_FIRST_AUTO_YMD_KEY) === todayYmd) {
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    void (async () => {
      const ok = await load(ac.signal, gapperFilterStateToRequestBody(filtersRef.current));
      if (cancelled || !ok) return;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIP_FIRST_AUTO_YMD_KEY, ymdInEt());
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [collapsed, filtersHydrated, load]);

  useEffect(() => {
    if (collapsed || !filtersHydrated) {
      setSessionNeedsManualRefresh(false);
      return;
    }
    if (rows != null || loading || error) {
      setSessionNeedsManualRefresh(false);
      return;
    }
    const t = ymdInEt();
    setSessionNeedsManualRefresh(typeof window !== "undefined" && window.localStorage.getItem(SIP_FIRST_AUTO_YMD_KEY) === t);
  }, [collapsed, filtersHydrated, rows, loading, error]);

  const refreshSip = useCallback(() => {
    const ac = new AbortController();
    void load(ac.signal, gapperFilterStateToRequestBody(filtersRef.current));
  }, [load]);

  if (collapsed) {
    return null;
  }

  const n = rows?.length ?? 0;
  const nowEt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 leading-snug" style={{ color: "var(--text-tertiary)", fontSize: "var(--fs-9)" }}>
          Up to <strong style={{ color: "var(--text-primary)" }}>75</strong> names after volume pre-filter (|gap| ≥ 2%, PM vol ≥ 100k &amp; ≥ 20% of 90d ADV) plus LLM
          headline checks (company-specific story + fresh within 24h). Auto-loads once per ET day on first expand; use refresh after filter changes. Headlines need Python
          service env; classification needs{" "}
          <code className="pm-mono rounded px-0.5" style={{ background: "var(--bg-base)" }}>
            ANTHROPIC_API_KEY
          </code>{" "}
          on the host.
        </p>
        <button
          type="button"
          onClick={refreshSip}
          disabled={loading || !filtersHydrated}
          className="pm-focus shrink-0 rounded border px-2 py-1 font-medium uppercase tracking-[var(--letter-label)] transition-opacity disabled:opacity-50"
          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)", fontSize: "var(--fs-9)" }}
        >
          {loading ? "Loading…" : "Refresh SIP"}
        </button>
      </div>

      {!filtersHydrated ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-11)" }}>Loading gapper filters…</p>
      ) : null}

      {sessionNeedsManualRefresh ? (
        <p className="rounded border px-2 py-1.5 leading-snug" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)", fontSize: "var(--fs-10)" }}>
          SIP list is empty in this tab after reload — click <strong style={{ color: "var(--text-primary)" }}>Refresh SIP</strong>.
        </p>
      ) : null}

      {!pythonConfigured ? (
        <p className="rounded border px-2 py-1.5 leading-snug" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)", fontSize: "var(--fs-10)" }}>
          Headlines off until <code className="pm-mono">PYTHON_SERVICE_URL</code> / <code className="pm-mono">PYTHON_SERVICE_KEY</code> are set.
        </p>
      ) : null}

      {newsError ? (
        <p className="rounded border px-2 py-1.5" role="alert" style={{ borderColor: "var(--border-default)", color: "var(--negative)", fontSize: "var(--fs-10)" }}>
          Headlines request failed: {newsError}
        </p>
      ) : null}

      {catalystSkipped ? (
        <p className="rounded border px-2 py-1.5 leading-snug" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)", fontSize: "var(--fs-10)" }}>
          Catalyst summaries skipped without <code className="pm-mono">ANTHROPIC_API_KEY</code>.
        </p>
      ) : null}

      {catalystError ? (
        <p className="rounded border px-2 py-1.5" role="alert" style={{ borderColor: "var(--border-default)", color: "var(--negative)", fontSize: "var(--fs-10)" }}>
          Catalyst generation failed: {catalystError}
        </p>
      ) : null}

      {error ? (
        <div className="rounded border px-3 py-2.5" role="alert" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
          <p className="font-semibold" style={{ color: "var(--text-primary)", fontSize: "var(--fs-11)" }}>
            Could not load Stocks in Play
          </p>
          <p className="mt-1" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-10)" }}>
            {error}
          </p>
        </div>
      ) : null}

      {loading && !rows?.length ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-11)" }}>Loading gappers, headlines, and catalysts…</p>
      ) : null}

      {!error && rows && rows.length === 0 && !loading ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--fs-11)" }}>
          No names passed the SIP volume + headline gates (or market is closed / no pre-market data).
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--border-default)" }}>
            <div
              className="pm-mono grid min-w-[52rem] gap-x-2 gap-y-0 border-b px-2 py-1.5 font-semibold uppercase tracking-[var(--letter-label)]"
              style={{
                gridTemplateColumns: "4.5rem 4rem 5rem 5rem minmax(7rem,1.4fr) minmax(6rem,1fr)",
                borderColor: "var(--border-default)",
                background: "var(--bg-inset)",
                fontSize: "var(--fs-8)",
                color: "var(--text-tertiary)",
              }}
            >
              <span>TKR</span>
              <span className="text-right">GAP%</span>
              <span className="text-right">MCAP</span>
              <span className="text-right">PM VOL</span>
              <span>RATIONALE</span>
              <span>CATALYST</span>
            </div>
            {rows.map((r) => {
              const cat = catalyst?.[r.ticker];
              const badge = cat ? sipCatalystBadge(cat) : null;
              const rationale = cat ? truncateSipRationale(cat.summary) : "—";
              return (
                <div
                  key={r.ticker}
                  className="pm-mono grid min-w-[52rem] items-start gap-x-2 gap-y-1 border-b px-2 py-1.5"
                  style={{
                    gridTemplateColumns: "4.5rem 4rem 5rem 5rem minmax(7rem,1.4fr) minmax(6rem,1fr)",
                    borderColor: "var(--border-default)",
                    background: "var(--bg-panel)",
                    fontSize: "var(--fs-10)",
                  }}
                >
                  <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {onOpenTickerInLists ? (
                      <button
                        type="button"
                        className="pm-focus rounded underline-offset-2 hover:underline"
                        style={{ color: "inherit", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        onClick={() => onOpenTickerInLists(r.ticker)}
                      >
                        {r.ticker}
                      </button>
                    ) : (
                      r.ticker
                    )}
                  </div>
                  <div className="text-right tabular-nums" style={{ color: r.gapPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {fmtPct(r.gapPct)}
                  </div>
                  <div className="text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {formatScreenerCompact(r.marketCap)}
                  </div>
                  <div className="text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {formatScreenerCompact(r.pmVolume)}
                  </div>
                  <div className="min-w-0 leading-snug" style={{ color: "var(--text-secondary)" }} title={cat?.summary}>
                    {rationale}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {badge ? (
                      <span className={`rounded px-1 py-px font-semibold uppercase ${badge.className}`} style={{ fontSize: "var(--fs-8)", letterSpacing: "var(--letter-tight)" }}>
                        {badge.label}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-9)" }}>—</span>
                    )}
                    {r.earningsRecent24h ? (
                      <span
                        className="rounded px-1 py-px uppercase"
                        style={{ fontSize: "var(--fs-8)", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)" }}
                      >
                        24h ER
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded border px-2 py-1.5" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
            <p className="mb-1 font-semibold uppercase tracking-[var(--letter-label)]" style={{ fontSize: "var(--fs-8)", color: "var(--text-tertiary)" }}>
              Headlines
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <div key={`n-${r.ticker}`} className="min-w-0 border-t pt-1 sm:border-t-0 sm:border-l sm:pl-2 sm:pt-0 first:border-t-0 first:pt-0 first:sm:border-l-0 first:sm:pl-0" style={{ borderColor: "var(--border-default)" }}>
                  <div className="pm-mono font-semibold" style={{ fontSize: "var(--fs-9)", color: "var(--accent-cyan)" }}>
                    {r.ticker}
                  </div>
                  {news && news[r.ticker] ? <NewsCompact items={news[r.ticker]!} /> : pythonConfigured && !newsError ? (
                    <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-9)" }}>No headlines.</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
            style={{ borderColor: "var(--border-default)", fontSize: "var(--fs-9)", color: "var(--text-tertiary)" }}
          >
            <span>
              {n} of 75 max · updated {nowEt} ET
            </span>
            <span className="text-right">Scheduled refresh: 7:00–9:00 AM ET weekdays (macro slot)</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
