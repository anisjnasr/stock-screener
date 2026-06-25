import {
  DEFAULT_TRADINGVIEW_SCAN,
  fetchTradingViewGappers,
  TRADINGVIEW_GAP_SCAN_ROW_CAP,
  type TradingViewScanParams,
} from "@/lib/sources/tradingViewScreener";
import type { GapperRow } from "@/types/gappers";

function parseEnvNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function parseEtHmToMinutes(raw: string | undefined, fallbackMinutes: number): number {
  if (typeof raw !== "string") return fallbackMinutes;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallbackMinutes;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallbackMinutes;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallbackMinutes;
  return hour * 60 + minute;
}

const EARLY_PREMARKET_ET_START_MINUTES = parseEtHmToMinutes(process.env.PREMARKET_EARLY_ET_START_HHMM, 4 * 60);
const EARLY_PREMARKET_ET_END_MINUTES = parseEtHmToMinutes(process.env.PREMARKET_EARLY_ET_END_HHMM, 5 * 60 + 30);
const EARLY_PREMARKET_MIN_PM_VOLUME = parseEnvNonNegativeInt("PREMARKET_EARLY_MIN_PM_VOLUME", 25_000);

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

function applyPriceBandFilter(rows: Omit<GapperRow, "earningsRecent24h">[], minPrice: number, maxPrice: number) {
  return rows.filter((r) => r.lastPrice >= minPrice && r.lastPrice <= maxPrice);
}

function getEtWeekdayAndMinutes(now: Date = new Date()): { weekday: number; minutes: number } | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = dayMap[weekdayShort] ?? -1;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || weekday < 0) return null;
  return { weekday, minutes: hour * 60 + minute };
}

function applyEarlyPremarketVolumeFloor(scan: TradingViewScanParams): TradingViewScanParams {
  const et = getEtWeekdayAndMinutes();
  if (!et) return scan;
  if (et.weekday === 0 || et.weekday === 6) return scan;
  const inEarlyPremarket =
    et.minutes >= EARLY_PREMARKET_ET_START_MINUTES && et.minutes < EARLY_PREMARKET_ET_END_MINUTES;
  if (!inEarlyPremarket) return scan;
  if (scan.minPmVolume >= EARLY_PREMARKET_MIN_PM_VOLUME) return scan;
  return { ...scan, minPmVolume: EARLY_PREMARKET_MIN_PM_VOLUME };
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
    const guardedScan = applyEarlyPremarketVolumeFloor(scan);
    const raw = await fetchTradingViewGappers(guardedScan, {
      signal: init?.signal,
      rowLimit: init?.rowLimit ?? guardedScan.rowLimit ?? TRADINGVIEW_GAP_SCAN_ROW_CAP,
    });
    const rows = applyVolPctFilter(
      applyMcapFilter(
        applyPriceBandFilter(raw, guardedScan.minPrice, guardedScan.maxPrice),
        guardedScan.minMarketCap,
        guardedScan.maxMarketCap
      ),
      guardedScan.minVolPct
    );
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

  const minPrice = clamp(n(b.minPrice, D.minPrice), 0.01, 50_000_000);
  const maxPrice = clamp(n(b.maxPrice, D.maxPrice), minPrice, 50_000_000);
  const minMarketCap = clamp(n(b.minMarketCap, D.minMarketCap), 0, 1e15);
  const maxMarketCap = clamp(n(b.maxMarketCap, D.maxMarketCap), minMarketCap, 1e15);
  const minPmVolume = Math.max(0, n(b.minPmVolume, D.minPmVolume));
  const minVolPct = Math.max(0, n(b.minVolPct, D.minVolPct));
  const minGapPct = clamp(n(b.minGapPct, D.minGapPct), 0, 100);
  const rowLimit = clamp(Math.round(n(b.rowLimit, D.rowLimit)), 1, TRADINGVIEW_GAP_SCAN_ROW_CAP);

  return {
    minPrice,
    maxPrice,
    minMarketCap,
    maxMarketCap: Math.max(maxMarketCap, minMarketCap),
    minPmVolume,
    minVolPct,
    minGapPct,
    rowLimit,
  };
}
