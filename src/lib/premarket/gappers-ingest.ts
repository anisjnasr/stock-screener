import {
  DEFAULT_TRADINGVIEW_SCAN,
  fetchTradingViewGappers,
  fetchTradingViewGappersBidirectional,
  TRADINGVIEW_GAP_SCAN_ROW_CAP,
  type TradingViewScanParams,
} from "@/lib/sources/tradingViewScreener";
import type { GapperRow } from "@/types/gappers";

function applyMcapFilter(rows: Omit<GapperRow, "earningsRecent24h">[], minCap: number, maxCap: number) {
  return rows.filter((r) => {
    if (r.marketCap == null) return true;
    return r.marketCap >= minCap && r.marketCap <= maxCap;
  });
}

function applyVolPctFilter(rows: Omit<GapperRow, "earningsRecent24h">[], minVolPct: number) {
  if (minVolPct <= 0) return rows;
  return rows.filter((r) => r.volPct != null && Number.isFinite(r.volPct) && r.volPct >= minVolPct);
}

/**
 * TradingView `america/scan` only. Does **not** set `earningsRecent24h` (merged in the API route).
 * Throws on failure — no alternate data source.
 */
export async function loadGappersScanOnly(
  scan: TradingViewScanParams,
  init?: { signal?: AbortSignal; rowLimit?: number }
): Promise<{ source: "tradingview"; rows: Omit<GapperRow, "earningsRecent24h">[] }> {
  try {
    const raw = await fetchTradingViewGappers(scan, {
      signal: init?.signal,
      rowLimit: init?.rowLimit ?? TRADINGVIEW_GAP_SCAN_ROW_CAP,
    });
    const rows = applyVolPctFilter(applyMcapFilter(raw, scan.minMarketCap, scan.maxMarketCap), scan.minVolPct);
    return { source: "tradingview", rows };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `TradingView screener could not load (${detail}). Try again later, or set TRADINGVIEW_SESSIONID and TRADINGVIEW_SESSIONID_SIGN on the server if the feed requires a browser session.`
    );
  }
}

/** Bidirectional gap scan (|gap| ≥ minAbs) for Stocks in Play candidate pool. */
export async function loadGappersSipScan(
  scan: TradingViewScanParams,
  init?: { signal?: AbortSignal; rowLimit?: number; minAbsGapPct?: number }
): Promise<{ source: "tradingview"; rows: Omit<GapperRow, "earningsRecent24h">[] }> {
  try {
    const raw = await fetchTradingViewGappersBidirectional(scan, {
      signal: init?.signal,
      rowLimit: init?.rowLimit ?? TRADINGVIEW_GAP_SCAN_ROW_CAP,
      minAbsGapPct: init?.minAbsGapPct ?? 2,
    });
    const rows = applyVolPctFilter(applyMcapFilter(raw, scan.minMarketCap, scan.maxMarketCap), scan.minVolPct);
    return { source: "tradingview", rows };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `TradingView screener could not load (${detail}). Try again later, or set TRADINGVIEW_SESSIONID and TRADINGVIEW_SESSIONID_SIGN on the server if the feed requires a browser session.`
    );
  }
}

export function normalizeGappersScanBody(raw: unknown): TradingViewScanParams {
  const D = DEFAULT_TRADINGVIEW_SCAN;
  if (!raw || typeof raw !== "object") return { ...D };

  const b = raw as Record<string, unknown>;
  const n = (v: unknown, fallback: number): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const x = Number(v);
      if (Number.isFinite(x)) return x;
    }
    return fallback;
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const minPrice = clamp(n(b.minPrice, D.minPrice), 0.01, 1_000);
  const minMarketCap = clamp(n(b.minMarketCap, D.minMarketCap), 0, 1e15);
  const maxMarketCap = clamp(n(b.maxMarketCap, D.maxMarketCap), minMarketCap, 1e15);
  const minPmVolume = Math.max(0, n(b.minPmVolume, D.minPmVolume));
  const minAvgVolume = Math.max(0, n(b.minAvgVolume, D.minAvgVolume));
  const minVolPct = Math.max(0, n(b.minVolPct, D.minVolPct));
  const minGapPct = clamp(n(b.minGapPct, D.minGapPct), 0, 100);

  return {
    minPrice,
    minMarketCap,
    maxMarketCap: Math.max(maxMarketCap, minMarketCap),
    minPmVolume,
    minAvgVolume,
    minVolPct,
    minGapPct,
  };
}
