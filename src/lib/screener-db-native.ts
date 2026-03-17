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

  if ((last_price == null || last_price <= 0) && prev_close != null && prev_close > 0) {
    last_price = prev_close;
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

export function getCompanyClassification(symbol: string): {
  sector?: string;
  industry?: string;
  exchange?: string;
} | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare(
      `
      SELECT sector, industry, exchange
      FROM companies
      WHERE symbol = ?
      LIMIT 1
      `
    )
    .get(String(symbol).toUpperCase()) as
    | { sector?: string | null; industry?: string | null; exchange?: string | null }
    | undefined;
  if (!row) return null;
  const sector = row.sector && String(row.sector).trim() !== "" ? String(row.sector).trim() : undefined;
  const industry =
    row.industry && String(row.industry).trim() !== "" ? String(row.industry).trim() : undefined;
  const exchange =
    row.exchange && String(row.exchange).trim() !== "" ? String(row.exchange).trim() : undefined;
  return { sector, industry, exchange };
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
      q.date,
      COALESCE(
        q.market_cap,
        c.shares_outstanding * COALESCE(
          q.last_price,
          q.prev_close,
          (SELECT close FROM daily_bars WHERE symbol = c.symbol AND date < q.date ORDER BY date DESC LIMIT 1)
        )
      ) AS market_cap,
      q.last_price, q.change_pct, q.volume, q.avg_volume_30d_shares,
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
  indexId: "sp500" | "nasdaq";
  indexName: string;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
  count50d: number;
  count200d: number;
};

