/**
 * Persistent SIP history by America/New_York calendar date (browser localStorage).
 */

import type { PremarketMoverRow } from "@/lib/premarket-types";

export const LEDGER_STORAGE_KEY = "premarket-ledger-v1";
/** Active premarket session date (YYYY-MM-DD ET); rolls at 03:00 ET, not midnight. */
export const ACTIVE_PREMARKET_SESSION_KEY = "premarket-active-session-et-v2";

export type PremarketLedgerDay = {
  tickers: string[];
  rows: Record<string, PremarketMoverRow>;
  catalyst?: Record<string, string>;
};

export type PremarketLedger = Record<string, PremarketLedgerDay>;

export function etDateKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function getEtHour24(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")?.value;
  if (!h) return 0;
  let n = Number(h);
  if (n === 24) n = 0;
  return Number.isFinite(n) ? n : 0;
}

function subtractOneCalendarDayYmd(ymd: string): string {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return ymd;
  const [y, m, d] = parts;
  const ms = Date.UTC(y, m - 1, d);
  return new Date(ms - 86400000).toISOString().slice(0, 10);
}

/**
 * Premarket SIP session calendar date in America/New_York.
 * The session rolls at 03:00 ET (before ~4:00 AM pre-market), not at midnight.
 */
export function premarketSessionEtDateKey(now = new Date()): string {
  const cal = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (getEtHour24(now) < 3) return subtractOneCalendarDayYmd(cal);
  return cal;
}

export function formatLedgerHeading(ymd: string): string {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function loadLedger(): PremarketLedger {
  try {
    const raw = localStorage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PremarketLedger;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLedger(ledger: PremarketLedger) {
  try {
    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    /* quota / private mode */
  }
}

export function mergeLedgerDay(
  ledger: PremarketLedger,
  ymd: string,
  entry: PremarketLedgerDay
): PremarketLedger {
  return { ...ledger, [ymd]: entry };
}
