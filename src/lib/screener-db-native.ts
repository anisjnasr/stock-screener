/**
 * Screener DB access using better-sqlite3 (opens file on disk, no full load).
 * Singleton connection with production-grade PRAGMA tuning for 5GB+ databases.
 * API route should try this first so watchlists/lists get sector, ATR, etc. from the DB.
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";
import { isUSMarketOpen } from "@/lib/market-hours";
import { buildFilterClauses, type ScreenerFilters, type ScreenerRow } from "@/lib/screener-db";

const DB_PATH = join(process.cwd(), "data", "screener.db");

type BetterSqlite3Database = InstanceType<typeof Database>;

const globalForDb = globalThis as unknown as {
  _screenerDb?: BetterSqlite3Database;
  _screenerDbPath?: string;
};

function getDb(): BetterSqlite3Database | null {
  if (globalForDb._screenerDb && globalForDb._screenerDbPath === DB_PATH) {
    try {
      globalForDb._screenerDb.prepare("SELECT 1").get();
      return globalForDb._screenerDb;
    } catch {
      globalForDb._screenerDb = undefined;
    }
  }
  if (!existsSync(DB_PATH)) return null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA cache_size = -512000");  // 512 MB page cache
    db.exec("PRAGMA mmap_size = 5368709120"); // 5 GB memory-mapped I/O
    db.exec("PRAGMA temp_store = MEMORY");
    db.exec("PRAGMA busy_timeout = 5000");
    globalForDb._screenerDb = db;
    globalForDb._screenerDbPath = DB_PATH;
    return db;
  } catch {
    return null;
  }
}

type RowObject = Record<string, unknown>;
type DateCoverageRow = { date: string; cnt: number };

function getLatestReliableScreenerDateFromDb(db: BetterSqlite3Database): string | null {
  const latestRow = db.prepare("SELECT MAX(date) AS d FROM quote_daily").get() as { d: string | null } | undefined;
  const latestDate = latestRow?.d != null ? String(latestRow.d) : null;
  if (!latestDate) return null;

  const companyCountRow = db.prepare("SELECT COUNT(*) AS c FROM companies").get() as { c: number } | undefined;
  const companyCount = Number(companyCountRow?.c ?? 0);
  const minCoverage = companyCount > 0 ? Math.max(200, Math.floor(companyCount * 0.8)) : 200;

  const coverageRows = db
    .prepare(
      `
      WITH recent_dates AS (
        SELECT date
        FROM quote_daily
        GROUP BY date
        ORDER BY date DESC
        LIMIT 40
      )
      SELECT rd.date AS date, COUNT(q.symbol) AS cnt
      FROM recent_dates rd
      LEFT JOIN quote_daily q ON q.date = rd.date
      GROUP BY rd.date
      ORDER BY rd.date DESC
      `
    )
    .all() as Array<{ date: string; cnt: number }>;

  const reliable = coverageRows.find((r) => Number(r.cnt ?? 0) >= minCoverage);
  if (reliable?.date) return String(reliable.date);

  let best: DateCoverageRow | null = null;
  for (const r of coverageRows) {
    const row: DateCoverageRow = { date: String(r.date), cnt: Number(r.cnt ?? 0) };
    if (!best || row.cnt > best.cnt || (row.cnt === best.cnt && row.date > best.date)) {
      best = row;
    }
  }
  return best && best.cnt > 0 ? best.date : latestDate;
}

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
  const db = getDb();
  if (!db) return null;
  return getLatestReliableScreenerDateFromDb(db);
}

export function getScreenerCount(options: {
  date?: string;
  symbols?: string[];
  filters?: ScreenerFilters;
}): { count: number; date: string | null } {
  const db = getDb();
  if (!db) return { count: 0, date: null };
  let date = options.date ?? null;
  if (!date) date = getLatestScreenerDate();
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
}

export function getScreenerSnapshot(options: {
  date?: string;
  symbols?: string[];
  limit?: number;
  offset?: number;
  filters?: ScreenerFilters;
}): { rows: ScreenerRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
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
      COALESCE(q.prev_close, (SELECT close FROM daily_bars WHERE symbol = c.symbol AND date < q.date ORDER BY date DESC LIMIT 1)) AS prev_close,
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
  const rawRows = stmt.all(date, ...filterParams, limit, offset) as RowObject[];
  const marketClosed = !isUSMarketOpen();
  const rows = rawRows.map((r) => rowToScreenerRow(r, marketClosed));
  return { rows, date };
}

export type DailyBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Get daily bars for a symbol up to asOfDate, newest-first. For Nino Script. */
export function getDailyBars(symbol: string, asOfDate: string, limit = 300): DailyBar[] {
  const db = getDb();
  if (!db) return [];
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
}

