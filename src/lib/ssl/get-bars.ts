/**
 * Load daily bars and enriched snapshot for SSL evaluation.
 */

import { getDailyBars, getSslSnapshot } from "@/lib/screener-db-native";
import type { SnapshotData } from "./interpreter";

function enrichSnapshot(raw: SnapshotData, symbol: string, asOfDate: string): SnapshotData {
  const ipo = raw.ipo_date;
  let daysSince: number | null = null;
  if (typeof ipo === "string" && ipo.length >= 10) {
    const a = new Date(asOfDate.slice(0, 10) + "T12:00:00Z").getTime();
    const b = new Date(ipo.slice(0, 10) + "T12:00:00Z").getTime();
    if (!isNaN(a) && !isNaN(b)) daysSince = Math.max(0, Math.round((a - b) / 86400000));
  }
  return {
    ...raw,
    days_since_ipo: daysSince,
    name: symbol,
  };
}

export async function getBarsForSymbol(
  symbol: string,
  asOfDate: string,
  limit = 300
): Promise<import("./interpreter").Bar[]> {
  return getDailyBars(symbol, asOfDate, limit);
}

export function getSnapshotForSymbol(symbol: string, asOfDate: string): SnapshotData | null {
  const raw = getSslSnapshot(symbol, asOfDate);
  if (!raw) return null;
  return enrichSnapshot(raw as SnapshotData, symbol, asOfDate);
}
