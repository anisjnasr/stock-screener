"use client";

import { useEffect, useState } from "react";

export const MARKET_INDEX_SYMBOLS = ["SPY", "QQQ", "IWM"] as const;
export type MarketIndexSymbol = (typeof MARKET_INDEX_SYMBOLS)[number];

type Quote = {
  symbol: string;
  change_pct: number | null;
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

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function quoteFromWatchlistApiItem(item: WatchlistQuotesApiItem): Quote {
  const q = item.quote;
  return {
    symbol: item.symbol,
    change_pct: numOrNull(q?.changesPercentage),
  };
}

function normalizeWatchlistQuotesPayload(data: unknown): Quote[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => quoteFromWatchlistApiItem(raw as WatchlistQuotesApiItem));
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0.00%";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function MarketIndexCards({
  indexCardSelection,
  onCardClick,
}: {
  indexCardSelection: MarketIndexSymbol | null;
  onCardClick: (sym: MarketIndexSymbol) => void;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/watchlist-quotes?symbols=${MARKET_INDEX_SYMBOLS.join(",")}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setQuotes(normalizeWatchlistQuotesPayload(data));
      })
      .catch(() => {
        if (!cancelled) setQuotes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const quoteBySymbol = Object.fromEntries(quotes.map((q) => [q.symbol, q])) as Record<string, Quote | undefined>;

  return (
    <div
      className="shrink-0 min-w-max flex flex-col items-center px-1.5 sm:px-3 py-2 border-b"
      style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg2)" }}
    >
      <div className="flex min-w-max flex-nowrap items-stretch justify-center gap-1.5 sm:gap-2 overflow-x-auto mx-auto max-w-full">
        {loading ? (
          <span className="text-sm" style={{ color: "var(--ws-text-vdim)" }}>
            Loading indices…
          </span>
        ) : (
          MARKET_INDEX_SYMBOLS.map((sym) => {
            const q = quoteBySymbol[sym];
            const ch = q?.change_pct ?? null;
            const hasChange = ch != null && Number.isFinite(ch);
            const chNum = hasChange ? (ch as number) : 0;
            const changeColor = !hasChange
              ? "var(--ws-text-dim)"
              : chNum > 0
                ? "var(--ws-green)"
                : chNum < 0
                  ? "var(--ws-red)"
                  : "var(--ws-text-dim)";
            const isSelected = indexCardSelection === sym;

            return (
              <button
                key={sym}
                type="button"
                onClick={() => onCardClick(sym)}
                className={`w-[8.5rem] shrink-0 cursor-pointer rounded-md px-2 py-1 transition-[background-color,border-color,box-shadow] duration-100 ws-focus-ring sm:w-[9rem] ${
                  isSelected
                    ? "border border-[color:var(--ws-cyan)] bg-[rgba(0,229,204,0.12)] shadow-[inset_0_0_0_1px_rgba(0,229,204,0.15)] hover:bg-[rgba(0,229,204,0.18)]"
                    : "border border-[color:var(--ws-border)] bg-[var(--ws-bg3)] hover:bg-[var(--ws-hover)]"
                }`}
                aria-pressed={isSelected}
              >
                <div className="grid w-full grid-cols-2 items-baseline justify-items-center gap-x-2 whitespace-nowrap tabular-nums leading-tight">
                  <span
                    className="font-mono font-semibold text-ws-title text-xs sm:text-sm tracking-tight text-center min-w-0"
                    style={{ color: "var(--ws-cyan)" }}
                  >
                    {sym}
                  </span>
                  <span className="text-ws-caption font-normal text-center min-w-0" style={{ color: changeColor }}>
                    {fmtPct(ch)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
