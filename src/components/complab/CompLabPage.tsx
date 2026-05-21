"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import CompLabGrid from "@/components/complab/CompLabGrid";
import CompLabReferenceDateField from "@/components/complab/CompLabReferenceDateField";
import CompLabTickerSearch from "@/components/complab/CompLabTickerSearch";
import { buildCompLabDateContext } from "@/components/complab/CompLabSetupChart";
import type { CompLabComp } from "@/lib/complab/comp-lab-comps";
import type { CompLabCandle } from "@/lib/complab/chart-series";
import { ymdInEt } from "@/lib/et-ymd";
import {
  loadCompLabSession,
  saveCompLabSession,
} from "@/lib/complab/comp-lab-session-storage";
import { isSelectableReferenceDate } from "@/lib/complab/reference-dates";

const CompLabSetupChart = dynamic(() => import("@/components/complab/CompLabSetupChart"), {
  ssr: false,
  loading: () => (
    <div
      className="min-h-[400px] w-full rounded border"
      style={{ borderColor: "var(--ws-border)", background: "#292b31" }}
    />
  ),
});

type LoadedStock = {
  symbol: string;
  companyName: string;
};

function resolveCompanyName(
  symbol: string,
  quote?: { name?: string; companyName?: string },
  profile?: { companyName?: string; name?: string }
): string {
  const sym = symbol.toUpperCase();
  const candidates = [profile?.companyName, profile?.name, quote?.companyName, quote?.name];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.toUpperCase() !== sym) return trimmed;
  }
  return sym;
}

type PagePhase = "empty" | "loaded";

async function loadStock(symbol: string): Promise<LoadedStock> {
  const res = await fetch(`/api/init?symbol=${encodeURIComponent(symbol)}`);
  const data = (await res.json().catch(() => null)) as {
    stock?: {
      quote?: { symbol?: string; name?: string; companyName?: string };
      profile?: { companyName?: string; name?: string };
    };
    error?: string;
  } | null;

  if (!res.ok) {
    throw new Error(data?.error || `Could not load ${symbol}`);
  }

  const quote = data?.stock?.quote;
  const profile = data?.stock?.profile;
  const sym = (quote?.symbol || symbol).toUpperCase();
  const companyName = resolveCompanyName(sym, quote, profile);

  return { symbol: sym, companyName };
}

