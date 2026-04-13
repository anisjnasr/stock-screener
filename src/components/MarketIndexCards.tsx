"use client";

import { useEffect, useState } from "react";
import { fetchBreadthClient } from "@/lib/breadth-client";

export const MARKET_INDEX_SYMBOLS = ["SPY", "QQQ", "IWM"] as const;
export type MarketIndexSymbol = (typeof MARKET_INDEX_SYMBOLS)[number];

type Quote = {
  symbol: string;
  last_price: number | null;
  change_pct: number | null;
  volume: number | null;
  avg_volume_30d_shares: number | null;
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

const SYMBOL_TO_BREADTH_INDEX: Record<string, "sp500" | "nasdaq"> = {
  SPY: "sp500",
  QQQ: "nasdaq",
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
  };
}

function normalizeWatchlistQuotesPayload(data: unknown): Quote[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => quoteFromWatchlistApiItem(raw as WatchlistQuotesApiItem));
}

/** Display price as `$ 682.45` (space after $). */
function fmtPriceDisplay(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return `$ ${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0.00%";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Session volume ÷ 30d average volume. */
function computeRvol(volume: number | null, avgVolume: number | null): number | null {
  if (volume == null || avgVolume == null || !Number.isFinite(volume) || !Number.isFinite(avgVolume) || avgVolume <= 0) {
    return null;
  }
  const r = volume / avgVolume;
  return Number.isFinite(r) ? r : null;
}

function fmtRvol(r: number | null): string {
  if (r == null || !Number.isFinite(r)) return "—";
  return r.toFixed(2);
}

type RvolVisual = { color: string; fontWeight?: number };

/** &lt;0.7 weak (red/amber) · 0.7–1.5 neutral · &gt;1.5 strong green · &gt;2 bold “institutional” */
function rvolStyle(rvol: number | null): RvolVisual {
  if (rvol == null || !Number.isFinite(rvol)) {
    return { color: "var(--ws-text-dim)" };
  }
  if (rvol < 0.45) {
    return { color: "var(--ws-red)" };
  }
  if (rvol < 0.7) {
    return { color: "var(--ws-amber)" };
  }
  if (rvol <= 1.5) {
    return { color: "var(--ws-text)" };
  }
  if (rvol <= 2) {
    return { color: "var(--ws-green)" };
  }
  return { color: "var(--ws-green)", fontWeight: 700 };
}

function fmtBreadth(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function breadthColor(v: number | null): string {
  if (v == null) return "var(--ws-text-vdim)";
  if (v > 45) return "var(--ws-text)";
  if (v >= 25) return "var(--ws-amber)";
  return "var(--ws-red)";
}

type BreadthMap = Record<string, { pct50: number | null; pct200: number | null }>;

export default function MarketIndexCards({
  indexCardSelection,
  onCardClick,
}: {
  indexCardSelection: MarketIndexSymbol | null;
  onCardClick: (sym: MarketIndexSymbol) => void;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [breadthMap, setBreadthMap] = useState<BreadthMap>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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

  useEffect(() => {
    let cancelled = false;
    const indices = Object.entries(SYMBOL_TO_BREADTH_INDEX);
    Promise.all(
      indices.map(([sym, indexId]) =>
        fetchBreadthClient(indexId, { includeNetNewHighs: false })
          .then((d) => {
            if (!d) return [sym, { pct50: null, pct200: null }] as const;
            const pts = d.breadth ?? [];
            const ld = d.latestDate ?? null;
            const match = ld ? pts.find((p) => p.date === ld) : undefined;
            const last = match ?? (pts.length > 0 ? pts[pts.length - 1] : undefined);
            return [sym, { pct50: last?.pctAbove50d ?? null, pct200: last?.pctAbove200d ?? null }] as const;
          })
          .catch(() => [sym, { pct50: null, pct200: null }] as const)
      )
    ).then((results) => {
      if (cancelled) return;
      setBreadthMap(Object.fromEntries(results));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const quoteBySymbol = Object.fromEntries(quotes.map((q) => [q.symbol, q])) as Record<string, Quote | undefined>;

  return (
    <div
      className="shrink-0 min-w-max flex flex-col items-center px-2 sm:px-4 py-3 border-b"
      style={{ borderColor: "var(--ws-border)", background: "var(--ws-bg2)" }}
    >
      <div className="flex min-w-max flex-nowrap items-stretch justify-center gap-2 sm:gap-3 overflow-x-auto">
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
            const b = breadthMap[sym];
            const showBreadth = sym === "SPY" || sym === "QQQ";
            const isSelected = indexCardSelection === sym;

            const rvol = computeRvol(q?.volume ?? null, q?.avg_volume_30d_shares ?? null);
            const rvolVis = rvolStyle(rvol);

            return (
              <button
                key={sym}
                type="button"
                onClick={() => onCardClick(sym)}
                className={`rounded-lg px-3 py-2.5 text-center w-max shrink-0 transition-[background-color,border-color,box-shadow] duration-100 ws-focus-ring ${
                  isSelected
                    ? "border border-[color:var(--ws-cyan)] bg-[rgba(0,229,204,0.12)] shadow-[inset_0_0_0_1px_rgba(0,229,204,0.15)] hover:bg-[rgba(0,229,204,0.18)]"
                    : "border border-[color:var(--ws-border)] bg-[var(--ws-bg3)] hover:bg-[var(--ws-hover)]"
                }`}
                aria-pressed={isSelected}
              >
                <div className="flex items-baseline justify-center gap-2 sm:gap-3 whitespace-nowrap">
                  <span className="font-mono font-semibold text-base" style={{ color: "var(--ws-cyan)" }}>
                    {sym}
                  </span>
                  <span className="tabular-nums text-sm font-normal leading-snug" style={{ color: "var(--ws-text)" }}>
                    {fmtPriceDisplay(q?.last_price ?? null)}
                  </span>
                  <span className="tabular-nums text-sm font-normal leading-snug" style={{ color: changeColor }}>
                    {fmtPct(ch)}
                  </span>
                </div>
                <div
                  className="mt-2 flex flex-nowrap items-center justify-center gap-x-2 tabular-nums text-sm leading-snug whitespace-nowrap"
                  style={{ color: "var(--ws-text-dim)" }}
                >
                  <span>
                    <span>RVOL </span>
                    <span
                      className="tabular-nums"
                      style={{ color: rvolVis.color, fontWeight: rvolVis.fontWeight }}
                    >
                      {fmtRvol(rvol)}
                    </span>
                  </span>
                  {showBreadth && (
                    <>
                      <span className="opacity-60" aria-hidden>
                        ·
                      </span>
                      <span>
                        &gt;50D{" "}
                        <span style={{ color: breadthColor(b?.pct50 ?? null) }}>{fmtBreadth(b?.pct50 ?? null)}</span>
                      </span>
                      <span className="opacity-60" aria-hidden>
                        ·
                      </span>
                      <span>
                        &gt;200D{" "}
                        <span style={{ color: breadthColor(b?.pct200 ?? null) }}>{fmtBreadth(b?.pct200 ?? null)}</span>
                      </span>
                    </>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
