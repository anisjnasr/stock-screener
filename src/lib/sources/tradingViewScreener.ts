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
  maxPrice: number;
  minMarketCap: number;
  maxMarketCap: number;
  minPmVolume: number;
  minVolPct: number;
  minGapPct: number;
  rowLimit: number;
};

/** TV `range` end (exclusive-style upper bound); capped at 150 per request. */
export const TRADINGVIEW_GAP_SCAN_ROW_CAP = 150;

export type TradingViewGapScanOptions = {
  /** When set, filter `premarket_change <= -minAbsGapPct` and sort ascending (down-gappers). */
  leg: "negative";
  minAbsGapPct: number;
};

function parseEnvNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

const DEFAULT_MIN_PM_VOLUME = parseEnvNonNegativeInt("PREMARKET_MIN_PM_VOLUME_DEFAULT", 25_000);

export const DEFAULT_TRADINGVIEW_SCAN: TradingViewScanParams = {
  minPrice: 5,
  /** Upper bound on last close (USD); keep high by default so scans behave like “no max”. */
  maxPrice: 50_000_000,
  minMarketCap: 100_000_000,
  maxMarketCap: 10_000_000_000_000,
  minPmVolume: DEFAULT_MIN_PM_VOLUME,
  minVolPct: 0,
  minGapPct: 1,
  rowLimit: 10,
};

/** TV scanner uses `egreater` / `eless` for numeric comparisons (not `greater_equal`). */
export function buildTradingViewScanPayload(
  p: TradingViewScanParams,
  rowLimit: number = TRADINGVIEW_GAP_SCAN_ROW_CAP,
  gap?: TradingViewGapScanOptions
): Record<string, unknown> {
  const rangeEnd = Math.min(TRADINGVIEW_GAP_SCAN_ROW_CAP, Math.max(1, Math.floor(rowLimit)));
  const gapFilter =
    gap?.leg === "negative"
      ? { left: "premarket_change", operation: "eless", right: -gap.minAbsGapPct }
      : { left: "premarket_change", operation: "egreater", right: p.minGapPct };
  const sortOrder = gap?.leg === "negative" ? "asc" : "desc";
  const filter: Record<string, unknown>[] = [
    { left: "type", operation: "equal", right: "stock" },
    { left: "exchange", operation: "in_range", right: ["NYSE", "NASDAQ"] },
    { left: "close", operation: "egreater", right: p.minPrice },
    { left: "close", operation: "eless", right: p.maxPrice },
  ];
  if (p.minMarketCap > 0) {
    filter.push({ left: "market_cap_basic", operation: "egreater", right: p.minMarketCap });
  }
  filter.push(
    { left: "market_cap_basic", operation: "eless", right: p.maxMarketCap },
    { left: "premarket_volume", operation: "egreater", right: p.minPmVolume },
    // `premarket_change` is **percent** vs prior close; `premarket_change_abs` is **dollar** move — do not mix with MIN GAP %.
    gapFilter
  );

  return {
    filter,
    columns: [...SCAN_COLUMNS],
    sort: { sortBy: "premarket_change", sortOrder },
    range: [0, rangeEnd],
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
    const volPct = avg90 != null && avg90 > 0 ? (pmVol / avg90) * 100 : null;
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
      volPct,
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

async function postTradingViewScan(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Omit<GapperRow, "earningsRecent24h">[]> {
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
    signal,
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

export async function fetchTradingViewGappers(
  params: TradingViewScanParams,
  init?: { signal?: AbortSignal; rowLimit?: number }
): Promise<Omit<GapperRow, "earningsRecent24h">[]> {
  const body = buildTradingViewScanPayload(params, init?.rowLimit ?? TRADINGVIEW_GAP_SCAN_ROW_CAP);
  return postTradingViewScan(body, init?.signal);
}

/**
 * Up-gappers and down-gappers with |premarket_change| ≥ minAbsGapPct, merged and deduped (keeps larger |gap|).
 */
export async function fetchTradingViewGappersBidirectional(
  params: TradingViewScanParams,
  init?: { signal?: AbortSignal; rowLimit?: number; minAbsGapPct?: number }
): Promise<Omit<GapperRow, "earningsRecent24h">[]> {
  const maxRows = Math.min(TRADINGVIEW_GAP_SCAN_ROW_CAP, init?.rowLimit ?? TRADINGVIEW_GAP_SCAN_ROW_CAP);
  const minAbs = init?.minAbsGapPct ?? 2;
  const half = Math.max(1, Math.ceil(maxRows / 2));
  const posParams = {
    ...params,
    minGapPct: Math.max(minAbs, params.minGapPct),
  };
  const [pos, neg] = await Promise.all([
    postTradingViewScan(buildTradingViewScanPayload(posParams, half), init?.signal),
    postTradingViewScan(
      buildTradingViewScanPayload(params, half, { leg: "negative", minAbsGapPct: minAbs }),
      init?.signal
    ),
  ]);
  const byTicker = new Map<string, Omit<GapperRow, "earningsRecent24h">>();
  for (const r of [...pos, ...neg]) {
    const ex = byTicker.get(r.ticker);
    if (!ex || Math.abs(r.gapPct) > Math.abs(ex.gapPct)) byTicker.set(r.ticker, r);
  }
  return [...byTicker.values()];
}
