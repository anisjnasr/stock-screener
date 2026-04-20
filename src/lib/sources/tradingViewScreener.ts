import type { GapperRow } from "@/types/gappers";

export const TRADINGVIEW_SCANNER_URL = "https://scanner.tradingview.com/america/scan";

const UA = "StockStalker/1.0 (premarket screener; contact: local)";

/** Column order must match `SCAN_COLUMNS` when parsing `d[]`. */
export const SCAN_COLUMNS = [
  "name",
  "description",
  "close",
  "premarket_change",
  "premarket_volume",
  "volume",
  "average_volume_90d_calc",
  "market_cap_basic",
  "sector",
  "industry",
  "exchange",
] as const;

export type TradingViewScanParams = {
  minPrice: number;
  minMarketCap: number;
  maxMarketCap: number;
  minPmVolume: number;
  minAvgVolume: number;
  minGapPct: number;
  maxRows: number;
};

export const DEFAULT_TRADINGVIEW_SCAN: TradingViewScanParams = {
  minPrice: 5,
  minMarketCap: 100_000_000,
  maxMarketCap: 10_000_000_000_000,
  minPmVolume: 0,
  minAvgVolume: 0,
  minGapPct: 1,
  maxRows: 50,
};

/** TV scanner uses `egreater` / `eless` for numeric comparisons (not `greater_equal`). */
export function buildTradingViewScanPayload(p: TradingViewScanParams): Record<string, unknown> {
  return {
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      { left: "exchange", operation: "in_range", right: ["NYSE", "NASDAQ"] },
      { left: "close", operation: "egreater", right: p.minPrice },
      { left: "market_cap_basic", operation: "egreater", right: p.minMarketCap },
      { left: "market_cap_basic", operation: "eless", right: p.maxMarketCap },
      { left: "premarket_volume", operation: "egreater", right: p.minPmVolume },
      { left: "average_volume_90d_calc", operation: "egreater", right: p.minAvgVolume },
      { left: "premarket_change_abs", operation: "egreater", right: p.minGapPct },
    ],
    columns: [...SCAN_COLUMNS],
    sort: { sortBy: "premarket_change_abs", sortOrder: "desc" },
    range: [0, Math.min(150, Math.max(1, Math.floor(p.maxRows)))],
    markets: ["america"],
    options: { lang: "en" },
  };
}

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function tickerFromComposite(s: string): string {
  const t = s.trim();
  const i = t.indexOf(":");
  return (i >= 0 ? t.slice(i + 1) : t).toUpperCase();
}

/**
 * Parse TradingView `/america/scan` JSON into rows (does not set `earningsRecent24h`).
 */
export function parseTradingViewScanJson(json: unknown): { rows: Omit<GapperRow, "earningsRecent24h">[]; totalCount: number } {
  if (!json || typeof json !== "object") throw new Error("TradingView: invalid JSON");
  const o = json as Record<string, unknown>;
  if (o.error && typeof o.error === "string") {
    throw new Error(`TradingView: ${o.error}`);
  }
  const totalCount = typeof o.totalCount === "number" ? o.totalCount : 0;
  const data = o.data;
  if (!Array.isArray(data)) return { rows: [], totalCount };

  const rows: Omit<GapperRow, "earningsRecent24h">[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { s?: string; d?: unknown[] };
    const sym = String(rec.s ?? "").trim();
    const d = rec.d;
    if (!sym || !Array.isArray(d) || d.length < SCAN_COLUMNS.length) continue;

    const name = String(d[0] ?? "").trim();
    const description = String(d[1] ?? "").trim();
    const close = parseNum(d[2]) ?? 0;
    const gapPct = parseNum(d[3]) ?? 0;
    const pmVol = parseNum(d[4]) ?? 0;
    const dayVol = parseNum(d[5]);
    const avg90 = parseNum(d[6]);
    const mcap = parseNum(d[7]);
    const sector = String(d[8] ?? "").trim() || null;
    const industry = String(d[9] ?? "").trim() || null;
    const exchange = String(d[10] ?? "").trim() || null;
    const ticker = name ? name.toUpperCase() : tickerFromComposite(sym);

    rows.push({
      ticker,
      compositeSymbol: sym || null,
      companyName: description || null,
      lastPrice: close,
      gapPct,
      pmVolume: pmVol,
      dayVolume: dayVol,
      avgVolume90d: avg90,
      marketCap: mcap,
      sector,
      industry,
      exchange,
    });
  }
  return { rows, totalCount };
}

function cookieHeaderFromEnv(): string | undefined {
  const id = process.env.TRADINGVIEW_SESSIONID?.trim();
  const sign = process.env.TRADINGVIEW_SESSIONID_SIGN?.trim();
  const parts: string[] = [];
  if (id) parts.push(`sessionid=${id}`);
  if (sign) parts.push(`sessionid_sign=${sign}`);
  return parts.length ? parts.join("; ") : undefined;
}

export async function fetchTradingViewGappers(
  params: TradingViewScanParams,
  init?: { signal?: AbortSignal }
): Promise<Omit<GapperRow, "earningsRecent24h">[]> {
  const body = buildTradingViewScanPayload(params);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": UA,
  };
  const cookie = cookieHeaderFromEnv();
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(TRADINGVIEW_SCANNER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: init?.signal,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`TradingView: non-JSON response HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`TradingView: HTTP ${res.status}`);
  }
  const { rows } = parseTradingViewScanJson(json);
  return rows;
}
