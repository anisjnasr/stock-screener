import { readFileSync, existsSync } from "fs";
import { resolveDataPath } from "@/lib/data-path";
import { getLatestScreenerDate, getScreenerSnapshot } from "@/lib/screener-db-native";
import type { BigNameUniverseInsert } from "@/types/earnings-calendar";

const CHUNK = 400;
const TEN_B = 10_000_000_000;

function loadIndexSymbols(name: "sp500" | "nasdaq100"): string[] {
  const path = resolveDataPath(`${name}.json`);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Build `big_name_universe` rows: S&P 500 ∪ Nasdaq-100 ∪ screener names with market cap > $10B.
 * Market cap comes from `screener.db` latest reliable quote date when available.
 */
export function buildBigNameUniverseRows(): BigNameUniverseInsert[] {
  const sp500 = loadIndexSymbols("sp500");
  const ndq = loadIndexSymbols("nasdaq100");
  const spSet = new Set(sp500);
  const ndSet = new Set(ndq);

  const all = new Set<string>([...sp500, ...ndq]);
  const mcapByTicker = new Map<string, number | null>();
  const date = getLatestScreenerDate();

  if (date) {
    const unionArr = [...all];
    for (const part of chunk(unionArr, CHUNK)) {
      const { rows } = getScreenerSnapshot({
        date,
        symbols: part,
        includeFinancialExtras: false,
        limit: CHUNK,
      });
      for (const r of rows) {
        const sym = String(r.symbol ?? "").toUpperCase();
        if (!sym) continue;
        mcapByTicker.set(sym, r.market_cap ?? null);
      }
    }

    const { rows: highCap } = getScreenerSnapshot({
      date,
      filters: { market_cap_min: TEN_B + 1 },
      limit: 8000,
      offset: 0,
      includeFinancialExtras: false,
    });
    for (const r of highCap) {
      const sym = String(r.symbol ?? "").toUpperCase();
      if (!sym) continue;
      all.add(sym);
      if (!mcapByTicker.has(sym)) mcapByTicker.set(sym, r.market_cap ?? null);
    }
  }

  const now = new Date().toISOString();
  const rows: BigNameUniverseInsert[] = [];
  for (const ticker of [...all].sort()) {
    const mcap = mcapByTicker.get(ticker) ?? null;
    const above = mcap != null && mcap > TEN_B;
    rows.push({
      ticker,
      in_sp500: spSet.has(ticker),
      in_nasdaq100: ndSet.has(ticker),
      market_cap_usd: mcap,
      above_10b_threshold: above,
      last_refreshed_at: now,
    });
  }
  return rows;
}
