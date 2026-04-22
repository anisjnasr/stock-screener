"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GapperRow, GappersRequestBody } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import type { SipCatalyst, SipCatalystCategory } from "@/types/sip-catalyst";
import { gapperFilterStateToRequestBody, type GapperFilterState } from "@/components/premarket/gapper-filters-storage";
import { formatScreenerCompact } from "@/components/premarket/premarket-number-display";
import { ymdInEt } from "@/lib/et-ymd";

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

function catalystBadgeStyle(category: SipCatalystCategory): { label: string; background: string; color: string } {
  const map: Record<SipCatalystCategory, { label: string; background: string; color: string }> = {
    earnings: { label: "Earnings", background: "rgba(6, 182, 212, 0.15)", color: "#22d3ee" },
    guidance: { label: "Guidance", background: "rgba(20, 184, 166, 0.15)", color: "#2dd4bf" },
    m_and_a: { label: "M&A", background: "rgba(168, 85, 247, 0.15)", color: "#c084fc" },
    partnership: { label: "Partnership", background: "rgba(139, 92, 246, 0.15)", color: "#a78bfa" },
    product: { label: "Product", background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" },
    regulatory: { label: "Regulatory", background: "rgba(245, 158, 11, 0.12)", color: "#fbbf24" },
    analyst: { label: "Analyst", background: "rgba(251, 146, 60, 0.12)", color: "#fb923c" },
    macro_sector: { label: "Sector", background: "rgba(148, 163, 184, 0.12)", color: "#94a3b8" },
    other: { label: "Other", background: "rgba(100, 116, 139, 0.12)", color: "#94a3b8" },
    unclear: { label: "Unclear", background: "rgba(71, 85, 105, 0.2)", color: "#64748b" },
  };
  return map[category];
}

function CatalystBlock({ c }: { c: SipCatalyst }) {
  const b = catalystBadgeStyle(c.category);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span style={{ background: b.background, color: b.color }} className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {b.label}
        </span>
        {c.guidance_tone ? (
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
            Guidance: {c.guidance_tone}
          </span>
        ) : null}
        <span className="text-[10px] tabular-nums" style={{ color: "var(--ws-text-vdim)" }}>
          {c.confidence} confidence
        </span>
      </div>
      <p className="text-[11px] leading-snug sm:text-xs" style={{ color: "var(--ws-text)" }}>
        {c.summary}
      </p>
    </div>
  );
}