async function loadCandles(symbol: string): Promise<CompLabCandle[]> {
  const res = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=daily`);
  const data = (await res.json().catch(() => null)) as CompLabCandle[] | { error?: string };
  if (!res.ok || !Array.isArray(data)) return [];
  return data;
}

async function loadComps(ticker: string, referenceDate: string): Promise<CompLabComp[]> {
  const res = await fetch("/api/complab/comps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, reference_date: referenceDate }),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    comps?: CompLabComp[];
    error?: string;
  } | null;
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "Could not load comps");
  }
  return Array.isArray(data.comps) ? data.comps : [];
}

/** Comp Lab workspace — calibration UI for the Comp Engine. */
export default function CompLabPage() {
  const [phase, setPhase] = useState<PagePhase>("empty");
  const [stock, setStock] = useState<LoadedStock | null>(null);
  const [candles, setCandles] = useState<CompLabCandle[] | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [referenceDate, setReferenceDate] = useState<string | null>(null);
  const [comps, setComps] = useState<CompLabComp[]>([]);
  const [compsLoading, setCompsLoading] = useState(false);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const dateContext = useMemo(() => buildCompLabDateContext(candles), [candles]);

  useLayoutEffect(() => {
    const session = loadCompLabSession(ymdInEt());
    if (session) {
      setStock({ symbol: session.ticker, companyName: session.companyName });
      setPhase("loaded");
      if (session.referenceDate) setReferenceDate(session.referenceDate);
      void loadStock(session.ticker)
        .then((next) => {
          setStock(next);
          saveCompLabSession({
            version: 1,
            sessionDateEt: ymdInEt(),
            ticker: next.symbol,
            companyName: next.companyName,
            referenceDate: session.referenceDate,
          });
        })
        .catch(() => {});
    }
    setHydrated(true);
  }, []);

  const persistSession = useCallback((nextStock: LoadedStock, nextReferenceDate: string | null) => {
    saveCompLabSession({
      version: 1,
      sessionDateEt: ymdInEt(),
      ticker: nextStock.symbol,
      companyName: nextStock.companyName,
      referenceDate: nextReferenceDate,
    });
  }, []);

  const loadStockWorkspace = useCallback(async (symbol: string, restoredReferenceDate?: string | null) => {
    setChartLoading(true);
    setCandles(null);
    setComps([]);
    setCompsError(null);
    try {
      const bars = await loadCandles(symbol);
      setCandles(bars);
      const ctx = buildCompLabDateContext(bars);
      if (restoredReferenceDate && ctx && isSelectableReferenceDate(restoredReferenceDate, ctx)) {
        setReferenceDate(restoredReferenceDate);
      } else {
        setReferenceDate(null);
      }
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!stock?.symbol || phase !== "loaded") return;
    void loadStockWorkspace(stock.symbol, referenceDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload chart when ticker changes only
  }, [stock?.symbol, phase]);

  const handleTickerSubmit = useCallback(
    async (rawSymbol: string) => {
      const symbol = rawSymbol.trim().toUpperCase();
      if (!symbol) return;

      setLoading(true);
      setError(null);
      setReferenceDate(null);
      setComps([]);
      setCompsError(null);
      try {
        const next = await loadStock(symbol);
        setStock(next);
        setPhase("loaded");
        persistSession(next, null);
        await loadStockWorkspace(symbol, null);
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not load ${symbol}`);
      } finally {
        setLoading(false);
      }
    },
    [loadStockWorkspace, persistSession]
  );

  const handleReferenceDateChange = useCallback(
    (date: string | null) => {
      setReferenceDate(date);
      setComps([]);
      setCompsError(null);
      if (stock) persistSession(stock, date);
    },
    [persistSession, stock]
  );

  useEffect(() => {
    if (!stock?.symbol || !referenceDate) {
      setComps([]);
      setCompsError(null);
      setCompsLoading(false);
      return;
    }

    let cancelled = false;
    setCompsLoading(true);
    setCompsError(null);
    void loadComps(stock.symbol, referenceDate)
      .then((rows) => {
        if (cancelled) return;
        setComps(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setComps([]);
        setCompsError(e instanceof Error ? e.message : "Could not load comps");
      })
      .finally(() => {
        if (!cancelled) setCompsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [referenceDate, stock?.symbol]);

  const searchLoaded = phase === "loaded";

  if (!hydrated) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col overflow-auto"
        style={{ background: "var(--ws-bg2)" }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto"
      style={{ background: "var(--ws-bg2)" }}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-5 shrink-0">
          <h1
            className="text-ws-title text-lg font-semibold uppercase tracking-wider sm:text-xl"
            style={{ color: "var(--ws-cyan)" }}
          >
            Comp Lab
          </h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--ws-text-dim)" }}>
            Calibration and research tool for the Comp Engine.
          </p>
        </header>

        <div className="mb-5 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          <CompLabTickerSearch
            autoFocus={phase === "empty"}
            loading={loading}
            resetAfterSubmit={searchLoaded}
            showSearchIcon={searchLoaded}
            placeholder={searchLoaded ? "Search" : "Ticker"}
            onSubmit={(sym) => {
              void handleTickerSubmit(sym);
            }}
            className="w-full max-w-[9.33rem] shrink-0 sm:max-w-[11rem]"
          />
          {stock && searchLoaded && (
            <div className="min-w-0 flex items-baseline gap-2 text-sm">
              <span className="font-semibold" style={{ color: "var(--ws-text)" }}>
                {stock.symbol}
              </span>
              {stock.companyName && stock.companyName.toUpperCase() !== stock.symbol ? (
                <span className="font-normal truncate min-w-0" style={{ color: "var(--ws-text-dim)" }}>
                  {stock.companyName}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {error && (
          <p className="mb-4 text-xs" style={{ color: "var(--ws-red, #f87171)" }} role="alert">
            {error}
          </p>
        )}

        {phase === "empty" ? (
          <p className="max-w-xl text-sm" style={{ color: "var(--ws-text)" }}>
            Search a ticker to study historical comps and rate match quality.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5">
            {stock && (
              <CompLabSetupChart
                symbol={stock.symbol}
                candles={candles}
                loading={chartLoading}
                referenceDate={referenceDate}
                onReferenceDateChange={handleReferenceDateChange}
              />
            )}

            <CompLabReferenceDateField
              referenceDate={referenceDate}
              onReferenceDateChange={handleReferenceDateChange}
              dateContext={dateContext}
              disabled={chartLoading || !candles?.length}
            />

            {referenceDate && stock && candles && (
              <CompLabGrid
                referenceDate={referenceDate}
                comps={comps}
                candles={candles}
                loading={compsLoading}
                error={compsError}
                onClearReferenceDate={() => handleReferenceDateChange(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
