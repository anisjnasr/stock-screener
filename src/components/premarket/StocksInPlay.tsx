"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GapperRow, GappersRequestBody } from "@/types/gappers";
import type { PythonNewsItem } from "@/lib/python-service";
import type { StocksInPlaySuccess } from "@/types/stocks-in-play";
import { gapperFilterStateToRequestBody, type GapperFilterState } from "@/components/premarket/gapper-filters-storage";
import { formatScreenerCompact } from "@/components/premarket/premarket-number-display";

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
  const [pythonConfigured, setPythonConfigured] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const filtersRef = useRef(gapperFilters);
  filtersRef.current = gapperFilters;

  const load = useCallback(async (signal: AbortSignal, scanBody: GappersRequestBody) => {
    setLoading(true);
    setError(null);
    setNewsError(null);
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
        setPythonConfigured(false);
        setError((json as { error?: string }).error ?? res.statusText);
        return;
      }
      setRows(json.rows);
      setNews(json.news);
      setPythonConfigured(json.pythonConfigured);
      setNewsError(json.newsError ?? null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setRows(null);
      setNews(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (collapsed || !filtersHydrated) return;
    const ac = new AbortController();
    void load(ac.signal, gapperFilterStateToRequestBody(filtersRef.current));
    return () => ac.abort();
  }, [collapsed, filtersHydrated, load]);

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
          Same TradingView scan as <strong style={{ color: "var(--ws-text)" }}>Pre-market gappers</strong> in Top Movers
          (passive sync: collapse and reopen this section, or use Refresh SIP, after you change gappers filters). Headlines
          need{" "}
          <code className="rounded bg-[color:var(--ws-bg)] px-0.5">PYTHON_SERVICE_URL</code> /{" "}
          <code className="rounded bg-[color:var(--ws-bg)] px-0.5">PYTHON_SERVICE_KEY</code> on the server.
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
          Loading gappers and headlines…
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
