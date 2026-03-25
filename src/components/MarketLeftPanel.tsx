"use client";

import { useEffect, useState } from "react";
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

/** Shape returned by GET /api/watchlist-quotes */
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

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return `$${n.toFixed(2)}`;
}

/** `0` is valid (flat day / stale quote); only nullish or non-finite shows em dash. */
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

function fmtCap(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  return fmtVol(n);
}

function IndicesTable({
  onSymbolSelect,
  selectedSymbol,
}: {
  onSymbolSelect?: (sym: string) => void;
  selectedSymbol?: string;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex-1 overflow-auto">
      <table
        className="w-full border-collapse text-[10px] leading-tight"
        style={{ color: "var(--ws-text)", border: "1px solid var(--ws-border)" }}
      >
        <thead>
          <tr style={{ background: "var(--ws-bg3)", borderBottom: "1px solid var(--ws-border)" }}>
            <th className="text-left px-1.5 py-0.5 font-medium border-r border-[var(--ws-border)]" style={{ color: "var(--ws-text-dim)" }}>Symbol</th>
            <th className="text-right px-1.5 py-0.5 font-medium border-r border-[var(--ws-border)]" style={{ color: "var(--ws-text-dim)" }}>Last</th>
            <th className="text-right px-1.5 py-0.5 font-medium border-r border-[var(--ws-border)]" style={{ color: "var(--ws-text-dim)" }}>Change</th>
            <th className="text-right px-1.5 py-0.5 font-medium border-r border-[var(--ws-border)]" style={{ color: "var(--ws-text-dim)" }}>Volume</th>
            <th className="text-right px-1.5 py-0.5 font-medium" style={{ color: "var(--ws-text-dim)" }}>Mkt Cap</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="px-1.5 py-2 text-center border-t border-[var(--ws-border)]" style={{ color: "var(--ws-text-vdim)" }}>Loading…</td></tr>
          ) : quotes.length === 0 ? (
            <tr><td colSpan={5} className="px-1.5 py-2 text-center border-t border-[var(--ws-border)]" style={{ color: "var(--ws-text-vdim)" }}>No data</td></tr>
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
              return (
                <tr
                  key={q.symbol}
                  className="cursor-pointer transition-colors border-b border-[var(--ws-border)]"
                  style={{
                    background: isSelected ? "var(--ws-bg3)" : "transparent",
                  }}
                  onClick={() => onSymbolSelect?.(q.symbol)}
                >
                  <td className="px-1.5 py-0.5 font-mono font-medium border-r border-[var(--ws-border)]">{q.symbol}</td>
                  <td className="px-1.5 py-0.5 text-right tabular-nums border-r border-[var(--ws-border)]">{fmtPrice(q.last_price)}</td>
                  <td
                    className="px-1.5 py-0.5 text-right tabular-nums border-r border-[var(--ws-border)]"
                    style={{ color: changeColor }}
                  >
                    {fmtPct(ch)}
                  </td>
                  <td className="px-1.5 py-0.5 text-right tabular-nums border-r border-[var(--ws-border)]">{fmtVol(q.volume)}</td>
                  <td className="px-1.5 py-0.5 text-right tabular-nums">{fmtCap(q.market_cap)}</td>
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
