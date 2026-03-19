/**
 * Screener DB access using better-sqlite3 (opens file on disk, no full load).
 * Singleton connection with PRAGMA tuning sized for 512MB instances.
 *
 * This is the sole DB access layer. All screener data flows through here.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { isUSMarketOpen } from "@/lib/market-hours";

/* ── Shared types & filter builder (previously in screener-db.ts) ── */

export type ScreenerFilters = Record<string, string | number | undefined>;

export type ScreenerRow = {
  symbol: string;
  name: string;
  exchange: string | null;
  industry: string | null;
  sector: string | null;
  date: string;
  market_cap: number | null;
  last_price: number | null;
  change_pct: number | null;
  volume: number | null;
  avg_volume_30d_shares: number | null;
  high_52w: number | null;
  off_52w_high_pct: number | null;
  atr_pct_21d: number | null;
  price_change_1w_pct: number | null;
  price_change_1m_pct: number | null;
  price_change_3m_pct: number | null;
  price_change_6m_pct: number | null;
  price_change_12m_pct: number | null;
  rs_vs_spy_1w: number | null;
  rs_vs_spy_1m: number | null;
  rs_vs_spy_3m: number | null;
  rs_vs_spy_6m: number | null;
  rs_vs_spy_12m: number | null;
  rs_pct_1w: number | null;
  rs_pct_1m: number | null;
  rs_pct_3m: number | null;
  rs_pct_6m: number | null;
  rs_pct_12m: number | null;
  industry_rank_1m: number | null;
  industry_rank_3m: number | null;
  industry_rank_6m: number | null;
  industry_rank_12m: number | null;
  sector_rank_1m: number | null;
  sector_rank_3m: number | null;
  sector_rank_6m: number | null;
  sector_rank_12m: number | null;
  [key: string]: unknown;
};

