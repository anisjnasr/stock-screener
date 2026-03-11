/**
 * Load daily bars for a symbol from screener DB (newest-first). Tries native then sql.js.
 */

import type { Bar } from "./interpreter";

const DEFAULT_LIMIT = 300;

export async function getBarsForSymbol(
  symbol: string,
  asOfDate: string,
  limit = DEFAULT_LIMIT
): Promise<Bar[]> {
  try {
    const { getDailyBars } = await import("@/lib/screener-db-native");
    const rows = getDailyBars(symbol, asOfDate, limit);
    return rows;
  } catch {
    const { getDailyBars } = await import("@/lib/screener-db");
    return getDailyBars(symbol, asOfDate, limit);
  }
}
