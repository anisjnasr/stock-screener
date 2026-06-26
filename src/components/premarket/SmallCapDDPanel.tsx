"use client";

import { useCallback, useRef, useState } from "react";
import SmallCapDDCard, { type DDTickerState } from "./SmallCapDDCard";
import type { DDMetrics, DDNewsItem, DDReport, DDSignalLevel } from "@/lib/dd/types";

const TICKER_RE = /^[-A-Z0-9.]{1,12}$/;

function parseTickers(input: string): string[] {
  const raw = input
    .split(/[\s,]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => TICKER_RE.test(t));
  return [...new Set(raw)];
}

function initialState(ticker: string): DDTickerState {
  return {
    ticker,
    found: null,
    metricsPhase: "loading",
    newsPhase: "loading",
    dilutionPhase: "loading",
    news: [],
    instruments: [],
    overhang: null,
    notes: [],
    verdict: null,
    floatInput: "",
    marketCapInput: "",
    savingOverride: false,
  };
}

type MetricsResponse = {
  ok: boolean;
  found?: boolean;
  metrics?: DDMetrics;
  provisional_signals?: { cash_need: DDSignalLevel; float_risk: DDSignalLevel };
  error?: string;
};
type NewsResponse = { ok: boolean; news?: DDNewsItem[] };
type DilutionResponse = { ok: boolean; found?: boolean; report?: DDReport; error?: string };

