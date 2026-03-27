"use client";

import { useEffect, useState, useCallback } from "react";
import MarketMonitorTable from "@/components/MarketMonitorTable";

type Quote = {
  symbol: string;
  last_price: number | null;
  change_pct: number | null;
  volume: number | null;
  avg_volume_30d_shares: number | null;
  market_cap: number | null;
  atr_pct_21d: number | null;
};

type WatchlistQuotesApiItem = {
  symbol: string;
  quote: {
    price?: number;
    changesPercentage?: number;
    volume?: number;
    marketCap?: number;
    avgVolume?: number;
  } | null;
  profile?: { mktCap?: number } | null;
};

type BreadthPoint = {
  date: string;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
};

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function quoteFromWatchlistApiItem(item: WatchlistQuotesApiItem): Quote {
  const q = item.quote;
  return {
    symbol: item.symbol,
    last_price: numOrNull(q?.price),
    change_pct: numOrNull(q?.changesPercentage),
    volume: numOrNull(q?.volume),
    avg_volume_30d_shares: numOrNull(q?.avgVolume),
    market_cap: numOrNull(q?.marketCap ?? item.profile?.mktCap),
    atr_pct_21d: null,
  };
}

function normalizeWatchlistQuotesPayload(data: unknown): Quote[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => quoteFromWatchlistApiItem(raw as WatchlistQuotesApiItem));
}

type MarketLeftTab = "indices" | "monitor";

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM"];

const SYMBOL_TO_BREADTH_INDEX: Record<string, string> = {
  SPY: "sp500",
  QQQ: "nasdaq",
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0.00%";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtVol(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function fmtBreadth(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

type BreadthMap = Record<string, { pct50: number | null; pct200: number | null }>;

function IndicesTable({
  onSymbolSelect,
  selectedSymbol,
}: {
  onSymbolSelect?: (sym: string) => void;
  selectedSymbol?: string;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [breadthMap, setBreadthMap] = useState<BreadthMap>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/watchlist-quotes?symbols=${INDEX_SYMBOLS.join(",")}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setQuotes(normalizeWatchlistQuotesPayload(data));
      })
      .catch(() => { if (!cancelled) setQuotes([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const indices = Object.entries(SYMBOL_TO_BREADTH_INDEX);
    Promise.all(
      indices.map(([sym, indexId]) =>
        fetch(`/api/breadth?index=${indexId}`)
          .then((r) => r.json())
          .then((d: { breadth?: BreadthPoint[] }) => {
            const pts = d.breadth ?? [];
            const last = pts[pts.length - 1];
            return [sym, { pct50: last?.pctAbove50d ?? null, pct200: last?.pctAbove200d ?? null }] as const;
          })
          .catch(() => [sym, { pct50: null, pct200: null }] as const)
      )
    ).then((results) => {
      if (cancelled) return;
      setBreadthMap(Object.fromEntries(results));
    });
    return () => { cancelled = true; };
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (quotes.length === 0) return;
      const curIdx = quotes.findIndex((q) => q.symbol === selectedSymbol?.toUpperCase());
      const nextIdx = e.key === "ArrowDown"
        ? Math.min(quotes.length - 1, (curIdx < 0 ? 0 : curIdx + 1))
        : Math.max(0, (curIdx < 0 ? 0 : curIdx - 1));
      if (nextIdx === curIdx) return;
      e.preventDefault();
      onSymbolSelect?.(quotes[nextIdx].symbol);
    },
    [quotes, selectedSymbol, onSymbolSelect]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const COL_STYLE = "px-2 py-[6px]";
  const HDR_STYLE: React.CSSProperties = { color: "var(--ws-text-dim)" };

  return (
    <div className="flex-1 overflow-auto">
      <table
        className="border-collapse whitespace-nowrap"
        style={{ color: "var(--ws-text)", fontSize: 13, lineHeight: "1.4", minWidth: "max-content" }}
      >
        <thead className="sticky top-0 z-10" style={{ background: "var(--ws-bg3)", borderBottom: "1px solid var(--ws-border)" }}>
          <tr>
            <th className={`text-left ${COL_STYLE} font-medium text-xs`} style={HDR_STYLE}>Symbol</th>
            <th className={`text-right ${COL_STYLE} font-medium text-xs`} style={HDR_STYLE}>Price</th>
            <th className={`text-right ${COL_STYLE} font-medium text-xs`} style={HDR_STYLE}>Change %</th>
            <th className={`text-right ${COL_STYLE} font-medium text-xs`} style={HDR_STYLE}>Volume</th>
            <th className={`text-right ${COL_STYLE} font-medium text-xs`} style={HDR_STYLE}>Avg Vol</th>
            <th className={`text-right ${COL_STYLE} font-medium text-xs`} style={HDR_STYLE}>&gt; 50D</th>
            <th className={`text-right ${COL_STYLE} font-medium text-xs`} style={HDR_STYLE}>&gt; 200D</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="px-2 py-3 text-center" style={{ color: "var(--ws-text-vdim)" }}>Loading…</td></tr>
          ) : quotes.length === 0 ? (
            <tr><td colSpan={7} className="px-2 py-3 text-center" style={{ color: "var(--ws-text-vdim)" }}>No data</td></tr>
          ) : (
            quotes.map((q) => {
              const isSelected = selectedSymbol?.toUpperCase() === q.symbol;
              const ch = q.change_pct;
              const hasChange = ch != null && Number.isFinite(ch);
              const changeColor = !hasChange
                ? "var(--ws-text-dim)"
                : ch > 0
                  ? "var(--ws-green)"
                  : ch < 0
                    ? "var(--ws-red)"
                    : "var(--ws-text-dim)";
              const b = breadthMap[q.symbol];
              return (
                <tr
                  key={q.symbol}
                  className="cursor-pointer transition-colors"
                  style={{
                    background: isSelected ? "rgba(0,229,204,0.08)" : "transparent",
                    borderBottom: "1px solid var(--ws-border)",
                  }}
                  onClick={() => onSymbolSelect?.(q.symbol)}
                >
                  <td className={`${COL_STYLE} font-mono font-medium`} style={{ color: "var(--ws-cyan)" }}>{q.symbol}</td>
                  <td className={`${COL_STYLE} text-right tabular-nums`}>{fmtPrice(q.last_price)}</td>
                  <td className={`${COL_STYLE} text-right tabular-nums`} style={{ color: changeColor }}>{fmtPct(ch)}</td>
                  <td className={`${COL_STYLE} text-right tabular-nums`}>{fmtVol(q.volume)}</td>
                  <td className={`${COL_STYLE} text-right tabular-nums`}>{fmtVol(q.avg_volume_30d_shares)}</td>
                  <td className={`${COL_STYLE} text-right tabular-nums`}>{fmtBreadth(b?.pct50 ?? null)}</td>
                  <td className={`${COL_STYLE} text-right tabular-nums`}>{fmtBreadth(b?.pct200 ?? null)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export type { MarketLeftTab };

export default function MarketLeftPanel({
  onSymbolSelect,
  selectedSymbol,
  activeTab = "indices",
}: {
  onSymbolSelect?: (sym: string) => void;
  selectedSymbol?: string;
  activeTab?: MarketLeftTab;
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      {activeTab === "indices" ? (
        <IndicesTable onSymbolSelect={onSymbolSelect} selectedSymbol={selectedSymbol} />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <MarketMonitorTable />
        </div>
      )}
    </div>
  );
}
