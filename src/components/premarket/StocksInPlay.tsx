"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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

const NEWS_PILL_MAX = 3;

function newsSourceLabel(it: PythonNewsItem): string {
  const pub = it.publisher?.trim();
  if (pub) return pub;
  const link = it.link?.trim();
  if (link) {
    try {
      const host = new URL(link).hostname.replace(/^www\./, "");
      const seg = host.split(".")[0];
      if (seg) return seg.charAt(0).toUpperCase() + seg.slice(1);
    } catch {
      /* ignore */
    }
  }
  return "News";
}

function SourceNewsPills({ items }: { items: PythonNewsItem[] }) {
  const slice = items.slice(0, NEWS_PILL_MAX);
  if (slice.length === 0) return null;
  return (
    <div className="mt-1 flex min-w-0 flex-wrap gap-1">
      {slice.map((it, i) => {
        const label = newsSourceLabel(it);
        const href = it.link?.trim();
        const title = it.title?.trim() || label;
        const baseClass =
          "pm-focus inline-flex max-w-[11rem] shrink-0 truncate rounded-full px-2 py-0.5 font-semibold no-underline shadow-[inset_0_0_0_1px_rgba(34,211,238,0.10)] transition-colors";
        const pillStyle: CSSProperties = {
          fontFamily: "var(--ws-font-sans)",
          fontSize: "var(--ws-fs-caption)",
          border: "1px solid rgba(34, 211, 238, 0.36)",
          background: "rgba(34, 211, 238, 0.12)",
          color: "var(--accent-cyan)",
        };
        if (href) {
          return (
            <a
              key={`${href}-${i}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${baseClass} cursor-pointer hover:border-[var(--accent-cyan)] hover:bg-[rgba(34,211,238,0.20)] hover:text-[var(--text-primary)]`}
              style={pillStyle}
              title={title}
            >
              {label}
            </a>
          );
        }
        return (
          <span key={i} className={`${baseClass} cursor-default opacity-80`} style={pillStyle} title={title}>
            {label}
          </span>
        );
      })}
    </div>
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
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={refreshSip}
          disabled={loading || !filtersHydrated}
          className="pm-focus shrink-0 rounded border px-2 py-1 font-medium transition-opacity disabled:opacity-50"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
            fontFamily: "var(--ws-font-sans)",
            fontSize: "var(--ws-fs-label)",
          }}
        >
          {loading ? "Loading…" : "Refresh SIP"}
        </button>
      </div>

      {!filtersHydrated ? (
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          Loading gapper filters…
        </p>
      ) : null}

      {sessionNeedsManualRefresh ? (
        <p className="pm-site-caption rounded border px-2 py-1.5 leading-snug" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
          SIP list is empty in this tab after reload — click <strong style={{ color: "var(--text-primary)" }}>Refresh SIP</strong>.
        </p>
      ) : null}

      {!pythonConfigured ? (
        <p className="pm-site-caption rounded border px-2 py-1.5 leading-snug" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
          Headlines off until <code className="pm-mono">PYTHON_SERVICE_URL</code> / <code className="pm-mono">PYTHON_SERVICE_KEY</code> are set.
        </p>
      ) : null}

      {newsError ? (
        <p className="pm-site-caption rounded border px-2 py-1.5" role="alert" style={{ borderColor: "var(--border-default)", color: "var(--negative)" }}>
          Headlines request failed: {newsError}
        </p>
      ) : null}

      {catalystSkipped ? (
        <p className="pm-site-caption rounded border px-2 py-1.5 leading-snug" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
          Catalyst summaries skipped without <code className="pm-mono">ANTHROPIC_API_KEY</code>.
        </p>
      ) : null}

      {catalystError ? (
        <p className="pm-site-caption rounded border px-2 py-1.5" role="alert" style={{ borderColor: "var(--border-default)", color: "var(--negative)" }}>
          Catalyst generation failed: {catalystError}
        </p>
      ) : null}

      {error ? (
        <div className="rounded border px-3 py-2.5" role="alert" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
          <p className="pm-site-prose font-semibold" style={{ color: "var(--text-primary)" }}>
            Could not load Stocks in Play
          </p>
          <p className="pm-site-caption mt-1" style={{ color: "var(--text-secondary)" }}>
            {error}
          </p>
        </div>
      ) : null}

      {loading && !rows?.length ? (
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          Loading gappers, headlines, and catalysts…
        </p>
      ) : null}

      {!error && rows && rows.length === 0 && !loading ? (
        <p className="pm-site-prose" style={{ color: "var(--text-secondary)" }}>
          No names passed the SIP volume + headline gates (or market is closed / no pre-market data).
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--border-default)" }}>
            <div
              className="pm-sip-col-head grid min-w-[52rem] gap-x-2 gap-y-0 border-b px-2 py-1.5"
              style={{
                gridTemplateColumns: "4.5rem 4rem 5rem 5rem minmax(7rem,1.4fr) minmax(6rem,1fr)",
                borderColor: "var(--border-default)",
                background: "var(--bg-inset)",
                color: "var(--text-tertiary)",
              }}
            >
              <span>TKR</span>
              <span className="text-right">GAP%</span>
              <span className="text-right">MCAP</span>
              <span className="text-right">PM VOL</span>
              <span>CATALYST</span>
              <span>TYPE</span>
            </div>
            {rows.map((r) => {
              const cat = catalyst?.[r.ticker];
              const badge = cat ? sipCatalystBadge(cat) : null;
              const rationale = cat ? truncateSipRationale(cat.summary) : "—";
              const rowNews = news?.[r.ticker] ?? [];
              const showNewsEmpty =
                news !== null && pythonConfigured && !newsError && rowNews.length === 0;
              return (
                <div
                  key={r.ticker}
                  className="grid min-w-[52rem] items-start gap-x-2 gap-y-1 border-b px-2 py-1.5"
                  style={{
                    gridTemplateColumns: "4.5rem 4rem 5rem 5rem minmax(7rem,1.4fr) minmax(6rem,1fr)",
                    borderColor: "var(--border-default)",
                    background: "var(--bg-panel)",
                  }}
                >
                  <div className="pm-site-caption font-semibold" style={{ color: "var(--text-primary)" }}>
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
                  <div className="pm-mono text-right tabular-nums" style={{ color: r.gapPct >= 0 ? "var(--positive)" : "var(--negative)", fontSize: "var(--ws-fs-caption)" }}>
                    {fmtPct(r.gapPct)}
                  </div>
                  <div className="pm-mono text-right tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--ws-fs-caption)" }}>
                    {formatScreenerCompact(r.marketCap)}
                  </div>
                  <div className="pm-mono text-right tabular-nums" style={{ color: "var(--text-secondary)", fontSize: "var(--ws-fs-caption)" }}>
                    {formatScreenerCompact(r.pmVolume)}
                  </div>
                  <div className="pm-site-caption min-w-0 leading-snug" style={{ color: "var(--text-secondary)" }}>
                    <p className="m-0" title={cat?.summary}>
                      {rationale}
                    </p>
                    {rowNews.length > 0 ? (
                      <SourceNewsPills items={rowNews} />
                    ) : showNewsEmpty ? (
                      <p className="pm-site-caption m-0 mt-1" style={{ color: "var(--text-faint)" }}>
                        No headlines in window.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {badge ? (
                      <span
                        className={`rounded px-1 py-px font-semibold uppercase ${badge.className}`}
                        style={{
                          fontFamily: "var(--ws-font-sans)",
                          fontSize: "var(--ws-fs-caption)",
                          letterSpacing: "var(--letter-tight)",
                        }}
                      >
                        {badge.label}
                      </span>
                    ) : (
                      <span className="pm-site-caption" style={{ color: "var(--text-faint)" }}>
                        —
                      </span>
                    )}
                    {r.earningsRecent24h ? (
                      <span
                        className="rounded px-1 py-px uppercase"
                        style={{
                          fontFamily: "var(--ws-font-sans)",
                          fontSize: "var(--ws-fs-caption)",
                          border: "1px solid var(--accent-purple)",
                          color: "var(--accent-purple)",
                        }}
                      >
                        24h ER
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="pm-site-caption flex flex-wrap items-center justify-between gap-2 border-t pt-2"
            style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)" }}
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