export default function SmallCapDDPanel() {
  const [input, setInput] = useState("");
  const [tickers, setTickers] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, DDTickerState>>({});
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((ticker: string, p: Partial<DDTickerState>) => {
    setStates((prev) => {
      const cur = prev[ticker];
      if (!cur) return prev;
      return { ...prev, [ticker]: { ...cur, ...p } };
    });
  }, []);

  const runNews = useCallback(
    async (ticker: string, signal: AbortSignal) => {
      patch(ticker, { newsPhase: "loading" });
      try {
        const res = await fetch(`/api/dd/news?ticker=${encodeURIComponent(ticker)}`, { signal, cache: "no-store" });
        const json = (await res.json()) as NewsResponse;
        patch(ticker, { newsPhase: "done", news: json.news ?? [] });
      } catch (e) {
        if (signal.aborted) return;
        patch(ticker, { newsPhase: "done", news: [] });
        void e;
      }
    },
    [patch]
  );

  const runMetrics = useCallback(
    async (ticker: string, signal: AbortSignal) => {
      patch(ticker, { metricsPhase: "loading" });
      try {
        const res = await fetch(`/api/dd/metrics?ticker=${encodeURIComponent(ticker)}`, { signal, cache: "no-store" });
        const json = (await res.json()) as MetricsResponse;
        if (!json.ok) {
          patch(ticker, { metricsPhase: "error", metricsError: json.error ?? "Failed to load metrics" });
          return;
        }
        if (json.found === false || !json.metrics) {
          patch(ticker, { metricsPhase: "done", found: false });
          return;
        }
        patch(ticker, {
          metricsPhase: "done",
          found: true,
          metrics: json.metrics,
          provisionalSignals: json.provisional_signals,
          floatInput: json.metrics.float != null ? String(json.metrics.float) : "",
          marketCapInput: json.metrics.market_cap != null ? String(json.metrics.market_cap) : "",
        });
      } catch (e) {
        if (signal.aborted) return;
        patch(ticker, { metricsPhase: "error", metricsError: e instanceof Error ? e.message : "Failed to load metrics" });
      }
    },
    [patch]
  );

  const runDilution = useCallback(
    async (ticker: string, signal: AbortSignal) => {
      patch(ticker, { dilutionPhase: "loading" });
      try {
        const res = await fetch(`/api/dd/dilution?ticker=${encodeURIComponent(ticker)}`, { signal, cache: "no-store" });
        const json = (await res.json()) as DilutionResponse;
        if (!json.ok || !json.report) {
          patch(ticker, { dilutionPhase: "error", dilutionError: json.error ?? "Extraction failed" });
          return;
        }
        const r = json.report;
        if (json.found === false) {
          patch(ticker, { found: false, dilutionPhase: "done" });
          return;
        }
        patch(ticker, {
          dilutionPhase: r.status === "error" ? "error" : "done",
          dilutionError: r.error,
          instruments: r.instruments,
          overhang: r.overhang,
          notes: r.notes,
          verdict: r.verdict,
        });
      } catch (e) {
        if (signal.aborted) return;
        patch(ticker, { dilutionPhase: "error", dilutionError: e instanceof Error ? e.message : "Extraction failed" });
      }
    },
    [patch]
  );

  const runTicker = useCallback(
    (ticker: string, signal: AbortSignal) => {
      // News + metrics are phase 1 (paint instantly); dilution is phase 2 (slow).
      void runNews(ticker, signal);
      void runMetrics(ticker, signal);
      void runDilution(ticker, signal);
    },
    [runNews, runMetrics, runDilution]
  );

  const onRun = useCallback(() => {
    const parsed = parseTickers(input);
    if (parsed.length === 0) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setTickers(parsed);
    setStates(() => {
      const next: Record<string, DDTickerState> = {};
      for (const t of parsed) next[t] = initialState(t);
      return next;
    });
    for (const t of parsed) runTicker(t, ac.signal);
  }, [input, runTicker]);

  const onRetry = useCallback(
    (ticker: string) => {
      const ac = abortRef.current ?? new AbortController();
      abortRef.current = ac;
      setStates((prev) => ({ ...prev, [ticker]: initialState(ticker) }));
      runTicker(ticker, ac.signal);
    },
    [runTicker]
  );

  const onRemove = useCallback((ticker: string) => {
    setTickers((prev) => prev.filter((t) => t !== ticker));
    setStates((prev) => {
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
  }, []);

  const onChangeFloat = useCallback((ticker: string, value: string) => patch(ticker, { floatInput: value }), [patch]);
  const onChangeMarketCap = useCallback(
    (ticker: string, value: string) => patch(ticker, { marketCapInput: value }),
    [patch]
  );

  const onSaveOverride = useCallback(
    async (ticker: string) => {
      const cur = states[ticker];
      if (!cur || cur.savingOverride) return;
      const floatVal = cur.floatInput.replace(/[, ]/g, "");
      const mcapVal = cur.marketCapInput.replace(/[, ]/g, "");
      // Skip the save if nothing changed vs the resolved metrics.
      const sameFloat = String(cur.metrics?.float ?? "") === floatVal;
      const sameMcap = String(cur.metrics?.market_cap ?? "") === mcapVal;
      if (sameFloat && sameMcap) return;

      patch(ticker, { savingOverride: true });
      try {
        await fetch("/api/dd/override", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker,
            float_override: floatVal === "" ? null : Number(floatVal),
            market_cap_override: mcapVal === "" ? null : Number(mcapVal),
          }),
        });
      } catch {
        /* surfaced on next run */
      } finally {
        patch(ticker, { savingOverride: false });
      }
      // Re-run metrics + dilution so cards and verdict reflect the override.
      const ac = abortRef.current ?? new AbortController();
      abortRef.current = ac;
      void runMetrics(ticker, ac.signal);
      void runDilution(ticker, ac.signal);
    },
    [states, patch, runMetrics, runDilution]
  );

  const orderedStates = tickers.map((t) => states[t]).filter((s): s is DDTickerState => Boolean(s));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="pm-focus pm-mono min-w-[16rem] flex-1 rounded border px-2 py-1"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontSize: "var(--ws-fs-body)",
          }}
          placeholder="Enter tickers (comma or space separated) e.g. ABCD XYZ"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRun();
          }}
          aria-label="Tickers for due diligence"
        />
        <button
          type="button"
          onClick={onRun}
          disabled={parseTickers(input).length === 0}
          className="pm-focus rounded px-3 py-1 text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ background: "var(--accent-cyan)", color: "#0a0a0a" }}
        >
          Run DD
        </button>
      </div>

      {orderedStates.length === 0 ? (
        <p className="pm-site-prose" style={{ color: "var(--text-tertiary)" }}>
          Enter one or more small-cap tickers and press Run DD for a dilution-and-solvency read.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {orderedStates.map((s) => (
            <SmallCapDDCard
              key={s.ticker}
              state={s}
              onChangeFloat={onChangeFloat}
              onChangeMarketCap={onChangeMarketCap}
              onSaveOverride={onSaveOverride}
              onRetry={onRetry}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