export type IndexBreadthSeriesRow = {
  date: string;
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

function getPerformanceLookbackDays(timeframe: PerformanceTimeframe): number {
  switch (timeframe) {
    case "day":
      return 1;
    case "week":
      return 5;
    case "month":
      return 21;
    case "quarter":
      return 63;
    case "year":
      return 252;
    default:
      return 1;
  }
}

function getBufferStartDate(asOfDate: string, lookbackDays: number): string {
  const d = new Date(`${asOfDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Math.max(lookbackDays * 2 + 40, lookbackDays + 40));
  return d.toISOString().slice(0, 10);
}

function loadIndexSymbols(indexId: "sp500" | "nasdaq100" | "nasdaq"): string[] {
  if (indexId === "nasdaq") return [];
  const directPath = join(process.cwd(), "data", `${indexId}.json`);
  const bootstrapPath = join(process.cwd(), "bootstrap-data", `${indexId}.json`);
  const p = existsSync(directPath) ? directPath : existsSync(bootstrapPath) ? bootstrapPath : null;
  if (!p) return [];
  try {
    const raw = readFileSync(p, "utf8");
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.map((s) => String(s).toUpperCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeSymbolForDb(symbol: string): string {
  return String(symbol).toUpperCase().replace(/\./g, "-");
}

function expandIndexSymbolsForDb(symbols: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const sym = String(raw).toUpperCase().trim();
    if (!sym) continue;
    const variants = [sym, normalizeSymbolForDb(sym)];
    for (const v of variants) {
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function getTodayDateInNewYork(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function getLatestCompletedTradingDate(): string | null {
  const db = getDb();
  if (!db) return null;
  const nyToday = getTodayDateInNewYork();
  const companyCountRow = db.prepare("SELECT COUNT(*) AS c FROM companies").get() as { c: number } | undefined;
  const companyCount = Number(companyCountRow?.c ?? 0);
  const minCoverage = companyCount > 0 ? Math.max(200, Math.floor(companyCount * 0.8)) : 200;
  const recent = db
    .prepare(
      `
      SELECT date, COUNT(DISTINCT symbol) AS cnt
      FROM daily_bars
      WHERE date < ?
      GROUP BY date
      ORDER BY date DESC
      LIMIT 30
      `
    )
    .all(nyToday) as Array<{ date: string; cnt: number }>;
  if (recent.length === 0) return null;
  const reliable = recent.find((r) => Number(r.cnt ?? 0) >= minCoverage);
  return String(reliable?.date ?? recent[0].date);
}

export function getWeightedCategoryPerformance(
  groupBy: "sector" | "industry",
  timeframe: PerformanceTimeframe,
  date?: string
): { rows: WeightedCategoryPerformanceRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const asOfDate = date ?? getLatestCompletedTradingDate();
  if (!asOfDate) return { rows: [], date: null };
  const lookbackDays = getPerformanceLookbackDays(timeframe);
  const startDate = getBufferStartDate(asOfDate, lookbackDays);

  const sql = `
    WITH base AS (
      SELECT
        d.symbol,
        d.date,
        d.close,
        LAG(d.close, ${lookbackDays}) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
        ) AS prev_close
      FROM daily_bars d
      INNER JOIN companies c ON c.symbol = d.symbol
      WHERE d.date BETWEEN ? AND ?
    ),
    latest AS (
      SELECT
        b.symbol AS symbol,
        b.close AS close,
        b.prev_close AS prev_close
      FROM base b
      WHERE b.date <= ?
        AND b.prev_close > 0
        AND b.close > 0
        AND b.prev_close > 0
        AND b.date = (
          SELECT MAX(b2.date)
          FROM base b2
          WHERE b2.symbol = b.symbol
            AND b2.date <= ?
            AND b2.prev_close > 0
            AND b2.close > 0
        )
    ),
    latest_cap AS (
      SELECT q.symbol, q.market_cap
      FROM quote_daily q
      INNER JOIN (
        SELECT symbol, MAX(date) AS max_date
        FROM quote_daily
        WHERE date <= ?
        GROUP BY symbol
      ) x ON x.symbol = q.symbol AND x.max_date = q.date
    ),
    market_cap_by_symbol AS (
      SELECT
        l.symbol AS symbol,
        COALESCE(lc.market_cap, c.shares_outstanding * l.close) AS market_cap
      FROM latest l
      INNER JOIN companies c ON c.symbol = l.symbol
      LEFT JOIN latest_cap lc ON lc.symbol = l.symbol
    )
    SELECT
      c.${groupBy} AS name,
      SUM(
        mc.market_cap * ((l.close - l.prev_close) * 100.0 / NULLIF(l.prev_close, 0))
      ) / SUM(mc.market_cap) AS change_pct,
      SUM(mc.market_cap) AS total_market_cap,
      COUNT(*) AS stock_count
    FROM latest l
    INNER JOIN companies c ON c.symbol = l.symbol
    LEFT JOIN market_cap_by_symbol mc ON mc.symbol = l.symbol
    WHERE c.${groupBy} IS NOT NULL
      AND TRIM(c.${groupBy}) <> ''
      AND c.${groupBy} <> 'NA'
      AND mc.market_cap IS NOT NULL
      AND mc.market_cap > 0
    GROUP BY c.${groupBy}
    HAVING SUM(mc.market_cap) > 0
    ORDER BY change_pct DESC
  `;
  const rows = db.prepare(sql).all(startDate, asOfDate, asOfDate, asOfDate, asOfDate) as Array<{
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
  const asOfDate = date ?? getLatestCompletedTradingDate();
  if (!asOfDate || symbols.length === 0) return { rows: [], date: asOfDate ?? null };
  const unique = Array.from(new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean)));
  if (unique.length === 0) return { rows: [], date: asOfDate };
  const lookbackDays = getPerformanceLookbackDays(timeframe);
  const startDate = getBufferStartDate(asOfDate, lookbackDays);
  const placeholders = unique.map(() => "?").join(",");
  const sql = `
    WITH base AS (
      SELECT
        d.symbol,
        d.date,
        d.close,
        LAG(d.close, ${lookbackDays}) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
        ) AS prev_close
      FROM daily_bars d
      WHERE d.symbol IN (${placeholders})
        AND d.date BETWEEN ? AND ?
    ),
    latest AS (
      SELECT
        b.symbol AS symbol,
        b.close AS close,
        b.prev_close AS prev_close
      FROM base b
      WHERE b.date <= ?
        AND b.prev_close > 0
        AND b.close > 0
        AND b.date = (
          SELECT MAX(b2.date)
          FROM base b2
          WHERE b2.symbol = b.symbol
            AND b2.date <= ?
            AND b2.prev_close > 0
            AND b2.close > 0
        )
    ),
    latest_cap AS (
      SELECT q.symbol, q.market_cap
      FROM quote_daily q
      INNER JOIN (
        SELECT symbol, MAX(date) AS max_date
        FROM quote_daily
        WHERE date <= ?
        GROUP BY symbol
      ) x ON x.symbol = q.symbol AND x.max_date = q.date
    ),
    market_cap_by_symbol AS (
      SELECT
        l.symbol AS symbol,
        COALESCE(lc.market_cap, c.shares_outstanding * l.close) AS market_cap
      FROM latest l
      LEFT JOIN latest_cap lc ON lc.symbol = l.symbol
      LEFT JOIN companies c ON c.symbol = l.symbol
    )
    SELECT
      l.symbol AS symbol,
      ((l.close - l.prev_close) * 100.0 / NULLIF(l.prev_close, 0)) AS change_pct,
      mc.market_cap AS market_cap
    FROM latest l
    LEFT JOIN market_cap_by_symbol mc ON mc.symbol = l.symbol
  `;
  const rows = db.prepare(sql).all(...unique, startDate, asOfDate, asOfDate, asOfDate, asOfDate) as Array<{
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
  const asOfDate = date ?? getLatestCompletedTradingDate();
  if (!asOfDate) return { rows: [], date: null };

  const fallbackSymbolsForIndex = (
    indexId: "sp500" | "nasdaq",
    desiredCount: number
  ): string[] => {
    if (indexId === "nasdaq") {
      const rows = db
        .prepare(
          `
          SELECT d.symbol
          FROM daily_bars d
          INNER JOIN (
            SELECT symbol, MAX(date) AS max_date
            FROM daily_bars
            WHERE date <= ?
            GROUP BY symbol
          ) x ON x.symbol = d.symbol AND x.max_date = d.date
          INNER JOIN companies c ON c.symbol = d.symbol
          WHERE d.close IS NOT NULL
            AND c.exchange IS NOT NULL
            AND (UPPER(c.exchange) LIKE '%NASDAQ%' OR UPPER(c.exchange) = 'XNAS')
          ORDER BY d.symbol ASC
          `
        )
        .all(asOfDate) as Array<{ symbol: string }>;
      return rows.map((r) => String(r.symbol));
    }
    const rows = db
      .prepare(
        `
        SELECT q.symbol
        FROM quote_daily q
        INNER JOIN (
          SELECT symbol, MAX(date) AS max_date
          FROM quote_daily
          WHERE date <= ?
          GROUP BY symbol
        ) x ON x.symbol = q.symbol AND x.max_date = q.date
        INNER JOIN companies c ON c.symbol = q.symbol
        WHERE q.market_cap IS NOT NULL
          AND (c.exchange IS NULL OR UPPER(c.exchange) NOT LIKE '%OTC%')
        ORDER BY q.market_cap DESC
        LIMIT ?
        `
      )
      .all(asOfDate, desiredCount) as Array<{ symbol: string }>;
    return rows.map((r) => String(r.symbol));
  };

  const computeForSymbols = (
    indexId: "sp500" | "nasdaq",
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

  const sp500Symbols = (() => {
    const list = loadIndexSymbols("sp500");
    const base = list.length > 0 ? list : fallbackSymbolsForIndex("sp500", 500);
    return expandIndexSymbolsForDb(base);
  })();
  const nasdaqSymbols = (() => {
    const list = loadIndexSymbols("nasdaq");
    const base = list.length > 0 ? list : fallbackSymbolsForIndex("nasdaq", 0);
    return expandIndexSymbolsForDb(base);
  })();

  const sp500 = computeForSymbols("sp500", "S&P 500", sp500Symbols);
  const nasdaq = computeForSymbols("nasdaq", "Nasdaq Composite", nasdaqSymbols);
  return { rows: [sp500, nasdaq], date: asOfDate };
}

export function getIndexBreadthSeries(
  indexId: "sp500" | "nasdaq",
  startDate: string,
  endDate: string
): { rows: IndexBreadthSeriesRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };

  const fallbackSymbolsForIndex = (
    id: "sp500" | "nasdaq",
    desiredCount: number
  ): string[] => {
    if (id === "nasdaq") {
      const rows = db
        .prepare(
          `
          SELECT d.symbol
          FROM daily_bars d
          INNER JOIN (
            SELECT symbol, MAX(date) AS max_date
            FROM daily_bars
            WHERE date <= ?
            GROUP BY symbol
          ) x ON x.symbol = d.symbol AND x.max_date = d.date
          INNER JOIN companies c ON c.symbol = d.symbol
          WHERE d.close IS NOT NULL
            AND c.exchange IS NOT NULL
            AND (UPPER(c.exchange) LIKE '%NASDAQ%' OR UPPER(c.exchange) = 'XNAS')
          ORDER BY d.symbol ASC
          `
        )
        .all(endDate) as Array<{ symbol: string }>;
      return rows.map((r) => String(r.symbol));
    }
    const rows = db
      .prepare(
        `
        SELECT q.symbol
        FROM quote_daily q
        INNER JOIN (
          SELECT symbol, MAX(date) AS max_date
          FROM quote_daily
          WHERE date <= ?
          GROUP BY symbol
        ) x ON x.symbol = q.symbol AND x.max_date = q.date
        INNER JOIN companies c ON c.symbol = q.symbol
        WHERE q.market_cap IS NOT NULL
          AND (c.exchange IS NULL OR UPPER(c.exchange) NOT LIKE '%OTC%')
        ORDER BY q.market_cap DESC
        LIMIT ?
        `
      )
      .all(endDate, desiredCount) as Array<{ symbol: string }>;
    return rows.map((r) => String(r.symbol));
  };

  const list = loadIndexSymbols(indexId);
  const symbols = expandIndexSymbolsForDb(
    list.length > 0 ? list : fallbackSymbolsForIndex(indexId, indexId === "sp500" ? 500 : 0)
  );
  if (symbols.length === 0) return { rows: [], date: endDate };

  const symbolFilter = symbols.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",");
  const from = new Date(`${startDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 260);
  const bufferStartDate = from.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `
      WITH base AS (
        SELECT
          d.date,
          d.symbol,
          d.close,
          AVG(d.close) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
          ) AS ma50,
          AVG(d.close) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
          ) AS ma200,
          COUNT(d.close) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
          ) AS c50,
          COUNT(d.close) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
          ) AS c200
        FROM daily_bars d
        WHERE d.symbol IN (${symbolFilter})
          AND d.date BETWEEN ? AND ?
      )
      SELECT
        date,
        SUM(CASE WHEN c50 = 50 AND close > ma50 THEN 1 ELSE 0 END) AS above50,
        SUM(CASE WHEN c50 = 50 THEN 1 ELSE 0 END) AS count50,
        SUM(CASE WHEN c200 = 200 AND close > ma200 THEN 1 ELSE 0 END) AS above200,
        SUM(CASE WHEN c200 = 200 THEN 1 ELSE 0 END) AS count200
      FROM base
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date ASC
      `
    )
    .all(bufferStartDate, endDate, startDate, endDate) as Array<{
      date: string;
      above50: number;
      count50: number;
      above200: number;
      count200: number;
    }>;

  return {
    rows: rows.map((r) => {
      const count50 = Number(r.count50 ?? 0);
      const count200 = Number(r.count200 ?? 0);
      return {
        date: String(r.date),
        pctAbove50d: count50 > 0 ? (Number(r.above50 ?? 0) * 100) / count50 : null,
        pctAbove200d: count200 > 0 ? (Number(r.above200 ?? 0) * 100) / count200 : null,
        count50d: count50,
        count200d: count200,
      };
    }),
    date: endDate,
  };
}

