/**
 * Screener SQLite DB access (read-only from app).
 * DB file: data/screener.db. Uses sql.js (no native bindings).
 */

import initSqlJs from "sql.js";
import { isUSMarketOpen } from "@/lib/market-hours";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DB_PATH = join(process.cwd(), "data", "screener.db");

let sqlJs: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSql() {
  if (!sqlJs) sqlJs = await initSqlJs();
  return sqlJs;
}

export async function openScreenerDb(): Promise<InstanceType<Awaited<ReturnType<typeof initSqlJs>>["Database"]> | null> {
  if (!existsSync(DB_PATH)) return null;
  const SQL = await getSql();
  const buf = readFileSync(DB_PATH);
  return new SQL.Database(buf);
}

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

/**
 * Get latest screening date in the DB.
 */
export async function getLatestScreenerDate(): Promise<string | null> {
  const db = await openScreenerDb();
  if (!db) return null;
  try {
    const r = db.exec("SELECT MAX(date) AS d FROM quote_daily");
    if (r.length && r[0].values?.length && r[0].values[0][0]) {
      return String(r[0].values[0][0]);
    }
    return null;
  } finally {
    db.close();
  }
}

export type ScreenerFilters = Record<string, string | number | undefined>;

/** Build WHERE clauses and bind params from filters. Exported for use by screener-db-native. */
export function buildFilterClauses(filters: ScreenerFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const num = (v: string | number | undefined): number | null =>
    v === undefined || v === "" ? null : typeof v === "number" ? v : Number(v);
  const str = (v: string | number | undefined): string | null =>
    v === undefined || v === "" ? null : String(v).trim() || null;

  if (num(filters.market_cap_min) != null) {
    conditions.push(" AND q.market_cap >= ?");
    params.push(num(filters.market_cap_min));
  }
  if (num(filters.market_cap_max) != null) {
    conditions.push(" AND q.market_cap <= ?");
    params.push(num(filters.market_cap_max));
  }
  if (num(filters.last_price_min) != null) {
    conditions.push(" AND q.last_price >= ?");
    params.push(num(filters.last_price_min));
  }
  if (num(filters.last_price_max) != null) {
    conditions.push(" AND q.last_price <= ?");
    params.push(num(filters.last_price_max));
  }
  if (num(filters.change_pct_min) != null) {
    conditions.push(" AND q.change_pct >= ?");
    params.push(num(filters.change_pct_min));
  }
  if (num(filters.change_pct_max) != null) {
    conditions.push(" AND q.change_pct <= ?");
    params.push(num(filters.change_pct_max));
  }
  if (num(filters.volume_min) != null) {
    conditions.push(" AND q.volume >= ?");
    params.push(num(filters.volume_min));
  }
  if (num(filters.volume_max) != null) {
    conditions.push(" AND q.volume <= ?");
    params.push(num(filters.volume_max));
  }
  if (num(filters.avg_volume_30d_min) != null) {
    conditions.push(" AND q.avg_volume_30d_shares >= ?");
    params.push(num(filters.avg_volume_30d_min));
  }
  if (num(filters.high_52w_min) != null) {
    conditions.push(" AND q.high_52w >= ?");
    params.push(num(filters.high_52w_min));
  }
  if (num(filters.off_52w_high_pct_min) != null) {
    conditions.push(" AND q.off_52w_high_pct >= ?");
    params.push(num(filters.off_52w_high_pct_min));
  }
  if (num(filters.off_52w_high_pct_max) != null) {
    conditions.push(" AND q.off_52w_high_pct <= ?");
    params.push(num(filters.off_52w_high_pct_max));
  }
  if (num(filters.atr_pct_21d_min) != null) {
    conditions.push(" AND q.atr_pct_21d >= ?");
    params.push(num(filters.atr_pct_21d_min));
  }
  if (num(filters.atr_pct_21d_max) != null) {
    conditions.push(" AND q.atr_pct_21d <= ?");
    params.push(num(filters.atr_pct_21d_max));
  }
  const industryInclude = str(filters.industry_include);
  if (industryInclude != null) {
    const vals = industryInclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) {
      conditions.push(` AND c.industry IN (${vals.map(() => "?").join(",")})`);
      vals.forEach((v) => params.push(v));
    }
  }
  const industryExclude = str(filters.industry_exclude);
  if (industryExclude != null) {
    const vals = industryExclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) {
      conditions.push(` AND c.industry NOT IN (${vals.map(() => "?").join(",")})`);
      vals.forEach((v) => params.push(v));
    }
  }
  const sectorInclude = str(filters.sector_include);
  if (sectorInclude != null) {
    const vals = sectorInclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) {
      conditions.push(` AND c.sector IN (${vals.map(() => "?").join(",")})`);
      vals.forEach((v) => params.push(v));
    }
  }
  const sectorExclude = str(filters.sector_exclude);
  if (sectorExclude != null) {
    const vals = sectorExclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length > 0) {
      conditions.push(` AND c.sector NOT IN (${vals.map(() => "?").join(",")})`);
      vals.forEach((v) => params.push(v));
    }
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
  if (ipoFrom != null) {
    conditions.push(" AND c.ipo_date >= ?");
    params.push(ipoFrom);
  }
  const ipoTo = str(filters.ipo_date_to);
  if (ipoTo != null) {
    conditions.push(" AND c.ipo_date <= ?");
    params.push(ipoTo);
  }
  if (num(filters.shares_outstanding_min) != null) {
    conditions.push(" AND c.shares_outstanding >= ?");
    params.push(num(filters.shares_outstanding_min));
  }
  if (num(filters.shares_outstanding_max) != null) {
    conditions.push(" AND c.shares_outstanding <= ?");
    params.push(num(filters.shares_outstanding_max));
  }
  const priceChangePeriods = ["1w", "1m", "3m", "6m", "12m"] as const;
  for (const period of priceChangePeriods) {
    const col = `price_change_${period}_pct`;
    const minVal = num(filters[`${col}_min`]);
    const maxVal = num(filters[`${col}_max`]);
    if (minVal != null) {
      conditions.push(` AND i.${col} >= ?`);
      params.push(minVal);
    }
    if (maxVal != null) {
      conditions.push(` AND i.${col} <= ?`);
      params.push(maxVal);
    }
  }
  const rsPctPeriods = ["1w", "1m", "3m", "6m", "12m"] as const;
  for (const period of rsPctPeriods) {
    const col = `rs_pct_${period}`;
    const minVal = num(filters[`${col}_min`]);
    const maxVal = num(filters[`${col}_max`]);
    if (minVal != null) {
      conditions.push(` AND i.${col} >= ?`);
      params.push(minVal);
    }
    if (maxVal != null) {
      conditions.push(` AND i.${col} <= ?`);
      params.push(maxVal);
    }
  }
  const rankPeriods = ["1m", "3m", "6m", "12m"] as const;
  for (const period of rankPeriods) {
    const minVal = num(filters[`industry_rank_${period}_min`]);
    const maxVal = num(filters[`industry_rank_${period}_max`]);
    if (minVal != null) {
      conditions.push(` AND i.industry_rank_${period} >= ?`);
      params.push(minVal);
    }
    if (maxVal != null) {
      conditions.push(` AND i.industry_rank_${period} <= ?`);
      params.push(maxVal);
    }
  }
  for (const period of rankPeriods) {
    const minVal = num(filters[`sector_rank_${period}_min`]);
    const maxVal = num(filters[`sector_rank_${period}_max`]);
    if (minVal != null) {
      conditions.push(` AND i.sector_rank_${period} >= ?`);
      params.push(minVal);
    }
    if (maxVal != null) {
      conditions.push(` AND i.sector_rank_${period} <= ?`);
      params.push(maxVal);
    }
  }
  return { sql: conditions.join(""), params };
}

