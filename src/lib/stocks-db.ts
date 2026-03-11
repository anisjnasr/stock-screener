/**
 * Local database of all stocks (CS + ADRC from Massive).
 * Populated by: npm run build-stocks-db
 * File: data/all-stocks.json
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export type StockRecord = {
  symbol: string;
  name: string;
  type: "CS" | "ADRC";
  exchange?: string;
  currency?: string;
  /** GICS-aligned sector name from Yahoo Finance (enrich-stocks script). */
  sector?: string;
  /** GICS-aligned industry name from Yahoo Finance (enrich-stocks script). */
  industry?: string;
};

export type StocksDb = {
  builtAt: string;
  count: number;
  types: string[];
  stocks: StockRecord[];
  sectorEnrichedAt?: string;
};

let cached: StocksDb | null = null;

function getDataPath(): string {
  return join(process.cwd(), "data", "all-stocks.json");
}

/**
 * Load the local stocks database (server-side only).
 * Returns null if the file has not been built yet.
 */
export function loadStocksDb(): StocksDb | null {
  if (cached) return cached;
  const path = getDataPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    cached = JSON.parse(raw) as StocksDb;
    return cached;
  } catch {
    return null;
  }
}

/**
 * All stock symbols (CS + ADRC). Empty array if DB not built.
 */
export function getAllStockSymbols(): string[] {
  const db = loadStocksDb();
  return db ? db.stocks.map((s) => s.symbol) : [];
}

/**
 * Check if a symbol is in the local stocks database (i.e. is a CS or ADRC stock).
 */
export function isStockSymbol(symbol: string): boolean {
  const db = loadStocksDb();
  if (!db) return false;
  const upper = symbol.toUpperCase();
  return db.stocks.some((s) => s.symbol === upper);
}

/**
 * Get record for a symbol, or undefined.
 */
export function getStockRecord(symbol: string): StockRecord | undefined {
  const db = loadStocksDb();
  if (!db) return undefined;
  const upper = symbol.toUpperCase();
  return db.stocks.find((s) => s.symbol === upper);
}
