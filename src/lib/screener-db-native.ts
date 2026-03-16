/**
 * Screener DB access using better-sqlite3 (opens file on disk, no full load).
 * Singleton connection with production-grade PRAGMA tuning for 5GB+ databases.
 * API route should try this first so watchlists/lists get sector, ATR, etc. from the DB.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
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

export type PerformanceTimeframe = "day" | "week" | "month" | "quarter" | "year";

export type WeightedCategoryPerformanceRow = {
  name: string;
  change_pct: number;
  total_market_cap: number;
  stock_count: number;
};

export type TickerPerformanceRow = {
  symbol: string;
  change_pct: number;
  market_cap: number | null;
};

export type IndexBreadthRow = {
  indexId: "sp500" | "nasdaq100";
  indexName: string;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
  count50d: number;
  count200d: number;
};

export type NetNewHighRow = {
  date: string;
  highs: number;
  lows: number;
  net: number;
};

function getPerformanceColumn(timeframe: PerformanceTimeframe): string {
  switch (timeframe) {
    case "day":
      return "q.change_pct";
    case "week":
      return "i.price_change_1w_pct";
    case "month":
      return "i.price_change_1m_pct";
    case "quarter":
      return "i.price_change_3m_pct";
    case "year":
      return "i.price_change_12m_pct";
    default:
      return "q.change_pct";
  }
}

function loadIndexSymbols(indexId: "sp500" | "nasdaq100"): string[] {
  const p = join(process.cwd(), "data", `${indexId}.json`);
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, "utf8");
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.map((s) => String(s).toUpperCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function getWeightedCategoryPerformance(
  groupBy: "sector" | "industry",
  timeframe: PerformanceTimeframe,
  date?: string
): { rows: WeightedCategoryPerformanceRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const asOfDate = date ?? getLatestScreenerDate();
  if (!asOfDate) return { rows: [], date: null };
  const perfCol = getPerformanceColumn(timeframe);
  const sql = `
    SELECT
      c.${groupBy} AS name,
      SUM(q.market_cap * ${perfCol}) / SUM(q.market_cap) AS change_pct,
      SUM(q.market_cap) AS total_market_cap,
      COUNT(*) AS stock_count
    FROM companies c
    INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
    LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
    WHERE c.${groupBy} IS NOT NULL
      AND TRIM(c.${groupBy}) <> ''
      AND c.${groupBy} <> 'NA'
      AND q.market_cap IS NOT NULL
      AND q.market_cap > 0
      AND ${perfCol} IS NOT NULL
    GROUP BY c.${groupBy}
    HAVING SUM(q.market_cap) > 0
    ORDER BY change_pct DESC
  `;
  const rows = db.prepare(sql).all(asOfDate) as Array<{
    name: string;
    change_pct: number;
    total_market_cap: number;
    stock_count: number;
  }>;
  return {
    rows: rows.map((r) => ({
      name: String(r.name),
      change_pct: Number(r.change_pct ?? 0),
      total_market_cap: Number(r.total_market_cap ?? 0),
      stock_count: Number(r.stock_count ?? 0),
    })),
    date: asOfDate,
  };
}

export function getTickerPerformance(
  symbols: string[],
  timeframe: PerformanceTimeframe,
  date?: string
): { rows: TickerPerformanceRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const asOfDate = date ?? getLatestScreenerDate();
  if (!asOfDate || symbols.length === 0) return { rows: [], date: asOfDate ?? null };
  const unique = Array.from(new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean)));
  if (unique.length === 0) return { rows: [], date: asOfDate };
  const perfCol = getPerformanceColumn(timeframe);
  const placeholders = unique.map(() => "?").join(",");
  const sql = `
    SELECT
      q.symbol AS symbol,
      ${perfCol} AS change_pct,
      q.market_cap AS market_cap
    FROM quote_daily q
    LEFT JOIN indicators_daily i ON i.symbol = q.symbol AND i.date = q.date
    WHERE q.date = ?
      AND q.symbol IN (${placeholders})
      AND ${perfCol} IS NOT NULL
  `;
  const rows = db.prepare(sql).all(asOfDate, ...unique) as Array<{
    symbol: string;
    change_pct: number;
    market_cap: number | null;
  }>;
  return {
    rows: rows.map((r) => ({
      symbol: String(r.symbol),
      change_pct: Number(r.change_pct ?? 0),
      market_cap: typeof r.market_cap === "number" ? Number(r.market_cap) : null,
    })),
    date: asOfDate,
  };
}

export function getIndexBreadthSnapshot(date?: string): { rows: IndexBreadthRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const asOfDate = date ?? getLatestScreenerDate();
  if (!asOfDate) return { rows: [], date: null };

  const computeForSymbols = (
    indexId: "sp500" | "nasdaq100",
    indexName: string,
    symbols: string[]
  ): IndexBreadthRow => {
    if (symbols.length === 0) {
      return { indexId, indexName, pctAbove50d: null, pctAbove200d: null, count50d: 0, count200d: 0 };
    }
    const symbolFilter = symbols.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",");
    const sql = `
      SELECT
        SUM(CASE WHEN close_now > ma50 THEN 1 ELSE 0 END) AS above50,
        SUM(CASE WHEN ma50 IS NOT NULL THEN 1 ELSE 0 END) AS count50,
        SUM(CASE WHEN close_now > ma200 THEN 1 ELSE 0 END) AS above200,
        SUM(CASE WHEN ma200 IS NOT NULL THEN 1 ELSE 0 END) AS count200
      FROM (
        SELECT
          s.symbol AS symbol,
          (
            SELECT close
            FROM daily_bars d
            WHERE d.symbol = s.symbol AND d.date <= ?
            ORDER BY d.date DESC
            LIMIT 1
          ) AS close_now,
          (
            SELECT AVG(close)
            FROM (
              SELECT close
              FROM daily_bars d
              WHERE d.symbol = s.symbol AND d.date <= ?
              ORDER BY d.date DESC
              LIMIT 50
            )
          ) AS ma50,
          (
            SELECT AVG(close)
            FROM (
              SELECT close
              FROM daily_bars d
              WHERE d.symbol = s.symbol AND d.date <= ?
              ORDER BY d.date DESC
              LIMIT 200
            )
          ) AS ma200
        FROM (
          SELECT symbol
          FROM companies
          WHERE symbol IN (${symbolFilter})
        ) s
      ) x
    `;
    const row = db.prepare(sql).get(asOfDate, asOfDate, asOfDate) as
      | { above50: number; count50: number; above200: number; count200: number }
      | undefined;
    const count50 = Number(row?.count50 ?? 0);
    const count200 = Number(row?.count200 ?? 0);
    const above50 = Number(row?.above50 ?? 0);
    const above200 = Number(row?.above200 ?? 0);
    return {
      indexId,
      indexName,
      pctAbove50d: count50 > 0 ? (above50 / count50) * 100 : null,
      pctAbove200d: count200 > 0 ? (above200 / count200) * 100 : null,
      count50d: count50,
      count200d: count200,
    };
  };

  const sp500 = computeForSymbols("sp500", "S&P 500", loadIndexSymbols("sp500"));
  const nasdaq = computeForSymbols("nasdaq100", "Nasdaq", loadIndexSymbols("nasdaq100"));
  return { rows: [sp500, nasdaq], date: asOfDate };
}

export function getNetNewHighSeries(
  lookbackDays: number,
  displayDays = 60,
  date?: string
): { rows: NetNewHighRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const asOfDate = date ?? getLatestScreenerDate();
  if (!asOfDate) return { rows: [], date: null };

  const displayDateRows = db
    .prepare(
      `
      SELECT date
      FROM quote_daily
      WHERE date <= ?
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?
      `
    )
    .all(asOfDate, Math.max(5, displayDays)) as Array<{ date: string }>;
  const displayDatesAsc = displayDateRows.map((r) => String(r.date)).reverse();
  if (displayDatesAsc.length === 0) return { rows: [], date: asOfDate };

  const earliestDisplayDate = displayDatesAsc[0];
  const startRow = db
    .prepare(
      `
      SELECT date
      FROM quote_daily
      WHERE date <= ?
      GROUP BY date
      ORDER BY date DESC
      LIMIT 1 OFFSET ?
      `
    )
    .get(earliestDisplayDate, Math.max(0, lookbackDays + 20)) as { date?: string } | undefined;
  const startDate = startRow?.date ? String(startRow.date) : earliestDisplayDate;

  const rows = db
    .prepare(
      `
      WITH universe AS (
        SELECT DISTINCT symbol
        FROM companies
      ),
      base AS (
        SELECT
          d.symbol,
          d.date,
          d.close,
          MAX(d.close) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN ${lookbackDays - 1} PRECEDING AND CURRENT ROW
          ) AS rolling_high,
          MIN(d.close) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN ${lookbackDays - 1} PRECEDING AND CURRENT ROW
          ) AS rolling_low,
          COUNT(d.close) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN ${lookbackDays - 1} PRECEDING AND CURRENT ROW
          ) AS window_count
        FROM daily_bars d
        INNER JOIN universe u ON u.symbol = d.symbol
        WHERE d.date BETWEEN ? AND ?
      )
      SELECT
        date,
        SUM(CASE WHEN window_count = ${lookbackDays} AND close >= rolling_high THEN 1 ELSE 0 END) AS highs,
        SUM(CASE WHEN window_count = ${lookbackDays} AND close <= rolling_low THEN 1 ELSE 0 END) AS lows
      FROM base
      GROUP BY date
      ORDER BY date ASC
      `
    )
    .all(startDate, asOfDate) as Array<{ date: string; highs: number; lows: number }>;

  const displayDateSet = new Set(displayDatesAsc);
  return {
    rows: rows
      .filter((r) => displayDateSet.has(String(r.date)))
      .map((r) => {
        const highs = Number(r.highs ?? 0);
        const lows = Number(r.lows ?? 0);
        return {
          date: String(r.date),
          highs,
          lows,
          net: highs - lows,
        };
      }),
    date: asOfDate,
  };
}

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