/**
 * Get count of screener results matching filters (same logic as getScreenerSnapshot).
 */
export async function getScreenerCount(options: {
  date?: string;
  symbols?: string[];
  filters?: ScreenerFilters;
}): Promise<{ count: number; date: string | null }> {
  const db = await openScreenerDb();
  if (!db) return { count: 0, date: null };

  try {
    let date = options.date ?? null;
    if (!date) {
      const dr = db.exec("SELECT MAX(date) AS d FROM quote_daily");
      if (dr.length && dr[0].values?.length && dr[0].values[0][0]) {
        date = String(dr[0].values[0][0]);
      }
    }
    if (!date) return { count: 0, date: null };

    const symbolFilter =
      options.symbols && options.symbols.length > 0
        ? ` AND c.symbol IN (${options.symbols.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(",")})`
        : "";
    const { sql: filterSql, params: filterParams } = buildFilterClauses(options.filters ?? {});

    const sql = `
      SELECT COUNT(*) FROM companies c
      INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
      LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
      WHERE 1=1 ${symbolFilter}${filterSql}
    `;
    const stmt = db.prepare(sql);
    stmt.bind([date, ...filterParams]);
    const count = stmt.step() ? (stmt.get() as [number])[0] ?? 0 : 0;
    stmt.free();
    return { count, date };
  } finally {
    db.close();
  }
}

