/**
 * Persistent SIP history by America/New_York calendar date (browser localStorage).
 */

import type { PremarketMoverRow } from "@/lib/premarket-types";

export const LEDGER_STORAGE_KEY = "premarket-ledger-v1";
export const ACTIVE_ET_DATE_KEY = "premarket-active-et-date";

export type PremarketLedgerDay = {
  tickers: string[];
  rows: Record<string, PremarketMoverRow>;
  catalyst?: Record<string, string>;
};

export type PremarketLedger = Record<string, PremarketLedgerDay>;

export function etDateKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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