export function buildFilterClauses(filters: ScreenerFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const num = (v: string | number | undefined): number | null =>
    v === undefined || v === "" ? null : typeof v === "number" ? v : Number(v);
  const str = (v: string | number | undefined): string | null =>
    v === undefined || v === "" ? null : String(v).trim() || null;

  if (num(filters.market_cap_min) != null) { conditions.push(" AND q.market_cap >= ?"); params.push(num(filters.market_cap_min)); }
  if (num(filters.market_cap_max) != null) { conditions.push(" AND q.market_cap <= ?"); params.push(num(filters.market_cap_max)); }
  if (num(filters.last_price_min) != null) { conditions.push(" AND q.last_price >= ?"); params.push(num(filters.last_price_min)); }
  if (num(filters.last_price_max) != null) { conditions.push(" AND q.last_price <= ?"); params.push(num(filters.last_price_max)); }
  if (num(filters.change_pct_min) != null) { conditions.push(" AND q.change_pct >= ?"); params.push(num(filters.change_pct_min)); }
  if (num(filters.change_pct_max) != null) { conditions.push(" AND q.change_pct <= ?"); params.push(num(filters.change_pct_max)); }
  if (num(filters.volume_min) != null) { conditions.push(" AND q.volume >= ?"); params.push(num(filters.volume_min)); }
  if (num(filters.volume_max) != null) { conditions.push(" AND q.volume <= ?"); params.push(num(filters.volume_max)); }
  if (num(filters.avg_volume_30d_min) != null) { conditions.push(" AND q.avg_volume_30d_shares >= ?"); params.push(num(filters.avg_volume_30d_min)); }
  if (num(filters.high_52w_min) != null) { conditions.push(" AND q.high_52w >= ?"); params.push(num(filters.high_52w_min)); }
  if (num(filters.off_52w_high_pct_min) != null) { conditions.push(" AND q.off_52w_high_pct >= ?"); params.push(num(filters.off_52w_high_pct_min)); }
  if (num(filters.off_52w_high_pct_max) != null) { conditions.push(" AND q.off_52w_high_pct <= ?"); params.push(num(filters.off_52w_high_pct_max)); }
  if (num(filters.atr_pct_21d_min) != null) { conditions.push(" AND q.atr_pct_21d >= ?"); params.push(num(filters.atr_pct_21d_min)); }
  if (num(filters.atr_pct_21d_max) != null) { conditions.push(" AND q.atr_pct_21d <= ?"); params.push(num(filters.atr_pct_21d_max)); }

  const industryInclude = str(filters.industry_include);
  if (industryInclude != null) {
    const vals = industryInclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) { conditions.push(` AND c.industry IN (${vals.map(() => "?").join(",")})`); vals.forEach((v) => params.push(v)); }
  }
  const industryExclude = str(filters.industry_exclude);
  if (industryExclude != null) {
    const vals = industryExclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) { conditions.push(` AND c.industry NOT IN (${vals.map(() => "?").join(",")})`); vals.forEach((v) => params.push(v)); }
  }
  const sectorInclude = str(filters.sector_include);
  if (sectorInclude != null) {
    const vals = sectorInclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) { conditions.push(` AND c.sector IN (${vals.map(() => "?").join(",")})`); vals.forEach((v) => params.push(v)); }
  }
  const sectorExclude = str(filters.sector_exclude);
  if (sectorExclude != null) {
    const vals = sectorExclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) { conditions.push(` AND c.sector NOT IN (${vals.map(() => "?").join(",")})`); vals.forEach((v) => params.push(v)); }
  }
  if (filters.is_adr !== undefined && filters.is_adr !== "" && filters.is_adr !== "any") {
    conditions.push(" AND c.is_adr = ?");
    params.push(filters.is_adr === "1" || filters.is_adr === 1 ? 1 : 0);
  }
  if (filters.is_etf !== undefined && filters.is_etf !== "" && filters.is_etf !== "any") {
    conditions.push(" AND c.is_etf = ?");
    params.push(filters.is_etf === "1" || filters.is_etf === 1 ? 1 : 0);
  }
  const ipoFrom = str(filters.ipo_date_from);
  const effectiveIpoDateExpr = "COALESCE(c.ipo_date, (SELECT MIN(b.date) FROM daily_bars b WHERE b.symbol = c.symbol))";
  if (ipoFrom != null) { conditions.push(` AND ${effectiveIpoDateExpr} >= ?`); params.push(ipoFrom); }
  const ipoTo = str(filters.ipo_date_to);
  if (ipoTo != null) { conditions.push(` AND ${effectiveIpoDateExpr} <= ?`); params.push(ipoTo); }
  if (num(filters.shares_outstanding_min) != null) { conditions.push(" AND c.shares_outstanding >= ?"); params.push(num(filters.shares_outstanding_min)); }
  if (num(filters.shares_outstanding_max) != null) { conditions.push(" AND c.shares_outstanding <= ?"); params.push(num(filters.shares_outstanding_max)); }

  const priceChangePeriods = ["1w", "1m", "3m", "6m", "12m"] as const;
  for (const period of priceChangePeriods) {
    const col = `price_change_${period}_pct`;
    const minVal = num(filters[`${col}_min`]);
    const maxVal = num(filters[`${col}_max`]);
    if (minVal != null) { conditions.push(` AND i.${col} >= ?`); params.push(minVal); }
    if (maxVal != null) { conditions.push(` AND i.${col} <= ?`); params.push(maxVal); }
  }
  const rsPctPeriods = ["1w", "1m", "3m", "6m", "12m"] as const;
  for (const period of rsPctPeriods) {
    const col = `rs_pct_${period}`;
    const minVal = num(filters[`${col}_min`]);
    const maxVal = num(filters[`${col}_max`]);
    if (minVal != null) { conditions.push(` AND i.${col} >= ?`); params.push(minVal); }
    if (maxVal != null) { conditions.push(` AND i.${col} <= ?`); params.push(maxVal); }
  }
  const rankPeriods = ["1m", "3m", "6m", "12m"] as const;
  for (const period of rankPeriods) {
    const minVal = num(filters[`industry_rank_${period}_min`]);
    const maxVal = num(filters[`industry_rank_${period}_max`]);
    if (minVal != null) { conditions.push(` AND i.industry_rank_${period} >= ?`); params.push(minVal); }
    if (maxVal != null) { conditions.push(` AND i.industry_rank_${period} <= ?`); params.push(maxVal); }
  }
  for (const period of rankPeriods) {
    const minVal = num(filters[`sector_rank_${period}_min`]);
    const maxVal = num(filters[`sector_rank_${period}_max`]);
    if (minVal != null) { conditions.push(` AND i.sector_rank_${period} >= ?`); params.push(minVal); }
    if (maxVal != null) { conditions.push(` AND i.sector_rank_${period} <= ?`); params.push(maxVal); }
  }
  return { sql: conditions.join(""), params };
}