/**
 * Query screener snapshot: companies + quote_daily + indicators_daily for a given date (or latest).
 * Optional limit, symbol filter, and filters (min/max for numeric, exact for categorical).
 */
export async function getScreenerSnapshot(options: {
  date?: string;
  symbols?: string[];
  limit?: number;
  offset?: number;
  filters?: ScreenerFilters;
}): Promise<{ rows: ScreenerRow[]; date: string | null }> {
  const db = await openScreenerDb();
  if (!db) return { rows: [], date: null };

  try {
    let date = options.date ?? null;
    if (!date) {
      const dr = db.exec("SELECT MAX(date) AS d FROM quote_daily");
      if (dr.length && dr[0].values?.length && dr[0].values[0][0]) {
        date = String(dr[0].values[0][0]);
      }
    }
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
    stmt.bind([date, date, ...filterParams, limit, offset]);
    const marketClosed = !isUSMarketOpen();
    const rows: ScreenerRow[] = [];
    while (stmt.step()) {
      const r = stmt.get() as unknown[];
      let last_price: number | null = typeof r[7] === "number" ? r[7] : null;
      let change_pct: number | null = typeof r[8] === "number" ? r[8] : null;
      let atr_pct_21d: number | null = typeof r[13] === "number" ? r[13] : null;
      const prev_close = typeof r[14] === "number" ? r[14] : null;

      if (marketClosed && prev_close != null && prev_close > 0) {
        last_price = prev_close;
        change_pct = 0;
        const origClose = typeof r[7] === "number" ? r[7] : null;
        if (atr_pct_21d != null && origClose != null && origClose > 0 && prev_close > 0) {
          atr_pct_21d = (atr_pct_21d * origClose) / prev_close;
        }
      } else if (!marketClosed && (last_price == null || last_price <= 0 || prev_close == null || prev_close <= 0)) {
        change_pct = 0;
      }

      rows.push({
        symbol: String(r[0] ?? ""),
        name: String(r[1] ?? ""),
        exchange: r[2] != null ? String(r[2]) : null,
        industry: r[3] != null ? String(r[3]) : null,
        sector: r[4] != null ? String(r[4]) : null,
        date: String(r[5] ?? ""),
        market_cap: typeof r[6] === "number" ? r[6] : null,
        last_price,
        change_pct,
        volume: typeof r[9] === "number" ? r[9] : null,
        avg_volume_30d_shares: typeof r[10] === "number" ? r[10] : null,
        high_52w: typeof r[11] === "number" ? r[11] : null,
        off_52w_high_pct: typeof r[12] === "number" ? r[12] : null,
        atr_pct_21d,
        price_change_1w_pct: typeof r[15] === "number" ? r[15] : null,
        price_change_1m_pct: typeof r[16] === "number" ? r[16] : null,
        price_change_3m_pct: typeof r[17] === "number" ? r[17] : null,
        price_change_6m_pct: typeof r[18] === "number" ? r[18] : null,
        price_change_12m_pct: typeof r[19] === "number" ? r[19] : null,
        rs_vs_spy_1w: typeof r[20] === "number" ? r[20] : null,
        rs_vs_spy_1m: typeof r[21] === "number" ? r[21] : null,
        rs_vs_spy_3m: typeof r[22] === "number" ? r[22] : null,
        rs_vs_spy_6m: typeof r[23] === "number" ? r[23] : null,
        rs_vs_spy_12m: typeof r[24] === "number" ? r[24] : null,
        rs_pct_1w: typeof r[25] === "number" ? r[25] : null,
        rs_pct_1m: typeof r[26] === "number" ? r[26] : null,
        rs_pct_3m: typeof r[27] === "number" ? r[27] : null,
        rs_pct_6m: typeof r[28] === "number" ? r[28] : null,
        rs_pct_12m: typeof r[29] === "number" ? r[29] : null,
        industry_rank_1m: typeof r[30] === "number" ? r[30] : null,
        industry_rank_3m: typeof r[31] === "number" ? r[31] : null,
        industry_rank_6m: typeof r[32] === "number" ? r[32] : null,
        industry_rank_12m: typeof r[33] === "number" ? r[33] : null,
        sector_rank_1m: typeof r[34] === "number" ? r[34] : null,
        sector_rank_3m: typeof r[35] === "number" ? r[35] : null,
        sector_rank_6m: typeof r[36] === "number" ? r[36] : null,
        sector_rank_12m: typeof r[37] === "number" ? r[37] : null,
      });
    }
    stmt.free();
    return { rows, date };
  } finally {
    db.close();
  }
}

