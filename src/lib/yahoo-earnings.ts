/**
 * Next earnings date from Yahoo Finance (yahoo-finance2).
 * No separate Benzinga subscription required.
 */

import { formatDisplayDate } from "@/lib/date-format";

/** Format date as "d - mmm - yyyy" (e.g. "5 - Mar - 2025"). */
export function formatEarningsDate(date: Date): string {
  return formatDisplayDate(date);
}

function extractNextEarningsFromTimestamps(timestamps: number[]): string | undefined {
  const now = Date.now() / 1000;
  const future = timestamps
    .filter((t) => typeof t === "number" && t >= now)
    .sort((a, b) => a - b);
  const next = future[0];
  if (next == null) return undefined;
  return formatEarningsDate(new Date(next * 1000));
}

/**
 * Fetch the next (upcoming) earnings date for a symbol from Yahoo Finance.
 * Returns the date formatted as "d mmm yyyy", or undefined if not available.
 */
export async function fetchNextEarningsDate(symbol: string): Promise<string | undefined> {
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const result = (await YahooFinance.quoteSummary(symbol, {
      modules: ["calendarEvents", "earnings"],
    })) as Record<string, unknown> | null | undefined;

    // Try calendarEvents.earnings.earningsDate (common Yahoo shape)
    const calendar = result?.calendarEvents as { earnings?: { earningsDate?: number | number[] } } | undefined;
    if (calendar?.earnings?.earningsDate != null) {
      const raw = calendar.earnings.earningsDate;
      const arr = Array.isArray(raw) ? raw : [raw];
      const formatted = extractNextEarningsFromTimestamps(arr);
      if (formatted) return formatted;
    }

    // Try calendarEvents.earningsDate at top level
    const topEarnings = (result?.calendarEvents as { earningsDate?: number | number[] })?.earningsDate;
    if (topEarnings != null) {
      const arr = Array.isArray(topEarnings) ? topEarnings : [topEarnings];
      const formatted = extractNextEarningsFromTimestamps(arr);
      if (formatted) return formatted;
    }

    // Try earnings module (earningsDate or similar)
    const earningsMod = result?.earnings as { earningsDate?: number | number[] } | undefined;
    if (earningsMod?.earningsDate != null) {
      const raw = earningsMod.earningsDate;
      const arr = Array.isArray(raw) ? raw : [raw];
      const formatted = extractNextEarningsFromTimestamps(arr);
      if (formatted) return formatted;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
