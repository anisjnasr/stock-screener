"use client";

import { useState, useEffect } from "react";
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

type MarketLeftTab = "indices" | "monitor";

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM"];

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtVol(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function fmtCap(n: number | null): string {
  if (n == null) return "—";
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
        setQuotes(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (!cancelled) setQuotes([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-[11px]" style={{ color: "var(--ws-text)" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--ws-border)" }}>
            <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--ws-text-dim)" }}>Symbol</th>
            <th className="text-right px-2 py-1.5 font-medium" style={{ color: "var(--ws-text-dim)" }}>Last</th>
            <th className="text-right px-2 py-1.5 font-medium" style={{ color: "var(--ws-text-dim)" }}>Change</th>
            <th className="text-right px-2 py-1.5 font-medium" style={{ color: "var(--ws-text-dim)" }}>Volume</th>
            <th className="text-right px-2 py-1.5 font-medium" style={{ color: "var(--ws-text-dim)" }}>Mkt Cap</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="px-2 py-3 text-center" style={{ color: "var(--ws-text-vdim)" }}>Loading…</td></tr>
          ) : quotes.length === 0 ? (
            <tr><td colSpan={5} className="px-2 py-3 text-center" style={{ color: "var(--ws-text-vdim)" }}>No data</td></tr>
          ) : (
            quotes.map((q) => {
              const isSelected = selectedSymbol?.toUpperCase() === q.symbol;
              const changePct = q.change_pct;
              return (
                <tr
                  key={q.symbol}
                  className="cursor-pointer transition-colors"
                  style={{
                    background: isSelected ? "var(--ws-bg3)" : "transparent",
                    borderBottom: "1px solid var(--ws-border)",
                  }}
                  onClick={() => onSymbolSelect?.(q.symbol)}
                >
                  <td className="px-2 py-1.5 font-mono font-medium">{q.symbol}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtPrice(q.last_price)}</td>
                  <td
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={{ color: changePct != null && changePct >= 0 ? "var(--ws-green)" : "var(--ws-red)" }}
                  >
                    {fmtPct(changePct)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtVol(q.volume)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtCap(q.market_cap)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketLeftPanel({
  onSymbolSelect,
  selectedSymbol,
}: {
  onSymbolSelect?: (sym: string) => void;
  selectedSymbol?: string;
}) {
  const [tab, setTab] = useState<MarketLeftTab>("indices");

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--ws-bg2)" }}>
      {/* Tab pills */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1.5" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        {([
          { id: "indices" as MarketLeftTab, label: "Indices" },
          { id: "monitor" as MarketLeftTab, label: "Market Monitor" },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="px-2 py-0.5 text-[10px] font-medium rounded transition-colors"
            style={{
              background: tab === t.id ? "var(--ws-cyan)" : "transparent",
              color: tab === t.id ? "var(--ws-bg)" : "var(--ws-text-dim)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "indices" ? (
        <IndicesTable onSymbolSelect={onSymbolSelect} selectedSymbol={selectedSymbol} />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <MarketMonitorTable />
        </div>
      )}
    </div>
  );
}