export type DailyBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Get daily bars for a symbol up to asOfDate, newest-first. For Nino Script. */
export async function getDailyBars(symbol: string, asOfDate: string, limit = 300): Promise<DailyBar[]> {
  const db = await openScreenerDb();
  if (!db) return [];
  try {
    const stmt = db.prepare(
      "SELECT date, open, high, low, close, volume FROM daily_bars WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT ?"
    );
    stmt.bind([symbol.toUpperCase(), asOfDate, limit]);
    const rows: DailyBar[] = [];
    while (stmt.step()) {
      const r = stmt.get() as [string, number, number, number, number, number];
      rows.push({
        date: String(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      });
    }
    stmt.free();
    return rows;
  } finally {
    db.close();
  }
}

export type OwnershipQuarter = {
  report_date: string;
  num_funds: number | null;
  num_funds_change: number | null;
  top_holders: Array<{ name: string; value?: number; shares?: number | null }>;
};

/**
 * Get ownership (13F fund count and top holders) for a symbol, last 12 quarters, latest first.
 */
export async function getOwnership(symbol: string): Promise<OwnershipQuarter[]> {
  const db = await openScreenerDb();
  if (!db) return [];
  try {
    const stmt = db.prepare(
      "SELECT report_date, num_funds, num_funds_change, top_holders FROM ownership WHERE symbol = ? ORDER BY report_date DESC LIMIT 12"
    );
    stmt.bind([symbol.toUpperCase()]);
    const rows: OwnershipQuarter[] = [];
    while (stmt.step()) {
      const r = stmt.get() as [string, number | null, number | null, string | null];
      let top_holders: OwnershipQuarter["top_holders"] = [];
      if (r[3]) {
        try {
          top_holders = JSON.parse(r[3]) ?? [];
        } catch {
          /* ignore */
        }
      }
      rows.push({
        report_date: r[0],
        num_funds: r[1],
        num_funds_change: r[2],
        top_holders,
      });
    }
    stmt.free();
    return rows;
  } finally {
    db.close();
  }
}