export type MarketMonitorBaseRow = {
  date: string;
  up4pct: number;
  down4pct: number;
  up25pct_qtr: number;
  down25pct_qtr: number;
  up25pct_month: number;
  down25pct_month: number;
  up50pct_month: number;
  down50pct_month: number;
  up13pct_34d: number;
  down13pct_34d: number;
  universe: number;
};

export function getMarketMonitorBaseRows(startDate: string, endDate?: string): MarketMonitorBaseRow[] {
  const db = getDb();
  if (!db) return [];
  let toDate = endDate ?? null;
  if (!toDate) toDate = getLatestScreenerDate();
  if (!toDate) return [];
  const stmt = db.prepare(
      `
      SELECT
        q.date AS date,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
              THEN 1
            ELSE 0
          END
        ) AS universe,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND q.change_pct >= 4
              THEN 1
            ELSE 0
          END
        ) AS up4pct,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND q.change_pct <= -4
              THEN 1
            ELSE 0
          END
        ) AS down4pct,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_3m_pct >= 25
              THEN 1
            ELSE 0
          END
        ) AS up25pct_qtr,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_3m_pct <= -25
              THEN 1
            ELSE 0
          END
        ) AS down25pct_qtr,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_1m_pct >= 25
              THEN 1
            ELSE 0
          END
        ) AS up25pct_month,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_1m_pct <= -25
              THEN 1
            ELSE 0
          END
        ) AS down25pct_month,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_1m_pct >= 50
              THEN 1
            ELSE 0
          END
        ) AS up50pct_month,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_1m_pct <= -50
              THEN 1
            ELSE 0
          END
        ) AS down50pct_month,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_1m_pct >= 13
              THEN 1
            ELSE 0
          END
        ) AS up13pct_34d,
        SUM(
          CASE
            WHEN COALESCE(q.last_price, 0) > 5
             AND COALESCE(q.avg_volume_30d_shares, q.volume, 0) >= 100000
             AND i.price_change_1m_pct <= -13
              THEN 1
            ELSE 0
          END
        ) AS down13pct_34d
      FROM quote_daily q
      LEFT JOIN indicators_daily i ON i.symbol = q.symbol AND i.date = q.date
      WHERE q.date BETWEEN ? AND ?
      GROUP BY q.date
      ORDER BY q.date ASC
      `
    );
    const rows = stmt.all(startDate, toDate) as Array<{
      date: string;
      universe: number;
      up4pct: number;
      down4pct: number;
      up25pct_qtr: number;
      down25pct_qtr: number;
      up25pct_month: number;
      down25pct_month: number;
      up50pct_month: number;
      down50pct_month: number;
      up13pct_34d: number;
      down13pct_34d: number;
    }>;
    return rows.map((r) => ({
      date: String(r.date),
      universe: Number(r.universe ?? 0),
      up4pct: Number(r.up4pct ?? 0),
      down4pct: Number(r.down4pct ?? 0),
      up25pct_qtr: Number(r.up25pct_qtr ?? 0),
      down25pct_qtr: Number(r.down25pct_qtr ?? 0),
      up25pct_month: Number(r.up25pct_month ?? 0),
      down25pct_month: Number(r.down25pct_month ?? 0),
      up50pct_month: Number(r.up50pct_month ?? 0),
      down50pct_month: Number(r.down50pct_month ?? 0),
      up13pct_34d: Number(r.up13pct_34d ?? 0),
      down13pct_34d: Number(r.down13pct_34d ?? 0),
    }));
}