function NewsList({ items }: { items: PythonNewsItem[] }) {
  const slice = items.slice(0, 4);
  if (slice.length === 0) {
    return <span style={{ color: "var(--ws-text-vdim)" }}>No headlines in window.</span>;
  }
  return (
    <ul className="list-inside list-disc space-y-1 pl-0.5 text-[11px] leading-snug" style={{ color: "var(--ws-text-dim)" }}>
      {slice.map((it, i) => (
        <li key={i} className="marker:text-[var(--ws-text-vdim)]">
          {it.link ? (
            <a
              href={it.link}
              target="_blank"
              rel="noopener noreferrer"
              className="ws-focus-ring rounded underline-offset-2 hover:underline"
              style={{ color: "var(--ws-text)" }}
            >
              {it.title}
            </a>
          ) : (
            <span style={{ color: "var(--ws-text)" }}>{it.title}</span>
          )}
          {it.publisher ? (
            <span className="ml-1 tabular-nums" style={{ color: "var(--ws-text-vdim)" }}>
              · {it.publisher}
            </span>
          ) : null}
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
  /** True when localStorage says today’s first auto-load already ran but this tab has no rows (e.g. full reload). */
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

  /** First expand per America/New_York calendar day auto-fetches; later expands same day rely on cache in memory or manual refresh. */
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
    setSessionNeedsManualRefresh(
      typeof window !== "undefined" && window.localStorage.getItem(SIP_FIRST_AUTO_YMD_KEY) === t
    );
  }, [collapsed, filtersHydrated, rows, loading, error]);

  const refreshSip = useCallback(() => {
    const ac = new AbortController();
    void load(ac.signal, gapperFilterStateToRequestBody(filtersRef.current));
  }, [load]);

  if (collapsed) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[10px] leading-snug" style={{ color: "var(--ws-text-dim)" }}>
          Top <strong style={{ color: "var(--ws-text)" }}>8</strong> names by gap % from the same TradingView scan as{" "}
          <strong style={{ color: "var(--ws-text)" }}>Pre-market gappers</strong> (Top Movers). The section auto-loads once
          per day on first expand (US Eastern date); after that use <strong style={{ color: "var(--ws-text)" }}>Refresh SIP</strong>{" "}
          (e.g. after changing gappers filters). Headlines need{" "}
          <code className="rounded bg-[color:var(--ws-bg)] px-0.5">PYTHON_SERVICE_URL</code> /{" "}
          <code className="rounded bg-[color:var(--ws-bg)] px-0.5">PYTHON_SERVICE_KEY</code>. Catalyst blurbs need{" "}
          <code className="rounded bg-[color:var(--ws-bg)] px-0.5">ANTHROPIC_API_KEY</code> on the server.
        </p>
        <button
          type="button"
          onClick={refreshSip}
          disabled={loading || !filtersHydrated}
          className="shrink-0 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors ws-focus-ring hover:bg-[color:var(--ws-hover)] disabled:opacity-50"
          style={{ borderColor: "var(--ws-border)", color: "var(--ws-text)" }}
        >
          {loading ? "Loading…" : "Refresh SIP"}
        </button>
      </div>

      {!filtersHydrated ? (
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>
          Loading gapper filters…
        </p>
      ) : null}

      {sessionNeedsManualRefresh ? (
        <p className="rounded border px-2 py-1.5 text-[11px] leading-snug" style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}>
          SIP list is empty in this tab (e.g. after a full reload). Today&apos;s first auto-load already ran — click{" "}
          <strong style={{ color: "var(--ws-text)" }}>Refresh SIP</strong> to fetch up to 8 names again.
        </p>
      ) : null}

      {!pythonConfigured ? (
        <p className="rounded border px-2 py-1.5 text-[11px] leading-snug" style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}>
          Headlines are off until the StockStalker host has Python service env vars configured (see <code className="px-0.5">.env.example</code>).
        </p>
      ) : null}

      {newsError ? (
        <p className="rounded border px-2 py-1.5 text-[11px]" role="alert" style={{ borderColor: "var(--ws-border)", color: "#e05a5a" }}>
          Headlines request failed: {newsError}
        </p>
      ) : null}

      {catalystSkipped ? (
        <p className="rounded border px-2 py-1.5 text-[11px] leading-snug" style={{ borderColor: "var(--ws-border)", color: "var(--ws-text-dim)" }}>
          Catalyst summaries are off without <code className="px-0.5">ANTHROPIC_API_KEY</code> (headlines still work when Python is configured).
        </p>
      ) : null}

      {catalystError ? (
        <p className="rounded border px-2 py-1.5 text-[11px]" role="alert" style={{ borderColor: "var(--ws-border)", color: "#e05a5a" }}>
          Catalyst generation failed: {catalystError}
        </p>
      ) : null}

      {error ? (
        <div
          className="rounded border px-3 py-2.5 text-sm leading-relaxed"
          role="alert"
          style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg)" }}
        >
          <p className="font-semibold" style={{ color: "var(--ws-text)" }}>
            Could not load Stocks in Play
          </p>
          <p className="mt-1" style={{ color: "var(--ws-text-dim)" }}>
            {error}
          </p>
        </div>
      ) : null}

      {loading && !rows?.length ? (
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>
          Loading gappers, headlines, and catalysts…
        </p>
      ) : null}

      {!error && rows && rows.length === 0 && !loading ? (
        <p className="text-sm" style={{ color: "var(--ws-text-dim)" }}>
          No rows match the SIP filters (or market is closed / no pre-market data).
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.ticker}
              className="rounded border px-2.5 py-2"
              style={{
                borderColor: "var(--ws-border)",
                background: "var(--ws-bg)",
                boxShadow: r.earningsRecent24h ? "inset 3px 0 0 0 #9d6fd4" : undefined,
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {onOpenTickerInLists ? (
                  <button
                    type="button"
                    className="font-mono text-sm font-semibold ws-focus-ring rounded underline-offset-2 hover:underline"
                    style={{ color: "var(--ws-text)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                    onClick={() => onOpenTickerInLists(r.ticker)}
                  >
                    {r.ticker}
                  </button>
                ) : (
                  <span className="font-mono text-sm font-semibold" style={{ color: "var(--ws-text)" }}>
                    {r.ticker}
                  </span>
                )}
                <span className="font-mono text-xs tabular-nums" style={{ color: r.gapPct >= 0 ? "#5bbd6e" : "#e05a5a" }}>
                  {fmtPct(r.gapPct)}
                </span>
                <span className="text-[11px]" style={{ color: "var(--ws-text-dim)" }}>
                  {r.companyName ?? "—"} · PM vol {formatScreenerCompact(r.pmVolume)} · M cap {formatScreenerCompact(r.marketCap)}
                </span>
                {r.earningsRecent24h ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#c4a7e7" }}>
                    Earnings 24h
                  </span>
                ) : null}
              </div>
              {catalyst && catalyst[r.ticker] ? (
                <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--ws-border)" }}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--ws-text-dim)" }}>
                    Catalyst
                  </p>
                  <CatalystBlock c={catalyst[r.ticker]!} />
                </div>
              ) : null}
              <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--ws-border)" }}>
                {news && news[r.ticker] ? (
                  <NewsList items={news[r.ticker]!} />
                ) : pythonConfigured && !newsError ? (
                  <span style={{ color: "var(--ws-text-vdim)" }}>No headlines for this symbol.</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