/* ── Helpers for parameterized symbol lists ── */

function symbolPlaceholders(symbols: string[]): { placeholders: string; values: string[] } {
  const values = symbols.map((s) => String(s).toUpperCase());
  return { placeholders: values.map(() => "?").join(","), values };
}

const DB_PATH = join(process.cwd(), "data", "screener.db");

type BetterSqlite3Database = InstanceType<typeof Database>;

const DB_STAT_CHECK_INTERVAL_MS = 5_000;

const globalForDb = globalThis as unknown as {
  _screenerDb?: BetterSqlite3Database;
  _screenerDbPath?: string;
  _screenerDbMtimeMs?: number;
  _screenerDbIno?: number;
  _screenerDbLastStatCheck?: number;
};

function dbFileChanged(): boolean {
  const now = Date.now();
  if (
    globalForDb._screenerDbLastStatCheck &&
    now - globalForDb._screenerDbLastStatCheck < DB_STAT_CHECK_INTERVAL_MS
  ) {
    return false;
  }
  globalForDb._screenerDbLastStatCheck = now;
  try {
    const st = statSync(DB_PATH);
    if (
      globalForDb._screenerDbMtimeMs !== undefined &&
      (st.mtimeMs !== globalForDb._screenerDbMtimeMs ||
        st.ino !== globalForDb._screenerDbIno)
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function openDb(): BetterSqlite3Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -64000");
  db.exec("PRAGMA mmap_size = 268435456");
  db.exec("PRAGMA temp_store = FILE");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA read_uncommitted = ON");

  const st = statSync(DB_PATH);
  globalForDb._screenerDb = db;
  globalForDb._screenerDbPath = DB_PATH;
  globalForDb._screenerDbMtimeMs = st.mtimeMs;
  globalForDb._screenerDbIno = st.ino;
  globalForDb._screenerDbLastStatCheck = Date.now();
  return db;
}

function getDb(): BetterSqlite3Database | null {
  if (globalForDb._screenerDb && globalForDb._screenerDbPath === DB_PATH) {
    if (dbFileChanged()) {
      try { globalForDb._screenerDb.close(); } catch { /* ignore */ }
      globalForDb._screenerDb = undefined;
    } else {
      try {
        globalForDb._screenerDb.prepare("SELECT 1").get();
        return globalForDb._screenerDb;
      } catch {
        globalForDb._screenerDb = undefined;
      }
    }
  }
  if (!existsSync(DB_PATH)) return null;
  try {
    return openDb();
  } catch {
    return null;
  }
}

type RowObject = Record<string, unknown>;
type DateCoverageRow = { date: string; cnt: number };
export type OwnershipQuarterNative = {
  report_date: string;
  num_funds: number | null;
  num_funds_change: number | null;
  top_holders: Array<{ name: string; value?: number; shares?: number | null }>;
};
export type FinancialLineNative = {
  period_end: string;
  period_type: "annual" | "quarterly";
  eps: number | null;
  eps_growth_yoy: number | null;
  sales: number | null;
  sales_growth_yoy: number | null;
};

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

export function getOwnershipNative(symbol: string, limit = 8): OwnershipQuarterNative[] {
  const db = getDb();
  if (!db) return [];
  const safeLimit = Math.max(1, Math.min(40, Number(limit) || 8));
  const rows = db
    .prepare(
      `
      SELECT report_date, num_funds, num_funds_change, top_holders
      FROM ownership
      WHERE symbol = ?
      ORDER BY report_date DESC
      LIMIT ?
      `
    )
    .all(String(symbol).toUpperCase(), safeLimit) as Array<{
    report_date: string;
    num_funds: number | null;
    num_funds_change: number | null;
    top_holders: string | null;
  }>;

  return rows.map((r) => {
    let top_holders: OwnershipQuarterNative["top_holders"] = [];
    if (r.top_holders) {
      try {
        const parsed = JSON.parse(String(r.top_holders));
        if (Array.isArray(parsed)) top_holders = parsed;
      } catch {
        /* ignore malformed JSON */
      }
    }
    return {
      report_date: String(r.report_date),
      num_funds: r.num_funds != null ? Number(r.num_funds) : null,
      num_funds_change: r.num_funds_change != null ? Number(r.num_funds_change) : null,
      top_holders,
    };
  });
}

export function getFinancialsNative(
  symbol: string,
  periodType: "annual" | "quarterly",
  limit = 40
): FinancialLineNative[] {
  const db = getDb();
  if (!db) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 40));
  const rows = db
    .prepare(
      `
      SELECT period_end, period_type, eps, eps_growth_yoy, sales, sales_growth_yoy
      FROM financials
      WHERE symbol = ?
        AND period_type = ?
      ORDER BY period_end DESC
      LIMIT ?
      `
    )
    .all(String(symbol).toUpperCase(), periodType, safeLimit) as Array<{
    period_end: string;
    period_type: string;
    eps: number | null;
    eps_growth_yoy: number | null;
    sales: number | null;
    sales_growth_yoy: number | null;
  }>;

  return rows.map((r) => ({
    period_end: String(r.period_end),
    period_type: r.period_type === "annual" ? "annual" : "quarterly",
    eps: r.eps != null ? Number(r.eps) : null,
    eps_growth_yoy: r.eps_growth_yoy != null ? Number(r.eps_growth_yoy) : null,
    sales: r.sales != null ? Number(r.sales) : null,
    sales_growth_yoy: r.sales_growth_yoy != null ? Number(r.sales_growth_yoy) : null,
  }));
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
  const symFilter = options.symbols && options.symbols.length > 0
    ? symbolPlaceholders(options.symbols)
    : null;
  const symbolSql = symFilter ? ` AND c.symbol IN (${symFilter.placeholders})` : "";
  const { sql: filterSql, params: filterParams } = buildFilterClauses(options.filters ?? {});
  const sql = `
    SELECT COUNT(*) AS cnt FROM companies c
    INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
    LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
    WHERE 1=1 ${symbolSql}${filterSql}
  `;
  const stmt = db.prepare(sql);
  const row = stmt.get(date, ...(symFilter?.values ?? []), ...filterParams) as { cnt: number };
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
  const symFilter = options.symbols && options.symbols.length > 0
    ? symbolPlaceholders(options.symbols)
    : null;
  const symbolSql = symFilter ? ` AND c.symbol IN (${symFilter.placeholders})` : "";
  const { sql: filterSql, params: filterParams } = buildFilterClauses(options.filters ?? {});
  const sql = `
    SELECT
      c.symbol, c.name, c.exchange, c.industry, c.sector,
      q.date,
      COALESCE(q.market_cap, c.shares_outstanding * COALESCE(q.last_price, q.prev_close)) AS market_cap,
      q.last_price, q.change_pct, q.volume, q.avg_volume_30d_shares,
      q.high_52w, q.off_52w_high_pct, q.atr_pct_21d,
      q.prev_close,
      i.price_change_1w_pct, i.price_change_1m_pct, i.price_change_3m_pct, i.price_change_6m_pct, i.price_change_12m_pct,
      i.rs_vs_spy_1w, i.rs_vs_spy_1m, i.rs_vs_spy_3m, i.rs_vs_spy_6m, i.rs_vs_spy_12m,
      i.rs_pct_1w, i.rs_pct_1m, i.rs_pct_3m, i.rs_pct_6m, i.rs_pct_12m,
      i.industry_rank_1m, i.industry_rank_3m, i.industry_rank_6m, i.industry_rank_12m,
      i.sector_rank_1m, i.sector_rank_3m, i.sector_rank_6m, i.sector_rank_12m
    FROM companies c
    INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
    LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
    WHERE 1=1 ${symbolSql}${filterSql}
    ORDER BY c.symbol
    LIMIT ? OFFSET ?
  `;
  const stmt = db.prepare(sql);
  const rawRows = stmt.all(date, ...(symFilter?.values ?? []), ...filterParams, limit, offset) as RowObject[];
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

function getFallbackIndexSymbolsFromDb(
  db: BetterSqlite3Database,
  indexId: "sp500" | "nasdaq",
  endDate: string,
  desiredCount: number
): string[] {
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
}

function resolveIndexSymbolsForDb(
  db: BetterSqlite3Database,
  indexId: "sp500" | "nasdaq",
  endDate: string
): string[] {
  const configuredList = loadIndexSymbols(indexId);
  let configured = expandIndexSymbolsForDb(configuredList);

  if (configured.length > 0) {
    const symbolFilter = configured.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",");
    const present = db
      .prepare(
        `
        SELECT DISTINCT symbol
        FROM daily_bars
        WHERE symbol IN (${symbolFilter})
          AND date <= ?
        `
      )
      .all(endDate) as Array<{ symbol: string }>;
    configured = present.map((r) => String(r.symbol));
  }

  const minExpected = indexId === "sp500" ? 350 : 1000;
  if (configured.length >= minExpected) return configured;

  // If configured constituents have poor DB coverage (or no config), fall back to
  // a robust DB-derived universe so breadth/NNH never collapses to sparse counts.
  return expandIndexSymbolsForDb(
    getFallbackIndexSymbolsFromDb(db, indexId, endDate, indexId === "sp500" ? 500 : 0)
  );
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
  const latestScreenerDate = getLatestReliableScreenerDateFromDb(db);
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
  if (recent.length === 0) return latestScreenerDate;
  const reliable = recent.find((r) => Number(r.cnt ?? 0) >= minCoverage);
  const latestDailyDate = String(reliable?.date ?? recent[0].date);
  if (!latestScreenerDate) return latestDailyDate;
  // Use the common upper bound so endpoints that rely on quote/indicator coverage
  // don't switch to a date where those joins are still incomplete.
  return latestDailyDate < latestScreenerDate ? latestDailyDate : latestScreenerDate;
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

  const sp500Symbols = resolveIndexSymbolsForDb(db, "sp500", asOfDate);
  const nasdaqSymbols = resolveIndexSymbolsForDb(db, "nasdaq", asOfDate);

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
  const symbols = resolveIndexSymbolsForDb(db, indexId, endDate);
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

export function getIndexNetNewHighSeries(
  indexId: "sp500" | "nasdaq",
  lookbackDays: number,
  startDate: string,
  endDate: string
): { rows: NetNewHighRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const symbols = resolveIndexSymbolsForDb(db, indexId, endDate);
  if (symbols.length === 0) return { rows: [], date: endDate };

  const symbolFilter = symbols.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",");

  const from = new Date(`${startDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (lookbackDays + 30));
  const bufferStartDate = from.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `
      WITH base AS (
        SELECT
          d.symbol,
          d.date,
          d.close,
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
        WHERE d.symbol IN (${symbolFilter})
          AND d.date BETWEEN ? AND ?
      )
      SELECT
        date,
        SUM(CASE WHEN prior_count = ${lookbackDays} AND close > prior_high THEN 1 ELSE 0 END) AS highs,
        SUM(CASE WHEN prior_count = ${lookbackDays} AND close < prior_low THEN 1 ELSE 0 END) AS lows
      FROM base
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date ASC
      `
    )
    .all(bufferStartDate, endDate, startDate, endDate) as Array<{ date: string; highs: number; lows: number }>;

  return {
    rows: rows.map((r) => {
      const highs = Number(r.highs ?? 0);
      const lows = Number(r.lows ?? 0);
      return {
        date: String(r.date),
        highs,
        lows,
        net: highs - lows,
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

  // Need lookbackDays of extra history before the earliest display date
  // so the window function has full preceding rows for every displayed date
  const requiredHistoryRows = Math.max(0, lookbackDays + Math.max(5, displayDays) + 20);
  const scanBufferRows = Math.max(0, lookbackDays * 2 + Math.max(5, displayDays) + 20);
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
    .get(asOfDate, scanBufferRows) as { date?: string } | undefined;
  const earliestAvailableRow = db
    .prepare(
      `
      SELECT date
      FROM daily_bars
      GROUP BY date
      ORDER BY date ASC
      LIMIT 1
      `
    )
    .get() as { date?: string } | undefined;
  const startDate = startRow?.date
    ? String(startRow.date)
    : earliestAvailableRow?.date
      ? String(earliestAvailableRow.date)
      : displayDatesAsc[0];

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

  // Check if is_etf column exists on companies table
  const hasIsEtf = (db.prepare(
    "SELECT COUNT(*) AS c FROM pragma_table_info('companies') WHERE name = 'is_etf'"
  ).get() as { c: number })?.c > 0;
  const etfFilter = hasIsEtf ? "AND co.is_etf = 0" : "";

  // Need at least 65 trading days of lookback for C[65]; use ~100 calendar days buffer
  const from = new Date(`${startDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 120);
  const bufferStartDate = from.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `
      WITH base AS (
        SELECT
          d.symbol,
          d.date,
          d.close AS C,
          d.volume AS V,
          LAG(d.close, 1)  OVER w AS C1,
          LAG(d.close, 20) OVER w AS C20,
          LAG(d.close, 65) OVER w AS C65,
          LAG(d.volume, 1) OVER w AS V1,
          AVG(d.close)  OVER (PARTITION BY d.symbol ORDER BY d.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_c_20,
          AVG(CAST(d.volume AS REAL)) OVER (PARTITION BY d.symbol ORDER BY d.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_v_20
        FROM daily_bars d
        INNER JOIN companies co ON co.symbol = d.symbol ${etfFilter}
        WHERE d.date BETWEEN ? AND ?
        WINDOW w AS (PARTITION BY d.symbol ORDER BY d.date)
      )
      SELECT
        date,
        COUNT(*) AS universe,
        -- Up/Down 4% today: 100*(C-C[1])/C[1] >= 4, V >= 1000, V > V[1]
        SUM(CASE WHEN C1 > 0 AND 100.0*(C-C1)/C1 >= 4 AND V >= 1000 AND V > V1 THEN 1 ELSE 0 END) AS up4pct,
        SUM(CASE WHEN C1 > 0 AND 100.0*(C-C1)/C1 <= -4 AND V >= 1000 AND V > V1 THEN 1 ELSE 0 END) AS down4pct,
        -- Up/Down 25% quarter: 100*(C-C[65])/C[65], filter AVG(C,20)*AVG(V,20) >= 2500
        SUM(CASE WHEN C65 > 0 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C65)/C65 >= 25 THEN 1 ELSE 0 END) AS up25pct_qtr,
        SUM(CASE WHEN C65 > 0 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C65)/C65 <= -25 THEN 1 ELSE 0 END) AS down25pct_qtr,
        -- Up/Down 25% month: 100*(C-C[20])/C[20], filter C[20]>=5, AVG(C,20)*AVG(V,20)>=2500
        SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 >= 25 THEN 1 ELSE 0 END) AS up25pct_month,
        SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 <= -25 THEN 1 ELSE 0 END) AS down25pct_month,
        -- Up/Down 50% month: same filters, threshold 50
        SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 >= 50 THEN 1 ELSE 0 END) AS up50pct_month,
        SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 <= -50 THEN 1 ELSE 0 END) AS down50pct_month
      FROM base
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

/* ── Precomputed aggregation table readers ── */

export type MarketMonitorDailyRow = {
  date: string;
  up4pct: number;
  down4pct: number;
  ratio5d: number | null;
  ratio10d: number | null;
  up25pct_qtr: number;
  down25pct_qtr: number;
  up25pct_month: number;
  down25pct_month: number;
  up50pct_month: number;
  down50pct_month: number;
  sp500_pct_above_50d: number | null;
  sp500_pct_above_200d: number | null;
  nasdaq_pct_above_50d: number | null;
  nasdaq_pct_above_200d: number | null;
  universe: number;
  nnh_1m_highs: number | null;
  nnh_1m_lows: number | null;
  nnh_1m_net: number | null;
  nnh_3m_highs: number | null;
  nnh_3m_lows: number | null;
  nnh_3m_net: number | null;
  nnh_6m_highs: number | null;
  nnh_6m_lows: number | null;
  nnh_6m_net: number | null;
  nnh_52w_highs: number | null;
  nnh_52w_lows: number | null;
  nnh_52w_net: number | null;
};

export function getPrecomputedMarketMonitor(startDate: string, endDate: string): MarketMonitorDailyRow[] {
  const db = getDb();
  if (!db) return [];
  try {
    db.prepare("SELECT 1 FROM market_monitor_daily LIMIT 1").get();
  } catch {
    return [];
  }
  const rows = db.prepare(`
    SELECT * FROM market_monitor_daily
    WHERE date >= ? AND date <= ?
    ORDER BY date DESC
  `).all(startDate, endDate) as Record<string, unknown>[];
  return rows.map((r) => ({
    date: String(r.date),
    up4pct: Number(r.up4pct ?? 0),
    down4pct: Number(r.down4pct ?? 0),
    ratio5d: r.ratio5d != null ? Number(r.ratio5d) : null,
    ratio10d: r.ratio10d != null ? Number(r.ratio10d) : null,
    up25pct_qtr: Number(r.up25pct_qtr ?? 0),
    down25pct_qtr: Number(r.down25pct_qtr ?? 0),
    up25pct_month: Number(r.up25pct_month ?? 0),
    down25pct_month: Number(r.down25pct_month ?? 0),
    up50pct_month: Number(r.up50pct_month ?? 0),
    down50pct_month: Number(r.down50pct_month ?? 0),
    sp500_pct_above_50d: r.sp500_pct_above_50d != null ? Number(r.sp500_pct_above_50d) : null,
    sp500_pct_above_200d: r.sp500_pct_above_200d != null ? Number(r.sp500_pct_above_200d) : null,
    nasdaq_pct_above_50d: r.nasdaq_pct_above_50d != null ? Number(r.nasdaq_pct_above_50d) : null,
    nasdaq_pct_above_200d: r.nasdaq_pct_above_200d != null ? Number(r.nasdaq_pct_above_200d) : null,
    universe: Number(r.universe ?? 0),
    nnh_1m_highs: r.nnh_1m_highs != null ? Number(r.nnh_1m_highs) : null,
    nnh_1m_lows: r.nnh_1m_lows != null ? Number(r.nnh_1m_lows) : null,
    nnh_1m_net: r.nnh_1m_net != null ? Number(r.nnh_1m_net) : null,
    nnh_3m_highs: r.nnh_3m_highs != null ? Number(r.nnh_3m_highs) : null,
    nnh_3m_lows: r.nnh_3m_lows != null ? Number(r.nnh_3m_lows) : null,
    nnh_3m_net: r.nnh_3m_net != null ? Number(r.nnh_3m_net) : null,
    nnh_6m_highs: r.nnh_6m_highs != null ? Number(r.nnh_6m_highs) : null,
    nnh_6m_lows: r.nnh_6m_lows != null ? Number(r.nnh_6m_lows) : null,
    nnh_6m_net: r.nnh_6m_net != null ? Number(r.nnh_6m_net) : null,
    nnh_52w_highs: r.nnh_52w_highs != null ? Number(r.nnh_52w_highs) : null,
    nnh_52w_lows: r.nnh_52w_lows != null ? Number(r.nnh_52w_lows) : null,
    nnh_52w_net: r.nnh_52w_net != null ? Number(r.nnh_52w_net) : null,
  }));
}

export type BreadthDailyRow = {
  index_id: string;
  date: string;
  nnh_1m: number | null;
  nnh_3m: number | null;
  nnh_6m: number | null;
  nnh_52w: number | null;
  nnh_1m_highs: number | null;
  nnh_1m_lows: number | null;
  nnh_3m_highs: number | null;
  nnh_3m_lows: number | null;
  nnh_6m_highs: number | null;
  nnh_6m_lows: number | null;
  nnh_52w_highs: number | null;
  nnh_52w_lows: number | null;
  pct_above_50d: number | null;
  pct_above_200d: number | null;
  count_50d: number;
  count_200d: number;
};

export function getPrecomputedBreadth(indexId: string, startDate: string, endDate: string): BreadthDailyRow[] {
  const db = getDb();
  if (!db) return [];
  try {
    db.prepare("SELECT 1 FROM breadth_daily LIMIT 1").get();
  } catch {
    return [];
  }
  const rows = db.prepare(`
    SELECT * FROM breadth_daily
    WHERE index_id = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(indexId, startDate, endDate) as Record<string, unknown>[];
  return rows.map((r) => ({
    index_id: String(r.index_id),
    date: String(r.date),
    nnh_1m: r.nnh_1m != null ? Number(r.nnh_1m) : null,
    nnh_3m: r.nnh_3m != null ? Number(r.nnh_3m) : null,
    nnh_6m: r.nnh_6m != null ? Number(r.nnh_6m) : null,
    nnh_52w: r.nnh_52w != null ? Number(r.nnh_52w) : null,
    nnh_1m_highs: r.nnh_1m_highs != null ? Number(r.nnh_1m_highs) : null,
    nnh_1m_lows: r.nnh_1m_lows != null ? Number(r.nnh_1m_lows) : null,
    nnh_3m_highs: r.nnh_3m_highs != null ? Number(r.nnh_3m_highs) : null,
    nnh_3m_lows: r.nnh_3m_lows != null ? Number(r.nnh_3m_lows) : null,
    nnh_6m_highs: r.nnh_6m_highs != null ? Number(r.nnh_6m_highs) : null,
    nnh_6m_lows: r.nnh_6m_lows != null ? Number(r.nnh_6m_lows) : null,
    nnh_52w_highs: r.nnh_52w_highs != null ? Number(r.nnh_52w_highs) : null,
    nnh_52w_lows: r.nnh_52w_lows != null ? Number(r.nnh_52w_lows) : null,
    pct_above_50d: r.pct_above_50d != null ? Number(r.pct_above_50d) : null,
    pct_above_200d: r.pct_above_200d != null ? Number(r.pct_above_200d) : null,
    count_50d: Number(r.count_50d ?? 0),
    count_200d: Number(r.count_200d ?? 0),
  }));
}

