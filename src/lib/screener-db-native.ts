/**
 * Screener DB access using better-sqlite3 (opens file on disk, no full load).
 * Use this when screener.db is too large for sql.js (e.g. >2GB).
 * API route should try this first so watchlists/lists get sector, ATR, etc. from the DB.
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";
import { isUSMarketOpen } from "@/lib/market-hours";
import { buildFilterClauses, type ScreenerFilters, type ScreenerRow } from "@/lib/screener-db";

const DB_PATH = join(process.cwd(), "data", "screener.db");

function openDb(): InstanceType<typeof Database> | null {
  if (!existsSync(DB_PATH)) return null;
  try {
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

type RowObject = Record<string, unknown>;

function rowToScreenerRow(r: RowObject, marketClosed: boolean): ScreenerRow {
  const last_price_raw = typeof r.last_price === "number" ? r.last_price : null;
  const prev_close = typeof r.prev_close === "number" ? r.prev_close : null;
  let last_price: number | null = last_price_raw;
  let change_pct: number | null = typeof r.change_pct === "number" ? r.change_pct : null;
  let atr_pct_21d: number | null = typeof r.atr_pct_21d === "number" ? r.atr_pct_21d : null;

  if (marketClosed && prev_close != null && prev_close > 0) {
    last_price = prev_close;
    change_pct = 0;
    if (atr_pct_21d != null && last_price_raw != null && last_price_raw > 0 && prev_close > 0) {
      atr_pct_21d = (atr_pct_21d * last_price_raw) / prev_close;
    }
  } else if (!marketClosed && (last_price == null || last_price <= 0 || prev_close == null || prev_close <= 0)) {
    change_pct = 0;
  }

  return {
    symbol: String(r.symbol ?? ""),
    name: String(r.name ?? ""),
    exchange: r.exchange != null ? String(r.exchange) : null,
    industry: r.industry != null ? String(r.industry) : null,
    sector: r.sector != null ? String(r.sector) : null,
    date: String(r.date ?? ""),
    market_cap: typeof r.market_cap === "number" ? r.market_cap : null,
    last_price,
    change_pct,
    volume: typeof r.volume === "number" ? r.volume : null,
    avg_volume_30d_shares: typeof r.avg_volume_30d_shares === "number" ? r.avg_volume_30d_shares : null,
    high_52w: typeof r.high_52w === "number" ? r.high_52w : null,
    off_52w_high_pct: typeof r.off_52w_high_pct === "number" ? r.off_52w_high_pct : null,
    atr_pct_21d,
    price_change_1w_pct: typeof r.price_change_1w_pct === "number" ? r.price_change_1w_pct : null,
    price_change_1m_pct: typeof r.price_change_1m_pct === "number" ? r.price_change_1m_pct : null,
    price_change_3m_pct: typeof r.price_change_3m_pct === "number" ? r.price_change_3m_pct : null,
    price_change_6m_pct: typeof r.price_change_6m_pct === "number" ? r.price_change_6m_pct : null,
    price_change_12m_pct: typeof r.price_change_12m_pct === "number" ? r.price_change_12m_pct : null,
    rs_vs_spy_1w: typeof r.rs_vs_spy_1w === "number" ? r.rs_vs_spy_1w : null,
    rs_vs_spy_1m: typeof r.rs_vs_spy_1m === "number" ? r.rs_vs_spy_1m : null,
    rs_vs_spy_3m: typeof r.rs_vs_spy_3m === "number" ? r.rs_vs_spy_3m : null,
    rs_vs_spy_6m: typeof r.rs_vs_spy_6m === "number" ? r.rs_vs_spy_6m : null,
    rs_vs_spy_12m: typeof r.rs_vs_spy_12m === "number" ? r.rs_vs_spy_12m : null,
    rs_pct_1w: typeof r.rs_pct_1w === "number" ? r.rs_pct_1w : null,
    rs_pct_1m: typeof r.rs_pct_1m === "number" ? r.rs_pct_1m : null,
    rs_pct_3m: typeof r.rs_pct_3m === "number" ? r.rs_pct_3m : null,
    rs_pct_6m: typeof r.rs_pct_6m === "number" ? r.rs_pct_6m : null,
    rs_pct_12m: typeof r.rs_pct_12m === "number" ? r.rs_pct_12m : null,
    industry_rank_1m: typeof r.industry_rank_1m === "number" ? r.industry_rank_1m : null,
    industry_rank_3m: typeof r.industry_rank_3m === "number" ? r.industry_rank_3m : null,
    industry_rank_6m: typeof r.industry_rank_6m === "number" ? r.industry_rank_6m : null,
    industry_rank_12m: typeof r.industry_rank_12m === "number" ? r.industry_rank_12m : null,
    sector_rank_1m: typeof r.sector_rank_1m === "number" ? r.sector_rank_1m : null,
    sector_rank_3m: typeof r.sector_rank_3m === "number" ? r.sector_rank_3m : null,
    sector_rank_6m: typeof r.sector_rank_6m === "number" ? r.sector_rank_6m : null,
    sector_rank_12m: typeof r.sector_rank_12m === "number" ? r.sector_rank_12m : null,
  };
}

export function getLatestScreenerDate(): string | null {
  const db = openDb();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT MAX(date) AS d FROM quote_daily").get() as { d: string | null } | undefined;
    return row?.d != null ? String(row.d) : null;
  } finally {
    db.close();
  }
}

export function getScreenerCount(options: {
  date?: string;
  symbols?: string[];
  filters?: ScreenerFilters;
}): { count: number; date: string | null } {
  const db = openDb();
  if (!db) return { count: 0, date: null };
  try {
    let date = options.date ?? null;
    if (!date) {
      const d = getLatestScreenerDate();
      date = d;
    }
    if (!date) return { count: 0, date: null };
    const symbolFilter =
      options.symbols && options.symbols.length > 0
        ? ` AND c.symbol IN (${options.symbols.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",")})`
        : "";
    const { sql: filterSql, params: filterParams } = buildFilterClauses(options.filters ?? {});
    const sql = `
      SELECT COUNT(*) AS cnt FROM companies c
      INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
      LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
      WHERE 1=1 ${symbolFilter}${filterSql}
    `;
    const stmt = db.prepare(sql);
    const row = stmt.get(...[date, ...filterParams]) as { cnt: number };
    return { count: row?.cnt ?? 0, date };
  } finally {
    db.close();
  }
}

export function getScreenerSnapshot(options: {
  date?: string;
  symbols?: string[];
  limit?: number;
  offset?: number;
  filters?: ScreenerFilters;
}): { rows: ScreenerRow[]; date: string | null } {
  const db = openDb();
  if (!db) return { rows: [], date: null };
  try {
    let date = options.date ?? null;
    if (!date) date = getLatestScreenerDate();
    if (!date) return { rows: [], date: null };
    const limit = options.limit ?? 5000;
    const offset = options.offset ?? 0;
    const symbolFilter =
      options.symbols && options.symbols.length > 0
        ? ` AND c.symbol IN (${options.symbols.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",")})`
        : "";
    const { sql: filterSql, params: filterParams } = buildFilterClauses(options.filters ?? {});
    const sql = `
      SELECT
        c.symbol, c.name, c.exchange, c.industry, c.sector,
        q.date, q.market_cap, q.last_price, q.change_pct, q.volume, q.avg_volume_30d_shares,
        q.high_52w, q.off_52w_high_pct, q.atr_pct_21d,
        (SELECT close FROM daily_bars WHERE symbol = c.symbol AND date < ? ORDER BY date DESC LIMIT 1) AS prev_close,
        i.price_change_1w_pct, i.price_change_1m_pct, i.price_change_3m_pct, i.price_change_6m_pct, i.price_change_12m_pct,
        i.rs_vs_spy_1w, i.rs_vs_spy_1m, i.rs_vs_spy_3m, i.rs_vs_spy_6m, i.rs_vs_spy_12m,
        i.rs_pct_1w, i.rs_pct_1m, i.rs_pct_3m, i.rs_pct_6m, i.rs_pct_12m,
        i.industry_rank_1m, i.industry_rank_3m, i.industry_rank_6m, i.industry_rank_12m,
        i.sector_rank_1m, i.sector_rank_3m, i.sector_rank_6m, i.sector_rank_12m
      FROM companies c
      INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
      LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
      WHERE 1=1 ${symbolFilter}${filterSql}
      ORDER BY c.symbol
      LIMIT ? OFFSET ?
    `;
    const stmt = db.prepare(sql);
    const rawRows = stmt.all(date, date, ...filterParams, limit, offset) as RowObject[];
    const marketClosed = !isUSMarketOpen();
    const rows = rawRows.map((r) => rowToScreenerRow(r, marketClosed));
    return { rows, date };
  } finally {
    db.close();
  }
}

export type DailyBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Get daily bars for a symbol up to asOfDate, newest-first. For Nino Script. */
export function getDailyBars(symbol: string, asOfDate: string, limit = 300): DailyBar[] {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        "SELECT date, open, high, low, close, volume FROM daily_bars WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT ?"
      )
      .all(symbol, asOfDate, limit) as Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
    return rows.map((r) => ({
      date: String(r.date),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  } finally {
    db.close();
  }
}
