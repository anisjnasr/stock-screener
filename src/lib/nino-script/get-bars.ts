/**
 * Load daily bars for a symbol from screener DB (newest-first).
 */

import type { Bar } from "./interpreter";
import { getDailyBars } from "@/lib/screener-db-native";

const DEFAULT_LIMIT = 300;

export async function getBarsForSymbol(
  symbol: string,
  asOfDate: string,
  limit = DEFAULT_LIMIT
): Promise<Bar[]> {
  return getDailyBars(symbol, asOfDate, limit);
}