export function getNetNewHighSeries(
  lookbackDays: number,
  displayDays = 60,
  date?: string
): { rows: NetNewHighRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const asOfDate = date ?? getLatestCompletedTradingDate();
  if (!asOfDate) return { rows: [], date: null };

  const displayDateRows = db
    .prepare(
      `
      SELECT date
      FROM daily_bars
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
      FROM daily_bars
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
          d.high,
          d.low,
          MAX(d.high) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING
          ) AS prior_high,
          MIN(d.low) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING
          ) AS prior_low,
          COUNT(d.high) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING
          ) AS prior_count
        FROM daily_bars d
        INNER JOIN universe u ON u.symbol = d.symbol
        WHERE d.date BETWEEN ? AND ?
      )
      SELECT
        date,
        SUM(CASE WHEN prior_count = ${lookbackDays} AND close > prior_high THEN 1 ELSE 0 END) AS highs,
        SUM(CASE WHEN prior_count = ${lookbackDays} AND close < prior_low THEN 1 ELSE 0 END) AS lows
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
        ) AS down50pct_month
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
    }));
}

export function getMarketMonitorBaseRowsFromDailyBars(startDate: string, endDate?: string): MarketMonitorBaseRow[] {
  const db = getDb();
  if (!db) return [];
  let toDate = endDate ?? null;
  if (!toDate) toDate = getLatestCompletedTradingDate();
  if (!toDate) return [];

  const from = new Date(`${startDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 320);
  const bufferStartDate = from.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `
      WITH base AS (
        SELECT
          d.symbol,
          d.date,
          d.close,
          d.volume,
          AVG(d.volume) OVER (
            PARTITION BY d.symbol
            ORDER BY d.date
            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
          ) AS avg_vol_30d,
          LAG(d.close, 1) OVER (PARTITION BY d.symbol ORDER BY d.date) AS close_1d,
          LAG(d.close, 21) OVER (PARTITION BY d.symbol ORDER BY d.date) AS close_1m,
          LAG(d.close, 63) OVER (PARTITION BY d.symbol ORDER BY d.date) AS close_3m
        FROM daily_bars d
        INNER JOIN companies c ON c.symbol = d.symbol
        WHERE d.date BETWEEN ? AND ?
      ),
      eligible AS (
        SELECT
          symbol,
          date,
          close,
          avg_vol_30d,
          CASE WHEN close > 5 AND COALESCE(avg_vol_30d, 0) >= 100000 THEN 1 ELSE 0 END AS in_universe,
          CASE WHEN close_1d > 0 THEN (close - close_1d) * 100.0 / close_1d ELSE NULL END AS chg_1d,
          CASE WHEN close_1m > 0 THEN (close - close_1m) * 100.0 / close_1m ELSE NULL END AS chg_1m,
          CASE WHEN close_3m > 0 THEN (close - close_3m) * 100.0 / close_3m ELSE NULL END AS chg_3m
        FROM base
      )
      SELECT
        date,
        SUM(CASE WHEN in_universe = 1 THEN 1 ELSE 0 END) AS universe,
        SUM(CASE WHEN in_universe = 1 AND chg_1d >= 4 THEN 1 ELSE 0 END) AS up4pct,
        SUM(CASE WHEN in_universe = 1 AND chg_1d <= -4 THEN 1 ELSE 0 END) AS down4pct,
        SUM(CASE WHEN in_universe = 1 AND chg_3m >= 25 THEN 1 ELSE 0 END) AS up25pct_qtr,
        SUM(CASE WHEN in_universe = 1 AND chg_3m <= -25 THEN 1 ELSE 0 END) AS down25pct_qtr,
        SUM(CASE WHEN in_universe = 1 AND chg_1m >= 25 THEN 1 ELSE 0 END) AS up25pct_month,
        SUM(CASE WHEN in_universe = 1 AND chg_1m <= -25 THEN 1 ELSE 0 END) AS down25pct_month,
        SUM(CASE WHEN in_universe = 1 AND chg_1m >= 50 THEN 1 ELSE 0 END) AS up50pct_month,
        SUM(CASE WHEN in_universe = 1 AND chg_1m <= -50 THEN 1 ELSE 0 END) AS down50pct_month
      FROM eligible
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date ASC
      `
    )
    .all(bufferStartDate, toDate, startDate, toDate) as Array<{
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
  }));
}

