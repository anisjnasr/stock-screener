/**
 * Float prefill (spec §5.3). Resolution order:
 *   1. stockanalysis.com (the source the DDD workflow already trusts)
 *   2. yahoo-finance2 defaultKeyStatistics.floatShares (failsafe)
 *   3. Polygon share_class_shares_outstanding — labelled as a PROXY, not real float.
 * The trader's manual override (handled in the metrics route) always wins over all of these.
 */

import type { DDFloatSource } from "./types";

export type FloatPrefill = {
  float: number | null;
  source: DDFloatSource | null;
};

const FETCH_TIMEOUT_MS = 8_000;

function parseFloatString(raw: string): number | null {
  const m = raw.trim().match(/^([\d.,]+)\s*([KMBT])?/i);
  if (!m) return null;
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] ?? "").toUpperCase();
  const mult = unit === "T" ? 1e12 : unit === "B" ? 1e9 : unit === "M" ? 1e6 : unit === "K" ? 1e3 : 1;
  return Math.round(num * mult);
}

/** Scrape the stockanalysis.com statistics page for the "Shares Float" figure. */
async function fetchStockAnalysisFloat(ticker: string, signal?: AbortSignal): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(`https://stockanalysis.com/stocks/${ticker.toLowerCase()}/statistics/`, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Match a "Float" / "Shares Float" row followed by a number cell (e.g. 4.72M, 118,060,000).
    const re = /(?:Shares\s+Float|Float)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+\s*[KMBT]?)/i;
    const m = html.match(re);
    if (m) {
      const parsed = parseFloatString(m[1]);
      if (parsed && parsed > 0) return parsed;
    }
    // Fallback: look for a JSON-embedded "sharesFloat" / "float" numeric field.
    const jsonMatch = html.match(/"(?:sharesFloat|float)"\s*:\s*([\d.]+)/i);
    if (jsonMatch) {
      const n = Number(jsonMatch[1]);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** yahoo-finance2 failsafe — defaultKeyStatistics.floatShares. */
async function fetchYahooFloat(ticker: string): Promise<number | null> {
  try {
    const YahooFinance = (await import("yahoo-finance2")).default as unknown as {
      quoteSummary: (t: string, opts: { modules: string[] }) => Promise<unknown>;
    };
    const summary = (await YahooFinance.quoteSummary(ticker, {
      modules: ["defaultKeyStatistics"],
    })) as { defaultKeyStatistics?: { floatShares?: number } } | null;
    const f = summary?.defaultKeyStatistics?.floatShares;
    return typeof f === "number" && Number.isFinite(f) && f > 0 ? Math.round(f) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the float prefill. `polygonShareClass` is passed in from the ticker-details
 * call so we can use it as a labelled proxy when both primary sources fail.
 */
export async function resolveFloatPrefill(
  ticker: string,
  polygonShareClass: number | null,
  signal?: AbortSignal
): Promise<FloatPrefill> {
  const fromStockAnalysis = await fetchStockAnalysisFloat(ticker, signal);
  if (fromStockAnalysis) return { float: fromStockAnalysis, source: "stockanalysis" };

  const fromYahoo = await fetchYahooFloat(ticker);
  if (fromYahoo) return { float: fromYahoo, source: "yahoo" };

  if (typeof polygonShareClass === "number" && polygonShareClass > 0) {
    return { float: polygonShareClass, source: "polygon_proxy" };
  }
  return { float: null, source: null };
}
