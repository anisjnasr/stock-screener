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
import { getScreenerDbPath, getDataDir } from "@/lib/data-path";
import { SCREENER_SNAPSHOT_FINANCIAL_SQL } from "@/lib/screener-snapshot-financial-sql";

/* ── Shared types & filter builder (previously in screener-db.ts) ── */

export type ScreenerFilters = Record<string, string | number | undefined>;

export type ScreenerRow = {
  symbol: string;
  name: string;
  exchange: string | null;
  industry: string | null;
  sector: string | null;
  date: string;
  /** IPO listing date from companies, or first daily bar date as fallback. */
  ipo_date: string | null;
  market_cap: number | null;
  last_price: number | null;
  change_pct: number | null;
  volume: number | null;
  avg_volume_30d_shares: number | null;
  high_52w: number | null;
  off_52w_high_pct: number | null;
  atr_pct_21d: number | null;
  atr_units_above_ema50: number | null;
  atr_multiple_sma50: number | null;
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
  earnings_last_reported: string | null;
  sales_last_reported: string | null;
  eps_recent_q: number | null;
  avg_eps_2q: number | null;
  eps_growth_recent_q: number | null;
  avg_eps_growth_2q: number | null;
  avg_eps_growth_3q: number | null;
  avg_eps_growth_4q: number | null;
  eps_ttm: number | null;
  avg_eps_2y: number | null;
  eps_growth_1y: number | null;
  eps_growth_2y_ago: number | null;
  avg_eps_growth_2y: number | null;
  avg_eps_growth_3y: number | null;
  sales_recent_q: number | null;
  avg_sales_2q: number | null;
  sales_growth_recent_q: number | null;
  avg_sales_growth_2q: number | null;
  avg_sales_growth_3q: number | null;
  avg_sales_growth_4q: number | null;
  sales_ttm: number | null;
  avg_sales_2y: number | null;
  sales_growth_1y: number | null;
  sales_growth_2y_ago: number | null;
  avg_sales_growth_2y: number | null;
  avg_sales_growth_3y: number | null;
  [key: string]: unknown;
};

/** Stored cap from quotes, or shares × last/previous close — must match filter predicates. */
const EFFECTIVE_MARKET_CAP_SQL =
  "COALESCE(q.market_cap, c.shares_outstanding * COALESCE(q.last_price, q.prev_close))";

/** Minimum market cap (USD) for Market Monitor universe — keep in sync with `scripts/compute-market-aggregates.mjs`. */
export const MM_MIN_MARKET_CAP_USD = 1_000_000_000;

/** Effective cap when `quote_daily` is aliased `q`, `companies` as `co`, `daily_bars` as `d` (Market Monitor SQL). */
export const MM_EFFECTIVE_MARKET_CAP_SQL =
  "COALESCE(q.market_cap, co.shares_outstanding * COALESCE(q.last_price, q.prev_close, d.close))";

export function buildFilterClauses(filters: ScreenerFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const num = (v: string | number | undefined): number | null =>
    v === undefined || v === "" ? null : typeof v === "number" ? v : Number(v);
  const str = (v: string | number | undefined): string | null =>
    v === undefined || v === "" ? null : String(v).trim() || null;
  const addNumericRange = (expr: string, minKey: string, maxKey: string) => {
    const minVal = num(filters[minKey]);
    const maxVal = num(filters[maxKey]);
    if (minVal != null) { conditions.push(` AND ${expr} >= ?`); params.push(minVal); }
    if (maxVal != null) { conditions.push(` AND ${expr} <= ?`); params.push(maxVal); }
  };
  const addDateRange = (expr: string, fromKey: string, toKey: string) => {
    const fromVal = str(filters[fromKey]);
    const toVal = str(filters[toKey]);
    if (fromVal != null) { conditions.push(` AND ${expr} >= ?`); params.push(fromVal); }
    if (toVal != null) { conditions.push(` AND ${expr} <= ?`); params.push(toVal); }
  };

  addNumericRange(EFFECTIVE_MARKET_CAP_SQL, "market_cap_min", "market_cap_max");
  if (num(filters.last_price_min) != null) { conditions.push(" AND q.last_price >= ?"); params.push(num(filters.last_price_min)); }
  if (num(filters.last_price_max) != null) { conditions.push(" AND q.last_price <= ?"); params.push(num(filters.last_price_max)); }
  if (num(filters.change_pct_min) != null) { conditions.push(" AND q.change_pct >= ?"); params.push(num(filters.change_pct_min)); }
  if (num(filters.change_pct_max) != null) { conditions.push(" AND q.change_pct <= ?"); params.push(num(filters.change_pct_max)); }
  if (num(filters.volume_min) != null) { conditions.push(" AND q.volume >= ?"); params.push(num(filters.volume_min)); }
  if (num(filters.volume_max) != null) { conditions.push(" AND q.volume <= ?"); params.push(num(filters.volume_max)); }
  if (num(filters.avg_volume_30d_min) != null) { conditions.push(" AND q.avg_volume_30d_shares >= ?"); params.push(num(filters.avg_volume_30d_min)); }
  if (num(filters.high_52w_min) != null) { conditions.push(" AND q.high_52w >= ?"); params.push(num(filters.high_52w_min)); }
  {
    const rawMin = num(filters.off_52w_high_pct_min);
    const rawMax = num(filters.off_52w_high_pct_max);
    const offMin = rawMin != null ? Math.max(0, rawMin) : null;
    const offMax = rawMax != null ? Math.max(0, rawMax) : null;
    if (offMin != null) { conditions.push(" AND q.off_52w_high_pct >= ?"); params.push(offMin); }
    if (offMax != null) { conditions.push(" AND q.off_52w_high_pct <= ?"); params.push(offMax); }
  }
  if (str(filters.new_52w_high) === "1") {
    conditions.push(
      " AND q.high_52w IS NOT NULL AND d.high IS NOT NULL AND d.high + 1e-9 >= q.high_52w"
    );
  }
  addNumericRange("i.atr_multiple_sma50", "atr_multiple_sma50_min", "atr_multiple_sma50_max");
  if (num(filters.atr_pct_21d_min) != null) { conditions.push(" AND q.atr_pct_21d >= ?"); params.push(num(filters.atr_pct_21d_min)); }
  if (num(filters.atr_pct_21d_max) != null) { conditions.push(" AND q.atr_pct_21d <= ?"); params.push(num(filters.atr_pct_21d_max)); }

  for (const p of [20, 50, 100, 200] as const) {
    addNumericRange(`i.pct_from_ema_${p}`, `pct_from_ema_${p}_min`, `pct_from_ema_${p}_max`);
  }

  const aboveEmaCols = ["above_ema_20", "above_ema_50", "above_ema_100", "above_ema_200"] as const;
  for (const col of aboveEmaCols) {
    const v = str(filters[col]);
    if (v === "1") {
      conditions.push(` AND i.${col} = 1`);
    } else if (v === "0") {
      conditions.push(` AND (i.${col} = 0 OR i.${col} IS NULL)`);
    }
  }

  const emaPairCols = ["ema_20_above_50", "ema_50_above_100", "ema_50_above_200", "ema_100_above_200"] as const;
  for (const col of emaPairCols) {
    const v = str(filters[col]);
    if (v === "1") {
      conditions.push(` AND i.${col} = 1`);
    } else if (v === "0") {
      conditions.push(` AND (i.${col} = 0 OR i.${col} IS NULL)`);
    }
  }

  const ema200LagFilters = [
    ["ema_200_vs_lag_20", "ema_200", "ema_200_lag_20"],
    ["ema_200_vs_lag_30", "ema_200", "ema_200_lag_30"],
    ["ema_200_vs_lag_60", "ema_200", "ema_200_lag_60"],
  ] as const;
  for (const [filterKey, curCol, lagCol] of ema200LagFilters) {
    const v = str(filters[filterKey]);
    if (v === "above") {
      conditions.push(
        ` AND i.${curCol} IS NOT NULL AND i.${lagCol} IS NOT NULL AND i.${curCol} > i.${lagCol}`
      );
    } else if (v === "below") {
      conditions.push(
        ` AND i.${curCol} IS NOT NULL AND i.${lagCol} IS NOT NULL AND i.${curCol} < i.${lagCol}`
      );
    }
  }

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
  const latestQuarterlyPeriodEndExpr = `(
    SELECT fq.period_end
    FROM financials fq
    WHERE fq.symbol = c.symbol
      AND fq.period_type = 'quarterly'
      AND fq.period_end IS NOT NULL
    ORDER BY fq.period_end DESC
    LIMIT 1
  )`;
  const latestQuarterlyEpsExpr = `(
    SELECT fq.eps
    FROM financials fq
    WHERE fq.symbol = c.symbol
      AND fq.period_type = 'quarterly'
      AND fq.eps IS NOT NULL
    ORDER BY fq.period_end DESC
    LIMIT 1
  )`;
  const avgQuarterlyEps2Expr = `(
    SELECT AVG(x.eps)
    FROM (
      SELECT fq.eps
      FROM financials fq
      WHERE fq.symbol = c.symbol
        AND fq.period_type = 'quarterly'
        AND fq.eps IS NOT NULL
      ORDER BY fq.period_end DESC
      LIMIT 2
    ) x
  )`;
  // Recompute quarterly EPS YoY directly from EPS series so scan values match the fundamentals panel.
  const latestQuarterlyEpsGrowthExpr = `(
    SELECT y.growth
    FROM (
      SELECT
        fq.period_end AS period_end,
        CASE
          WHEN fq.eps IS NULL OR fp.eps IS NULL OR fp.eps = 0 THEN NULL
          ELSE ((fq.eps - fp.eps) / ABS(fp.eps)) * 100.0
        END AS growth
      FROM financials fq
      LEFT JOIN financials fp
        ON fp.symbol = fq.symbol
        AND fp.period_type = 'quarterly'
        AND fp.period_end = date(fq.period_end, '-1 year')
      WHERE fq.symbol = c.symbol
        AND fq.period_type = 'quarterly'
    ) y
    WHERE y.growth IS NOT NULL
    ORDER BY y.period_end DESC
    LIMIT 1
  )`;
  const avgQuarterlyEpsGrowthExpr = (periods: number) => `(
    SELECT AVG(x.growth)
    FROM (
      SELECT y.period_end, y.growth
      FROM (
        SELECT
          fq.period_end AS period_end,
          CASE
            WHEN fq.eps IS NULL OR fp.eps IS NULL OR fp.eps = 0 THEN NULL
            ELSE ((fq.eps - fp.eps) / ABS(fp.eps)) * 100.0
          END AS growth
        FROM financials fq
        LEFT JOIN financials fp
          ON fp.symbol = fq.symbol
          AND fp.period_type = 'quarterly'
          AND fp.period_end = date(fq.period_end, '-1 year')
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
      ) y
      WHERE y.growth IS NOT NULL
      ORDER BY y.period_end DESC
      LIMIT ${periods}
    ) x
  )`;
  const epsTtmExpr = `(
    SELECT SUM(x.eps)
    FROM (
      SELECT fq.eps
      FROM financials fq
      WHERE fq.symbol = c.symbol
        AND fq.period_type = 'quarterly'
        AND fq.eps IS NOT NULL
      ORDER BY fq.period_end DESC
      LIMIT 4
    ) x
  )`;
  const avgAnnualEps2Expr = `(
    SELECT AVG(x.eps)
    FROM (
      SELECT fa.eps
      FROM financials fa
      WHERE fa.symbol = c.symbol
        AND fa.period_type = 'annual'
        AND fa.eps IS NOT NULL
      ORDER BY fa.period_end DESC
      LIMIT 2
    ) x
  )`;
  const latestAnnualEpsGrowthExpr = `(
    SELECT fa.eps_growth_yoy
    FROM financials fa
    WHERE fa.symbol = c.symbol
      AND fa.period_type = 'annual'
      AND fa.eps_growth_yoy IS NOT NULL
    ORDER BY fa.period_end DESC
    LIMIT 1
  )`;
  const annualEpsGrowthAtOffsetExpr = (offset: number) => `(
    SELECT fa.eps_growth_yoy
    FROM financials fa
    WHERE fa.symbol = c.symbol
      AND fa.period_type = 'annual'
      AND fa.eps_growth_yoy IS NOT NULL
    ORDER BY fa.period_end DESC
    LIMIT 1 OFFSET ${offset}
  )`;
  const avgAnnualEpsGrowthExpr = (periods: number) => `(
    SELECT AVG(x.eps_growth_yoy)
    FROM (
      SELECT fa.eps_growth_yoy
      FROM financials fa
      WHERE fa.symbol = c.symbol
        AND fa.period_type = 'annual'
        AND fa.eps_growth_yoy IS NOT NULL
      ORDER BY fa.period_end DESC
      LIMIT ${periods}
    ) x
  )`;
  const latestQuarterlySalesExpr = `(
    SELECT fq.sales
    FROM financials fq
    WHERE fq.symbol = c.symbol
      AND fq.period_type = 'quarterly'
      AND fq.sales IS NOT NULL
    ORDER BY fq.period_end DESC
    LIMIT 1
  )`;
  const avgQuarterlySales2Expr = `(
    SELECT AVG(x.sales)
    FROM (
      SELECT fq.sales
      FROM financials fq
      WHERE fq.symbol = c.symbol
        AND fq.period_type = 'quarterly'
        AND fq.sales IS NOT NULL
      ORDER BY fq.period_end DESC
      LIMIT 2
    ) x
  )`;
  // Recompute quarterly revenue YoY directly from sales series for consistency with fundamentals panel.
  const latestQuarterlySalesGrowthExpr = `(
    SELECT y.growth
    FROM (
      SELECT
        fq.period_end AS period_end,
        CASE
          WHEN fq.sales IS NULL OR fp.sales IS NULL OR fp.sales = 0 THEN NULL
          ELSE ((fq.sales - fp.sales) / ABS(fp.sales)) * 100.0
        END AS growth
      FROM financials fq
      LEFT JOIN financials fp
        ON fp.symbol = fq.symbol
        AND fp.period_type = 'quarterly'
        AND fp.period_end = date(fq.period_end, '-1 year')
      WHERE fq.symbol = c.symbol
        AND fq.period_type = 'quarterly'
    ) y
    WHERE y.growth IS NOT NULL
    ORDER BY y.period_end DESC
    LIMIT 1
  )`;
  const avgQuarterlySalesGrowthExpr = (periods: number) => `(
    SELECT AVG(x.growth)
    FROM (
      SELECT y.period_end, y.growth
      FROM (
        SELECT
          fq.period_end AS period_end,
          CASE
            WHEN fq.sales IS NULL OR fp.sales IS NULL OR fp.sales = 0 THEN NULL
            ELSE ((fq.sales - fp.sales) / ABS(fp.sales)) * 100.0
          END AS growth
        FROM financials fq
        LEFT JOIN financials fp
          ON fp.symbol = fq.symbol
          AND fp.period_type = 'quarterly'
          AND fp.period_end = date(fq.period_end, '-1 year')
        WHERE fq.symbol = c.symbol
          AND fq.period_type = 'quarterly'
      ) y
      WHERE y.growth IS NOT NULL
      ORDER BY y.period_end DESC
      LIMIT ${periods}
    ) x
  )`;
  const salesTtmExpr = `(
    SELECT SUM(x.sales)
    FROM (
      SELECT fq.sales
      FROM financials fq
      WHERE fq.symbol = c.symbol
        AND fq.period_type = 'quarterly'
        AND fq.sales IS NOT NULL
      ORDER BY fq.period_end DESC
      LIMIT 4
    ) x
  )`;
  const avgAnnualSales2Expr = `(
    SELECT AVG(x.sales)
    FROM (
      SELECT fa.sales
      FROM financials fa
      WHERE fa.symbol = c.symbol
        AND fa.period_type = 'annual'
        AND fa.sales IS NOT NULL
      ORDER BY fa.period_end DESC
      LIMIT 2
    ) x
  )`;
  const latestAnnualSalesGrowthExpr = `(
    SELECT fa.sales_growth_yoy
    FROM financials fa
    WHERE fa.symbol = c.symbol
      AND fa.period_type = 'annual'
      AND fa.sales_growth_yoy IS NOT NULL
    ORDER BY fa.period_end DESC
    LIMIT 1
  )`;
  const annualSalesGrowthAtOffsetExpr = (offset: number) => `(
    SELECT fa.sales_growth_yoy
    FROM financials fa
    WHERE fa.symbol = c.symbol
      AND fa.period_type = 'annual'
      AND fa.sales_growth_yoy IS NOT NULL
    ORDER BY fa.period_end DESC
    LIMIT 1 OFFSET ${offset}
  )`;
  const avgAnnualSalesGrowthExpr = (periods: number) => `(
    SELECT AVG(x.sales_growth_yoy)
    FROM (
      SELECT fa.sales_growth_yoy
      FROM financials fa
      WHERE fa.symbol = c.symbol
        AND fa.period_type = 'annual'
        AND fa.sales_growth_yoy IS NOT NULL
      ORDER BY fa.period_end DESC
      LIMIT ${periods}
    ) x
  )`;
  addDateRange(latestQuarterlyPeriodEndExpr, "earnings_last_reported_from", "earnings_last_reported_to");
  addDateRange(latestQuarterlyPeriodEndExpr, "sales_last_reported_from", "sales_last_reported_to");
  addNumericRange(latestQuarterlyEpsExpr, "eps_recent_q_min", "eps_recent_q_max");
  addNumericRange(avgQuarterlyEps2Expr, "avg_eps_2q_min", "avg_eps_2q_max");
  addNumericRange(latestQuarterlyEpsGrowthExpr, "eps_growth_recent_q_min", "eps_growth_recent_q_max");
  addNumericRange(avgQuarterlyEpsGrowthExpr(2), "avg_eps_growth_2q_min", "avg_eps_growth_2q_max");
  addNumericRange(avgQuarterlyEpsGrowthExpr(3), "avg_eps_growth_3q_min", "avg_eps_growth_3q_max");
  addNumericRange(avgQuarterlyEpsGrowthExpr(4), "avg_eps_growth_4q_min", "avg_eps_growth_4q_max");
  addNumericRange(epsTtmExpr, "eps_ttm_min", "eps_ttm_max");
  addNumericRange(avgAnnualEps2Expr, "avg_eps_2y_min", "avg_eps_2y_max");
  addNumericRange(latestAnnualEpsGrowthExpr, "eps_growth_1y_min", "eps_growth_1y_max");
  addNumericRange(annualEpsGrowthAtOffsetExpr(1), "eps_growth_2y_ago_min", "eps_growth_2y_ago_max");
  addNumericRange(avgAnnualEpsGrowthExpr(2), "avg_eps_growth_2y_min", "avg_eps_growth_2y_max");
  addNumericRange(avgAnnualEpsGrowthExpr(3), "avg_eps_growth_3y_min", "avg_eps_growth_3y_max");
  addNumericRange(latestQuarterlySalesExpr, "sales_recent_q_min", "sales_recent_q_max");
  addNumericRange(avgQuarterlySales2Expr, "avg_sales_2q_min", "avg_sales_2q_max");
  addNumericRange(latestQuarterlySalesGrowthExpr, "sales_growth_recent_q_min", "sales_growth_recent_q_max");
  addNumericRange(avgQuarterlySalesGrowthExpr(2), "avg_sales_growth_2q_min", "avg_sales_growth_2q_max");
  addNumericRange(avgQuarterlySalesGrowthExpr(3), "avg_sales_growth_3q_min", "avg_sales_growth_3q_max");
  addNumericRange(avgQuarterlySalesGrowthExpr(4), "avg_sales_growth_4q_min", "avg_sales_growth_4q_max");
  addNumericRange(salesTtmExpr, "sales_ttm_min", "sales_ttm_max");
  addNumericRange(avgAnnualSales2Expr, "avg_sales_2y_min", "avg_sales_2y_max");
  addNumericRange(latestAnnualSalesGrowthExpr, "sales_growth_1y_min", "sales_growth_1y_max");
  addNumericRange(annualSalesGrowthAtOffsetExpr(1), "sales_growth_2y_ago_min", "sales_growth_2y_ago_max");
  addNumericRange(avgAnnualSalesGrowthExpr(2), "avg_sales_growth_2y_min", "avg_sales_growth_2y_max");
  addNumericRange(avgAnnualSalesGrowthExpr(3), "avg_sales_growth_3y_min", "avg_sales_growth_3y_max");

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

const DB_PATH = getScreenerDbPath();

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
  // journal_mode = WAL requires write access; the VACUUM'd DB from CI arrives
  // in DELETE mode so this would throw SQLITE_READONLY on a readonly connection.
  try { db.exec("PRAGMA journal_mode = WAL"); } catch { /* readonly — keep existing mode */ }
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -64000");
  db.exec("PRAGMA mmap_size = 268435456");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA read_uncommitted = ON");

  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_daily_bars_covering ON daily_bars (symbol, date, close, high, low, volume, open)");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_indicators_daily_covering ON indicators_daily (
      date, symbol,
      price_change_1w_pct, price_change_1m_pct, price_change_3m_pct, price_change_6m_pct, price_change_12m_pct,
      rs_pct_1w, rs_pct_1m, rs_pct_3m, rs_pct_6m, rs_pct_12m,
      rs_vs_spy_1w, rs_vs_spy_1m, rs_vs_spy_3m, rs_vs_spy_6m, rs_vs_spy_12m,
      industry_rank_1m, industry_rank_3m, industry_rank_6m, industry_rank_12m,
      sector_rank_1m, sector_rank_3m, sector_rank_6m, sector_rank_12m
    )`);
  } catch { /* readonly DB — indexes must be created by the refresh scripts */ }

  const st = statSync(DB_PATH);
  globalForDb._screenerDb = db;
  globalForDb._screenerDbPath = DB_PATH;
  globalForDb._screenerDbMtimeMs = st.mtimeMs;
  globalForDb._screenerDbIno = st.ino;
  globalForDb._screenerDbLastStatCheck = Date.now();
  return db;
}

export function resetDbConnection(): void {
  if (globalForDb._screenerDb) {
    try { globalForDb._screenerDb.close(); } catch { /* ignore */ }
  }
  globalForDb._screenerDb = undefined;
  globalForDb._screenerDbPath = undefined;
  globalForDb._screenerDbMtimeMs = undefined;
  globalForDb._screenerDbIno = undefined;
  globalForDb._screenerDbLastStatCheck = undefined;
}

/** Older DBs may lack columns that newer code SELECTs; add them once (writable handle). */
let financialsSchemaMigrationAttempted = false;
function ensureFinancialsSchemaMigration(): void {
  if (financialsSchemaMigrationAttempted) return;
  financialsSchemaMigrationAttempted = true;
  if (!existsSync(DB_PATH)) return;
  let w: BetterSqlite3Database | undefined;
  try {
    w = new Database(DB_PATH, { readonly: false });
    const cols = new Set(
      (w.prepare("PRAGMA table_info(financials)").all() as Array<{ name: string }>).map((r) => r.name)
    );
    let changed = false;
    if (!cols.has("fiscal_period")) {
      w.exec("ALTER TABLE financials ADD COLUMN fiscal_period TEXT");
      changed = true;
    }
    if (!cols.has("fiscal_year")) {
      w.exec("ALTER TABLE financials ADD COLUMN fiscal_year INTEGER");
      changed = true;
    }
    if (changed) resetDbConnection();
  } catch {
    /* Read-only volume or missing table — operator must run ALTER manually (see docs). */
  } finally {
    try {
      w?.close();
    } catch {
      /* ignore */
    }
  }
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
  fiscal_period: string | null;
  fiscal_year: number | null;
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
  } else if (!marketClosed && change_pct == null && (last_price == null || last_price <= 0 || prev_close == null || prev_close <= 0)) {
    change_pct = 0;
  }

  return {
    symbol: String(r.symbol ?? ""),
    name: String(r.name ?? ""),
    exchange: r.exchange != null ? String(r.exchange) : null,
    industry: r.industry != null ? String(r.industry) : null,
    sector: r.sector != null ? String(r.sector) : null,
    date: String(r.date ?? ""),
    ipo_date: r.ipo_date != null && String(r.ipo_date).length >= 8 ? String(r.ipo_date).slice(0, 10) : null,
    market_cap: typeof r.market_cap === "number" ? r.market_cap : null,
    last_price,
    change_pct,
    volume: typeof r.volume === "number" ? r.volume : null,
    avg_volume_30d_shares: typeof r.avg_volume_30d_shares === "number" ? r.avg_volume_30d_shares : null,
    high_52w: typeof r.high_52w === "number" ? r.high_52w : null,
    off_52w_high_pct: typeof r.off_52w_high_pct === "number" ? r.off_52w_high_pct : null,
    atr_pct_21d,
    atr_units_above_ema50: typeof r.atr_units_above_ema50 === "number" ? r.atr_units_above_ema50 : null,
    atr_multiple_sma50: typeof r.atr_multiple_sma50 === "number" ? r.atr_multiple_sma50 : null,
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
    earnings_last_reported: r.earnings_last_reported != null ? String(r.earnings_last_reported).slice(0, 10) : null,
    sales_last_reported: r.sales_last_reported != null ? String(r.sales_last_reported).slice(0, 10) : null,
    eps_recent_q: typeof r.eps_recent_q === "number" ? r.eps_recent_q : null,
    avg_eps_2q: typeof r.avg_eps_2q === "number" ? r.avg_eps_2q : null,
    eps_growth_recent_q: typeof r.eps_growth_recent_q === "number" ? r.eps_growth_recent_q : null,
    avg_eps_growth_2q: typeof r.avg_eps_growth_2q === "number" ? r.avg_eps_growth_2q : null,
    avg_eps_growth_3q: typeof r.avg_eps_growth_3q === "number" ? r.avg_eps_growth_3q : null,
    avg_eps_growth_4q: typeof r.avg_eps_growth_4q === "number" ? r.avg_eps_growth_4q : null,
    eps_ttm: typeof r.eps_ttm === "number" ? r.eps_ttm : null,
    avg_eps_2y: typeof r.avg_eps_2y === "number" ? r.avg_eps_2y : null,
    eps_growth_1y: typeof r.eps_growth_1y === "number" ? r.eps_growth_1y : null,
    eps_growth_2y_ago: typeof r.eps_growth_2y_ago === "number" ? r.eps_growth_2y_ago : null,
    avg_eps_growth_2y: typeof r.avg_eps_growth_2y === "number" ? r.avg_eps_growth_2y : null,
    avg_eps_growth_3y: typeof r.avg_eps_growth_3y === "number" ? r.avg_eps_growth_3y : null,
    sales_recent_q: typeof r.sales_recent_q === "number" ? r.sales_recent_q : null,
    avg_sales_2q: typeof r.avg_sales_2q === "number" ? r.avg_sales_2q : null,
    sales_growth_recent_q: typeof r.sales_growth_recent_q === "number" ? r.sales_growth_recent_q : null,
    avg_sales_growth_2q: typeof r.avg_sales_growth_2q === "number" ? r.avg_sales_growth_2q : null,
    avg_sales_growth_3q: typeof r.avg_sales_growth_3q === "number" ? r.avg_sales_growth_3q : null,
    avg_sales_growth_4q: typeof r.avg_sales_growth_4q === "number" ? r.avg_sales_growth_4q : null,
    sales_ttm: typeof r.sales_ttm === "number" ? r.sales_ttm : null,
    avg_sales_2y: typeof r.avg_sales_2y === "number" ? r.avg_sales_2y : null,
    sales_growth_1y: typeof r.sales_growth_1y === "number" ? r.sales_growth_1y : null,
    sales_growth_2y_ago: typeof r.sales_growth_2y_ago === "number" ? r.sales_growth_2y_ago : null,
    avg_sales_growth_2y: typeof r.avg_sales_growth_2y === "number" ? r.avg_sales_growth_2y : null,
    avg_sales_growth_3y: typeof r.avg_sales_growth_3y === "number" ? r.avg_sales_growth_3y : null,
  };
}

export function getLatestScreenerDate(): string | null {
  const db = getDb();
  if (!db) return null;
  return getLatestReliableScreenerDateFromDb(db);
}

export type LatestScreenerDates = {
  reliableDate: string | null;
  rawDate: string | null;
  source: "quote_daily_reliability";
};

export function getLatestScreenerDates(): LatestScreenerDates {
  const db = getDb();
  if (!db) {
    return {
      reliableDate: null,
      rawDate: null,
      source: "quote_daily_reliability",
    };
  }
  const reliableDate = getLatestReliableScreenerDateFromDb(db);
  const rawRow = db
    .prepare("SELECT MAX(date) AS d FROM daily_bars")
    .get() as { d: string | null } | undefined;
  const rawDate = rawRow?.d != null ? String(rawRow.d) : null;
  return {
    reliableDate,
    rawDate,
    source: "quote_daily_reliability",
  };
}

export type IndustryRankUniverseCounts = {
  industry_rank_1m: number;
  industry_rank_3m: number;
  industry_rank_6m: number;
  industry_rank_12m: number;
};

export type IndustryRanks = {
  industry_rank_1m: number | null;
  industry_rank_3m: number | null;
  industry_rank_6m: number | null;
  industry_rank_12m: number | null;
};

export type StockRsPercentiles = {
  rs_pct_1m: number | null;
  rs_pct_3m: number | null;
  rs_pct_6m: number | null;
  rs_pct_12m: number | null;
};

export function getIndustryRankUniverseCounts(date?: string): {
  date: string | null;
  counts: IndustryRankUniverseCounts | null;
} {
  const db = getDb();
  if (!db) return { date: null, counts: null };
  const targetDate = date ?? getLatestReliableScreenerDateFromDb(db);
  if (!targetDate) return { date: null, counts: null };
  const row = db
    .prepare(
      `
      SELECT
        COUNT(DISTINCT TRIM(c.industry)) AS industries
      FROM indicators_daily i
      INNER JOIN companies c ON c.symbol = i.symbol
      WHERE i.date = ?
        AND c.industry IS NOT NULL
        AND TRIM(c.industry) <> ''
      `
    )
    .get(targetDate) as
    | { industries?: number | null }
    | undefined;
  if (!row) return { date: targetDate, counts: null };
  const industryCount = Number(row.industries ?? 0);
  return {
    date: targetDate,
    counts: {
      industry_rank_1m: industryCount,
      industry_rank_3m: industryCount,
      industry_rank_6m: industryCount,
      industry_rank_12m: industryCount,
    },
  };
}

function rankIndustriesByReturn(rows: Array<{ industry: string; value: number | null }>): Map<string, number> {
  const sorted = [...rows].sort((a, b) => {
    if (a.value == null && b.value == null) return a.industry.localeCompare(b.industry);
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    if (b.value !== a.value) return b.value - a.value;
    return a.industry.localeCompare(b.industry);
  });
  const out = new Map<string, number>();
  sorted.forEach((row, index) => out.set(row.industry, index + 1));
  return out;
}

export function getComputedIndustryRanksForIndustry(industry: string | null | undefined, date?: string): {
  date: string | null;
  ranks: IndustryRanks | null;
} {
  const normalizedIndustry = typeof industry === "string" ? industry.trim() : "";
  if (!normalizedIndustry) return { date: null, ranks: null };
  const db = getDb();
  if (!db) return { date: null, ranks: null };
  const targetDate = date ?? getLatestReliableScreenerDateFromDb(db);
  if (!targetDate) return { date: null, ranks: null };
  const rows = db
    .prepare(
      `
      WITH base AS (
        SELECT
          TRIM(c.industry) AS industry,
          i.price_change_1m_pct,
          i.price_change_3m_pct,
          i.price_change_6m_pct,
          i.price_change_12m_pct,
          COALESCE(NULLIF(q.market_cap, 0), NULLIF(c.shares_outstanding * COALESCE(q.last_price, q.prev_close, d.close), 0), 1) AS weight
        FROM indicators_daily i
        INNER JOIN companies c ON c.symbol = i.symbol
        LEFT JOIN quote_daily q ON q.symbol = i.symbol AND q.date = i.date
        LEFT JOIN daily_bars d ON d.symbol = i.symbol AND d.date = i.date
        WHERE i.date = ?
          AND c.industry IS NOT NULL
          AND TRIM(c.industry) <> ''
          AND COALESCE(c.is_etf, 0) = 0
      )
      SELECT
        industry,
        SUM(CASE WHEN price_change_1m_pct IS NOT NULL THEN weight * price_change_1m_pct ELSE 0 END) /
          NULLIF(SUM(CASE WHEN price_change_1m_pct IS NOT NULL THEN weight ELSE 0 END), 0) AS ret1m,
        SUM(CASE WHEN price_change_3m_pct IS NOT NULL THEN weight * price_change_3m_pct ELSE 0 END) /
          NULLIF(SUM(CASE WHEN price_change_3m_pct IS NOT NULL THEN weight ELSE 0 END), 0) AS ret3m,
        SUM(CASE WHEN price_change_6m_pct IS NOT NULL THEN weight * price_change_6m_pct ELSE 0 END) /
          NULLIF(SUM(CASE WHEN price_change_6m_pct IS NOT NULL THEN weight ELSE 0 END), 0) AS ret6m,
        SUM(CASE WHEN price_change_12m_pct IS NOT NULL THEN weight * price_change_12m_pct ELSE 0 END) /
          NULLIF(SUM(CASE WHEN price_change_12m_pct IS NOT NULL THEN weight ELSE 0 END), 0) AS ret12m
      FROM base
      GROUP BY industry
      `
    )
    .all(targetDate) as Array<{
      industry: string;
      ret1m: number | null;
      ret3m: number | null;
      ret6m: number | null;
      ret12m: number | null;
    }>;
  if (rows.length === 0) return { date: targetDate, ranks: null };
  const rank1m = rankIndustriesByReturn(rows.map((r) => ({ industry: r.industry, value: r.ret1m })));
  const rank3m = rankIndustriesByReturn(rows.map((r) => ({ industry: r.industry, value: r.ret3m })));
  const rank6m = rankIndustriesByReturn(rows.map((r) => ({ industry: r.industry, value: r.ret6m })));
  const rank12m = rankIndustriesByReturn(rows.map((r) => ({ industry: r.industry, value: r.ret12m })));
  return {
    date: targetDate,
    ranks: {
      industry_rank_1m: rank1m.get(normalizedIndustry) ?? null,
      industry_rank_3m: rank3m.get(normalizedIndustry) ?? null,
      industry_rank_6m: rank6m.get(normalizedIndustry) ?? null,
      industry_rank_12m: rank12m.get(normalizedIndustry) ?? null,
    },
  };
}

export function getComputedRsPercentilesForSymbol(symbol: string, date?: string): {
  date: string | null;
  rsRank: StockRsPercentiles | null;
} {
  const symbolUpper = String(symbol).trim().toUpperCase();
  if (!symbolUpper) return { date: null, rsRank: null };
  const db = getDb();
  if (!db) return { date: null, rsRank: null };
  const targetDate = date ?? getLatestReliableScreenerDateFromDb(db);
  if (!targetDate) return { date: null, rsRank: null };
  const row = db
    .prepare(
      `
      SELECT rs_vs_spy_1m, rs_vs_spy_3m, rs_vs_spy_6m, rs_vs_spy_12m
      FROM indicators_daily
      WHERE symbol = ?
        AND date = ?
      LIMIT 1
      `
    )
    .get(symbolUpper, targetDate) as
    | {
        rs_vs_spy_1m?: number | null;
        rs_vs_spy_3m?: number | null;
        rs_vs_spy_6m?: number | null;
        rs_vs_spy_12m?: number | null;
      }
    | undefined;
  if (!row) return { date: targetDate, rsRank: null };
  const total = Number(
    (
      db.prepare("SELECT COUNT(*) AS c FROM indicators_daily WHERE date = ?").get(targetDate) as
        | { c?: number | null }
        | undefined
    )?.c ?? 0
  );
  if (total <= 0) return { date: targetDate, rsRank: null };

  const percentileFor = (column: string, value: number | null | undefined): number | null => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const greater = Number(
      (
        db.prepare(`SELECT COUNT(*) AS c FROM indicators_daily WHERE date = ? AND ${column} > ?`).get(targetDate, value) as
          | { c?: number | null }
          | undefined
      )?.c ?? 0
    );
    return ((total - greater) / total) * 100;
  };

  return {
    date: targetDate,
    rsRank: {
      rs_pct_1m: percentileFor("rs_vs_spy_1m", row.rs_vs_spy_1m),
      rs_pct_3m: percentileFor("rs_vs_spy_3m", row.rs_vs_spy_3m),
      rs_pct_6m: percentileFor("rs_vs_spy_6m", row.rs_vs_spy_6m),
      rs_pct_12m: percentileFor("rs_vs_spy_12m", row.rs_vs_spy_12m),
    },
  };
}

export function getAllIndustryNames(): string[] {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `
      SELECT DISTINCT TRIM(industry) AS industry
      FROM companies
      WHERE industry IS NOT NULL
        AND TRIM(industry) <> ''
        AND COALESCE(is_etf, 0) = 0
      ORDER BY industry
      `
    )
    .all() as Array<{ industry?: string | null }>;
  return rows
    .map((r) => (typeof r.industry === "string" ? r.industry.trim() : ""))
    .filter((v) => v.length > 0);
}

export type StockProfileDbMetrics = {
  marketCap: number | null;
  freeFloat: number | null;
  avgVolume20d: number | null;
  avgDollarVolume1m: number | null;
  atrPct21d: number | null;
};

export function getStockProfileDbMetrics(symbol: string, date?: string): {
  date: string | null;
  metrics: StockProfileDbMetrics | null;
} {
  const db = getDb();
  if (!db) return { date: null, metrics: null };
  const targetDate = date ?? getLatestReliableScreenerDateFromDb(db);
  if (!targetDate) return { date: null, metrics: null };
  const row = db
    .prepare(
      `
      SELECT
        q.market_cap AS market_cap,
        q.free_float AS free_float,
        i.avg_volume_1m AS avg_volume_1m,
        i.avg_dollar_volume_1m AS avg_dollar_volume_1m,
        q.atr_pct_21d AS atr_pct_21d
      FROM quote_daily q
      LEFT JOIN indicators_daily i ON i.symbol = q.symbol AND i.date = q.date
      WHERE q.symbol = ?
        AND q.date = ?
      LIMIT 1
      `
    )
    .get(String(symbol).toUpperCase(), targetDate) as
    | {
        market_cap?: number | null;
        free_float?: number | null;
        avg_volume_1m?: number | null;
        avg_dollar_volume_1m?: number | null;
        atr_pct_21d?: number | null;
      }
    | undefined;
  if (!row) return { date: targetDate, metrics: null };
  return {
    date: targetDate,
    metrics: {
      marketCap: typeof row.market_cap === "number" ? row.market_cap : null,
      freeFloat: typeof row.free_float === "number" ? row.free_float : null,
      avgVolume20d: typeof row.avg_volume_1m === "number" ? row.avg_volume_1m : null,
      avgDollarVolume1m: typeof row.avg_dollar_volume_1m === "number" ? row.avg_dollar_volume_1m : null,
      atrPct21d: typeof row.atr_pct_21d === "number" ? row.atr_pct_21d : null,
    },
  };
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
  ensureFinancialsSchemaMigration();
  const db = getDb();
  if (!db) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 40));
  const rows = db
    .prepare(
      `
      SELECT period_end, period_type, eps, eps_growth_yoy, sales, sales_growth_yoy, fiscal_period, fiscal_year
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
    fiscal_period: string | null;
    fiscal_year: number | null;
  }>;

  return rows.map((r) => ({
    period_end: String(r.period_end),
    period_type: r.period_type === "annual" ? "annual" : "quarterly",
    eps: r.eps != null ? Number(r.eps) : null,
    eps_growth_yoy: r.eps_growth_yoy != null ? Number(r.eps_growth_yoy) : null,
    sales: r.sales != null ? Number(r.sales) : null,
    sales_growth_yoy: r.sales_growth_yoy != null ? Number(r.sales_growth_yoy) : null,
    fiscal_period: r.fiscal_period != null ? String(r.fiscal_period) : null,
    fiscal_year: r.fiscal_year != null && Number.isFinite(Number(r.fiscal_year)) ? Number(r.fiscal_year) : null,
  }));
}

export function getCompanyName(symbol: string): string | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare("SELECT name FROM companies WHERE symbol = ? LIMIT 1")
    .get(String(symbol).toUpperCase()) as { name?: string | null } | undefined;
  return row?.name ? String(row.name).trim() : null;
}

/** Calendar fields for AI insights lookback (next earnings date, IPO). */
export function getCompanyCalendarFields(symbol: string): {
  nextEarningsAt: string | null;
  ipoDate: string | null;
} | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare("SELECT next_earnings_at, ipo_date FROM companies WHERE symbol = ? LIMIT 1")
    .get(String(symbol).toUpperCase()) as
    | { next_earnings_at?: string | null; ipo_date?: string | null }
    | undefined;
  if (!row) return null;
  const ne = row.next_earnings_at != null ? String(row.next_earnings_at).trim() : "";
  const ipo = row.ipo_date != null ? String(row.ipo_date).trim() : "";
  return {
    nextEarningsAt: ne.length >= 10 ? ne.slice(0, 10) : ne.length > 0 ? ne : null,
    ipoDate: ipo.length >= 10 ? ipo.slice(0, 10) : ipo.length > 0 ? ipo : null,
  };
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
    INNER JOIN daily_bars d ON d.symbol = c.symbol AND d.date = q.date
    LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
    WHERE 1=1 ${symbolSql}${filterSql}
  `;
  const stmt = db.prepare(sql);
  const row = stmt.get(date, ...(symFilter?.values ?? []), ...filterParams) as { cnt: number };
  return { count: row?.cnt ?? 0, date };
}

/** Symbols with a quote row on the latest screener date (cheap; use for universe "all" instead of scanning full snapshots). */
export function getAllQuotedSymbols(limit = 20000): string[] {
  const db = getDb();
  if (!db) return [];
  const date = getLatestScreenerDate();
  if (!date) return [];
  const rows = db
    .prepare(
      `SELECT c.symbol FROM companies c
       INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
       ORDER BY c.symbol
       LIMIT ?`
    )
    .all(date, limit) as { symbol: string }[];
  return rows.map((r) => String(r.symbol).toUpperCase());
}

export function getScreenerSnapshot(options: {
  date?: string;
  symbols?: string[];
  limit?: number;
  offset?: number;
  filters?: ScreenerFilters;
  /** When false, omits heavy per-row financial subqueries (EPS/sales TTM, etc.). Default true. */
  includeFinancialExtras?: boolean;
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
  const includeFin = options.includeFinancialExtras !== false;
  const ipoDateExpr = includeFin
    ? "COALESCE(c.ipo_date, (SELECT MIN(b.date) FROM daily_bars b WHERE b.symbol = c.symbol)) AS ipo_date"
    : "c.ipo_date AS ipo_date";
  const sql = `
    SELECT
      c.symbol, c.name, c.exchange, c.industry, c.sector,
      q.date,
      ${ipoDateExpr},
      ${EFFECTIVE_MARKET_CAP_SQL} AS market_cap,
      q.last_price, q.change_pct, q.volume, q.avg_volume_30d_shares,
      q.high_52w, q.off_52w_high_pct, q.atr_pct_21d,
      q.prev_close,
      i.price_change_1w_pct, i.price_change_1m_pct, i.price_change_3m_pct, i.price_change_6m_pct, i.price_change_12m_pct,
      i.rs_vs_spy_1w, i.rs_vs_spy_1m, i.rs_vs_spy_3m, i.rs_vs_spy_6m, i.rs_vs_spy_12m,
      i.rs_pct_1w, i.rs_pct_1m, i.rs_pct_3m, i.rs_pct_6m, i.rs_pct_12m,
      i.atr_units_above_ema50, i.atr_multiple_sma50,
      i.industry_rank_1m, i.industry_rank_3m, i.industry_rank_6m, i.industry_rank_12m,
      i.sector_rank_1m, i.sector_rank_3m, i.sector_rank_6m, i.sector_rank_12m${includeFin ? SCREENER_SNAPSHOT_FINANCIAL_SQL : ""}
    FROM companies c
    INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
    INNER JOIN daily_bars d ON d.symbol = c.symbol AND d.date = q.date
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

export type SslSnapshot = Record<string, number | string | null>;

/** @deprecated Use SslSnapshot */
export type NinoScriptSnapshot = SslSnapshot;

/** Snapshot row for SSL scan evaluation (OHLCV indicators + company fields). */
export function getNinoScriptSnapshot(symbol: string, asOfDate: string): SslSnapshot | null {
  const db = getDb();
  if (!db) return null;
  const row = db.prepare(`
    SELECT
      q.last_price, q.volume, q.high_52w, q.off_52w_high_pct, q.atr_pct_21d,
      ${EFFECTIVE_MARKET_CAP_SQL} AS market_cap,
      c.ipo_date, c.sector, c.industry, c.exchange, c.shares_outstanding,
      i.rs_pct_1w, i.rs_pct_1m, i.rs_pct_3m, i.rs_pct_6m, i.rs_pct_12m,
      i.industry_rank_1m, i.industry_rank_3m, i.industry_rank_6m, i.industry_rank_12m,
      i.sector_rank_1m, i.sector_rank_3m, i.sector_rank_6m, i.sector_rank_12m
    FROM companies c
    LEFT JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
    LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = ?
    WHERE c.symbol = ?
    LIMIT 1
  `).get(asOfDate, asOfDate, symbol) as Record<string, unknown> | undefined;
  if (!row) return null;
  const snapshot: SslSnapshot = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) snapshot[k] = null;
    else if (typeof v === "number") snapshot[k] = v;
    else snapshot[k] = String(v);
  }
  return snapshot;
}

/** Alias for SSL — same as {@link getNinoScriptSnapshot}. */
export const getSslSnapshot = getNinoScriptSnapshot;

/** One fiscal period row from `financials` (SSL fundamentals). */
export type SslFinancialRow = {
  period_end: string;
  eps: number | null;
  eps_growth_yoy: number | null;
  sales: number | null;
  sales_growth_yoy: number | null;
};

/** Quarterly and annual series, newest first (index 0 = latest period_end <= asOfDate). */
export type SslFinancialSeries = {
  quarterly: SslFinancialRow[];
  annual: SslFinancialRow[];
};

function mapFinancialRow(r: Record<string, unknown>): SslFinancialRow {
  return {
    period_end: String(r.period_end ?? ""),
    eps: typeof r.eps === "number" ? r.eps : null,
    eps_growth_yoy: typeof r.eps_growth_yoy === "number" ? r.eps_growth_yoy : null,
    sales: typeof r.sales === "number" ? r.sales : null,
    sales_growth_yoy: typeof r.sales_growth_yoy === "number" ? r.sales_growth_yoy : null,
  };
}

/** Load fundamentals for SSL `Q()` / `A()` (point-in-time: `period_end <= asOfDate`). */
export function getFinancialSeriesForSsl(symbol: string, asOfDate: string): SslFinancialSeries {
  const db = getDb();
  if (!db) return { quarterly: [], annual: [] };
  const qRows = db
    .prepare(
      `SELECT period_end, eps, eps_growth_yoy, sales, sales_growth_yoy
       FROM financials
       WHERE symbol = ? AND period_type = 'quarterly' AND period_end <= ?
       ORDER BY period_end DESC`
    )
    .all(symbol, asOfDate) as Record<string, unknown>[];
  const aRows = db
    .prepare(
      `SELECT period_end, eps, eps_growth_yoy, sales, sales_growth_yoy
       FROM financials
       WHERE symbol = ? AND period_type = 'annual' AND period_end <= ?
       ORDER BY period_end DESC`
    )
    .all(symbol, asOfDate) as Record<string, unknown>[];
  return {
    quarterly: qRows.map(mapFinancialRow),
    annual: aRows.map(mapFinancialRow),
  };
}

export type DailyBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Get daily bars for a symbol up to asOfDate, newest-first. For SSL. */
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

/** Compute the average daily volume over the last N trading days for a symbol. */
export function getAvgVolume(symbol: string, days = 30): number | null {
  const db = getDb();
  if (!db) return null;
  const row = db
    .prepare(
      "SELECT AVG(volume) AS avg_vol FROM (SELECT volume FROM daily_bars WHERE symbol = ? ORDER BY date DESC LIMIT ?)"
    )
    .get(symbol, days) as { avg_vol: number | null } | undefined;
  return row?.avg_vol != null ? Number(row.avg_vol) : null;
}

/** Compute the average daily volume for multiple symbols at once. */
export function getAvgVolumeBatch(symbols: string[], days = 30): Map<string, number> {
  const db = getDb();
  if (!db || symbols.length === 0) return new Map();
  const result = new Map<string, number>();
  const BATCH_SIZE = 500;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT symbol, AVG(volume) AS avg_vol
         FROM (
           SELECT symbol, volume,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
           FROM daily_bars
           WHERE symbol IN (${placeholders})
         )
         WHERE rn <= ?
         GROUP BY symbol`
      )
      .all(...batch, days) as Array<{ symbol: string; avg_vol: number | null }>;
    for (const row of rows) {
      if (row.avg_vol != null && Number.isFinite(Number(row.avg_vol))) {
        result.set(String(row.symbol), Number(row.avg_vol));
      }
    }
  }
  return result;
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

export type PerformanceTimeframe = "day" | "week" | "month" | "quarter" | "half_year" | "year" | "ytd";

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

/**
 * Calendar days to load before each as-of date so ROWS BETWEEN N PRECEDING has enough trading rows (~5 per 7 calendar).
 * Keep in sync with `nnhCalendarBufferDays` in `scripts/compute-market-aggregates.mjs`.
 */
function nnhCalendarBufferDays(lookbackDays: number): number {
  return Math.max(lookbackDays + 120, Math.ceil((lookbackDays * 7) / 5) + 40);
}

function getPerformanceLookbackDays(timeframe: PerformanceTimeframe, asOfDate?: string): number {
  switch (timeframe) {
    case "day":
      return 1;
    case "week":
      return 5;
    case "month":
      return 21;
    case "quarter":
      return 63;
    case "half_year":
      return 126;
    case "year":
      return 252;
    case "ytd": {
      const d = asOfDate ? new Date(`${asOfDate}T00:00:00Z`) : new Date();
      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const calendarDays = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
      return Math.max(1, Math.round(calendarDays * (252 / 365)));
    }
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
  const directPath = join(getDataDir(), `${indexId}.json`);
  const staticPath = join(process.cwd(), "static-data", `${indexId}.json`);
  const bootstrapPath = join(process.cwd(), "bootstrap-data", `${indexId}.json`);
  const p = existsSync(directPath) ? directPath : existsSync(staticPath) ? staticPath : existsSync(bootstrapPath) ? bootstrapPath : null;
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

/**
 * Latest session date where `indicators_daily` has broad enough coverage to trust
 * indicator-backed aggregates (same threshold style as daily_bars in
 * {@link getLatestCompletedTradingDate}). Returns null when the table is missing
 * or no date meets the bar — avoids capping the app when indicator data is absent.
 */
function getLatestReliableIndicatorsDateFromDb(db: BetterSqlite3Database): string | null {
  try {
    db.prepare("SELECT 1 FROM indicators_daily LIMIT 1").get();
  } catch {
    return null;
  }
  const companyCountRow = db.prepare("SELECT COUNT(*) AS c FROM companies").get() as { c: number } | undefined;
  const companyCount = Number(companyCountRow?.c ?? 0);
  const minCoverage = companyCount > 0 ? Math.max(200, Math.floor(companyCount * 0.8)) : 200;
  const nyToday = getTodayDateInNewYork();
  const row = db
    .prepare(
      `
      SELECT MAX(date) AS d FROM (
        SELECT date, COUNT(DISTINCT symbol) AS cnt
        FROM indicators_daily
        WHERE date < ?
        GROUP BY date
        HAVING cnt >= ?
      )
      `
    )
    .get(nyToday, minCoverage) as { d: string | null } | undefined;
  return row?.d != null && String(row.d).length >= 8 ? String(row.d) : null;
}

function minIsoTradingDate(a: string, b: string | null): string {
  if (!b) return a;
  return a < b ? a : b;
}

export function getLatestCompletedTradingDate(): string | null {
  const db = getDb();
  if (!db) return null;
  const latestScreenerDate = getLatestReliableScreenerDateFromDb(db);
  const latestIndicatorDate = getLatestReliableIndicatorsDateFromDb(db);
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
  if (recent.length === 0) {
    if (!latestScreenerDate) return latestIndicatorDate;
    return minIsoTradingDate(latestScreenerDate, latestIndicatorDate);
  }
  const reliable = recent.find((r) => Number(r.cnt ?? 0) >= minCoverage);
  const latestDailyDate = String(reliable?.date ?? recent[0].date);
  // Use the common upper bound so endpoints that rely on quote/indicator coverage
  // don't switch to a date where those joins are still incomplete.
  let upper = latestDailyDate;
  upper = minIsoTradingDate(upper, latestScreenerDate);
  upper = minIsoTradingDate(upper, latestIndicatorDate);
  return upper;
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
  const lookbackDays = getPerformanceLookbackDays(timeframe, asOfDate);
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
  const lookbackDays = getPerformanceLookbackDays(timeframe, asOfDate);
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
  from.setUTCDate(from.getUTCDate() - nnhCalendarBufferDays(lookbackDays));
  const bufferStartDate = from.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `
      WITH base AS (
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
        WHERE d.symbol IN (${symbolFilter})
          AND d.date BETWEEN ? AND ?
      )
      SELECT
        date,
        SUM(CASE WHEN prior_count = ${lookbackDays} AND high > prior_high THEN 1 ELSE 0 END) AS highs,
        SUM(CASE WHEN prior_count = ${lookbackDays} AND low < prior_low THEN 1 ELSE 0 END) AS lows
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
        SUM(CASE WHEN prior_count = ${lookbackDays} AND high > prior_high THEN 1 ELSE 0 END) AS highs,
        SUM(CASE WHEN prior_count = ${lookbackDays} AND low < prior_low THEN 1 ELSE 0 END) AS lows
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

/**
 * Net new highs/lows over the Market Monitor universe (non-ETF, effective cap ≥ {@link MM_MIN_MARKET_CAP_USD} on each as-of date).
 * Matches precomputed `market_monitor_daily` NNH semantics; use when the API falls back off precomputed data.
 */
export function getNetNewHighSeriesMarketMonitor(
  lookbackDays: number,
  displayDays = 60,
  date?: string
): { rows: NetNewHighRow[]; date: string | null } {
  const db = getDb();
  if (!db) return { rows: [], date: null };
  const asOfDate = date ?? getLatestCompletedTradingDate();
  if (!asOfDate) return { rows: [], date: null };

  const hasIsEtf = (db.prepare(
    "SELECT COUNT(*) AS c FROM pragma_table_info('companies') WHERE name = 'is_etf'"
  ).get() as { c: number })?.c > 0;
  const etfFilter = hasIsEtf ? "AND co.is_etf = 0" : "";

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

  const sql = `
    WITH symbols_today AS (
      SELECT DISTINCT d.symbol
      FROM daily_bars d
      INNER JOIN companies co ON co.symbol = d.symbol ${etfFilter}
      LEFT JOIN quote_daily q ON q.symbol = d.symbol AND q.date = d.date
      WHERE d.date = ?
        AND (${MM_EFFECTIVE_MARKET_CAP_SQL}) >= ?
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
      INNER JOIN symbols_today s ON s.symbol = d.symbol
      WHERE d.date BETWEEN ? AND ?
    )
    SELECT
      COALESCE(SUM(CASE WHEN prior_count = ${lookbackDays} AND high > prior_high THEN 1 ELSE 0 END), 0) AS highs,
      COALESCE(SUM(CASE WHEN prior_count = ${lookbackDays} AND low < prior_low THEN 1 ELSE 0 END), 0) AS lows
    FROM base
    WHERE date = ?
  `;
  const stmt = db.prepare(sql);

  const rows: NetNewHighRow[] = [];
  for (const d of displayDatesAsc) {
    const buf = new Date(`${d}T00:00:00Z`);
    buf.setUTCDate(buf.getUTCDate() - nnhCalendarBufferDays(lookbackDays));
    const bufStart = buf.toISOString().slice(0, 10);
    const r = stmt.get(d, MM_MIN_MARKET_CAP_USD, bufStart, d, d) as { highs: number; lows: number } | undefined;
    const highs = Number(r?.highs ?? 0);
    const lows = Number(r?.lows ?? 0);
    rows.push({ date: d, highs, lows, net: highs - lows });
  }

  return { rows, date: asOfDate };
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
        LEFT JOIN quote_daily q ON q.symbol = d.symbol AND q.date = d.date
        WHERE d.date BETWEEN ? AND ?
          AND (${MM_EFFECTIVE_MARKET_CAP_SQL}) >= ?
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
    .all(bufferStartDate, toDate, MM_MIN_MARKET_CAP_USD, startDate, toDate) as Array<{
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

/** Allowlisted keys for GET /api/market-monitor/constituents — predicates must match MM aggregate SQL. */
export type MarketMonitorMetricKey =
  | "up4pct"
  | "down4pct"
  | "up25pct_qtr"
  | "down25pct_qtr"
  | "up25pct_month"
  | "down25pct_month"
  | "up50pct_month"
  | "down50pct_month"
  | "nnh52w_highs"
  | "nnh52w_lows"
  | "count_7x_atr_50d"
  | "count_episodic_pivot"
  | "universe_above_50d"
  | "universe_above_200d";

/** Breadth-style metrics (daily_bar CTE); 52W NNH uses a separate query. */
type MarketMonitorBreadthMetricKey = Exclude<
  MarketMonitorMetricKey,
  | "nnh52w_highs"
  | "nnh52w_lows"
  | "count_7x_atr_50d"
  | "count_episodic_pivot"
  | "universe_above_50d"
  | "universe_above_200d"
>;

const MARKET_MONITOR_METRIC_KEYS: MarketMonitorMetricKey[] = [
  "up4pct",
  "down4pct",
  "up25pct_qtr",
  "down25pct_qtr",
  "up25pct_month",
  "down25pct_month",
  "up50pct_month",
  "down50pct_month",
  "nnh52w_highs",
  "nnh52w_lows",
  "count_7x_atr_50d",
  "count_episodic_pivot",
  "universe_above_50d",
  "universe_above_200d",
];

export function isMarketMonitorMetricKey(s: string): s is MarketMonitorMetricKey {
  return (MARKET_MONITOR_METRIC_KEYS as string[]).includes(s);
}

export type MarketMonitorConstituentRow = {
  symbol: string;
  name: string;
  industry: string;
  price: number;
  changePct: number;
};

export type MarketMonitorTop4PctIndustrySide = "up" | "down";

export type MarketMonitorTop4PctIndustry = {
  industry: string;
  side: MarketMonitorTop4PctIndustrySide;
  count: number;
};

export type MarketMonitorTop4PctIndustriesByDate = Record<
  string,
  Partial<Record<MarketMonitorTop4PctIndustrySide, MarketMonitorTop4PctIndustry>>
>;

/** Same 252-trading-day window as `computeUniverseNNH(..., 252)` / `getNetNewHighSeriesMarketMonitor(252, ...)`. */
const NNh_52W_LOOKBACK = 252;

/** Symbols counted in MM 52W net-new high/low columns for `asOfDate` (MM universe + NNH window semantics). */
function getMarketMonitorNnh52wConstituents(asOfDate: string, side: "highs" | "lows"): MarketMonitorConstituentRow[] {
  const db = getDb();
  if (!db) return [];

  const hasIsEtf = (db.prepare(
    "SELECT COUNT(*) AS c FROM pragma_table_info('companies') WHERE name = 'is_etf'"
  ).get() as { c: number })?.c > 0;
  const etfFilter = hasIsEtf ? "AND co.is_etf = 0" : "";

  const buf = new Date(`${asOfDate}T00:00:00Z`);
  buf.setUTCDate(buf.getUTCDate() - nnhCalendarBufferDays(NNh_52W_LOOKBACK));
  const bufStart = buf.toISOString().slice(0, 10);

  const pred =
    side === "highs"
      ? `b.prior_count = ${NNh_52W_LOOKBACK} AND b.high > b.prior_high`
      : `b.prior_count = ${NNh_52W_LOOKBACK} AND b.low < b.prior_low`;
  const orderDir = side === "highs" ? "DESC" : "ASC";

  const sql = `
    WITH symbols_today AS (
      SELECT DISTINCT d.symbol
      FROM daily_bars d
      INNER JOIN companies co ON co.symbol = d.symbol ${etfFilter}
      LEFT JOIN quote_daily q ON q.symbol = d.symbol AND q.date = d.date
      WHERE d.date = ?
        AND (${MM_EFFECTIVE_MARKET_CAP_SQL}) >= ?
    ),
    base AS (
      SELECT
        d.symbol,
        d.date,
        d.close,
        d.high,
        d.low,
        LAG(d.close, 1) OVER (PARTITION BY d.symbol ORDER BY d.date) AS prev_close,
        MAX(d.high) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
          ROWS BETWEEN ${NNh_52W_LOOKBACK} PRECEDING AND 1 PRECEDING
        ) AS prior_high,
        MIN(d.low) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
          ROWS BETWEEN ${NNh_52W_LOOKBACK} PRECEDING AND 1 PRECEDING
        ) AS prior_low,
        COUNT(d.high) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
          ROWS BETWEEN ${NNh_52W_LOOKBACK} PRECEDING AND 1 PRECEDING
        ) AS prior_count
      FROM daily_bars d
      INNER JOIN symbols_today s ON s.symbol = d.symbol
      WHERE d.date BETWEEN ? AND ?
    )
    SELECT
      b.symbol AS symbol,
      COALESCE(co.name, '') AS name,
      COALESCE(co.industry, '') AS industry,
      b.close AS price,
      CASE
        WHEN b.prev_close IS NOT NULL AND b.prev_close > 0 THEN 100.0 * (b.close - b.prev_close) / b.prev_close
        ELSE 0
      END AS changePct
    FROM base b
    INNER JOIN companies co ON co.symbol = b.symbol
    WHERE b.date = ?
      AND (${pred})
    ORDER BY changePct ${orderDir}
  `;

  const rows = db.prepare(sql).all(asOfDate, MM_MIN_MARKET_CAP_USD, bufStart, asOfDate, asOfDate) as Array<{
    symbol: string;
    name: string;
    industry: string;
    price: number;
    changePct: number;
  }>;

  return rows.map((r) => ({
    symbol: String(r.symbol),
    name: String(r.name ?? ""),
    industry: String(r.industry ?? ""),
    price: Number(r.price ?? 0),
    changePct: Number(r.changePct ?? 0),
  }));
}

/** Stocks counted in a Market Monitor cell for `asOfDate` + `metric` (same rules as aggregates). Sorted: up metrics by changePct DESC, down by ASC. */
export function getMarketMonitorConstituents(
  asOfDate: string,
  metric: MarketMonitorMetricKey
): MarketMonitorConstituentRow[] {
  if (metric === "nnh52w_highs") return getMarketMonitorNnh52wConstituents(asOfDate, "highs");
  if (metric === "nnh52w_lows") return getMarketMonitorNnh52wConstituents(asOfDate, "lows");

  const db = getDb();
  if (!db) return [];

  const hasIsEtf = (db.prepare(
    "SELECT COUNT(*) AS c FROM pragma_table_info('companies') WHERE name = 'is_etf'"
  ).get() as { c: number })?.c > 0;
  const etfFilter = hasIsEtf ? "AND co.is_etf = 0" : "";

  if (metric === "count_7x_atr_50d" || metric === "count_episodic_pivot") {
    const indPred =
      metric === "count_7x_atr_50d"
        ? "i.atr_multiple_sma50 IS NOT NULL AND i.atr_multiple_sma50 >= 7"
        : "i.episodic_pivot = 1";
    const sql = `
    WITH symbols_today AS (
      SELECT DISTINCT d.symbol
      FROM daily_bars d
      INNER JOIN companies co ON co.symbol = d.symbol ${etfFilter}
      LEFT JOIN quote_daily q ON q.symbol = d.symbol AND q.date = d.date
      WHERE d.date = ?
        AND (${MM_EFFECTIVE_MARKET_CAP_SQL}) >= ?
    ),
    b AS (
      SELECT
        d.symbol,
        d.date,
        d.close,
        LAG(d.close, 1) OVER (PARTITION BY d.symbol ORDER BY d.date) AS prev_close
      FROM daily_bars d
      INNER JOIN symbols_today st ON st.symbol = d.symbol
      WHERE d.date <= ?
    )
    SELECT
      b.symbol AS symbol,
      COALESCE(co.name, '') AS name,
      COALESCE(co.industry, '') AS industry,
      b.close AS price,
      CASE
        WHEN b.prev_close IS NOT NULL AND b.prev_close > 0 THEN 100.0 * (b.close - b.prev_close) / b.prev_close
        ELSE 0
      END AS changePct
    FROM b
    INNER JOIN companies co ON co.symbol = b.symbol
    INNER JOIN indicators_daily i ON i.symbol = b.symbol AND i.date = b.date
    WHERE b.date = ?
      AND (${indPred})
    ORDER BY changePct DESC
  `;
    const rows = db.prepare(sql).all(
      asOfDate,
      MM_MIN_MARKET_CAP_USD,
      asOfDate,
      asOfDate
    ) as Array<{
      symbol: string;
      name: string;
      industry: string;
      price: number;
      changePct: number;
    }>;

    return rows.map((r) => ({
      symbol: String(r.symbol),
      name: String(r.name ?? ""),
      industry: String(r.industry ?? ""),
      price: Number(r.price ?? 0),
      changePct: Number(r.changePct ?? 0),
    }));
  }

  if (metric === "universe_above_50d" || metric === "universe_above_200d") {
    const emaPred = metric === "universe_above_50d" ? "i.above_ema_50 = 1" : "i.above_ema_200 = 1";
    const sql = `
    WITH symbols_today AS (
      SELECT DISTINCT d.symbol
      FROM daily_bars d
      INNER JOIN companies co ON co.symbol = d.symbol ${etfFilter}
      LEFT JOIN quote_daily q ON q.symbol = d.symbol AND q.date = d.date
      WHERE d.date = ?
        AND (${MM_EFFECTIVE_MARKET_CAP_SQL}) >= ?
    ),
    b AS (
      SELECT
        d.symbol,
        d.date,
        d.close,
        LAG(d.close, 1) OVER (PARTITION BY d.symbol ORDER BY d.date) AS prev_close
      FROM daily_bars d
      INNER JOIN symbols_today st ON st.symbol = d.symbol
      WHERE d.date <= ?
    )
    SELECT
      b.symbol AS symbol,
      COALESCE(co.name, '') AS name,
      COALESCE(co.industry, '') AS industry,
      b.close AS price,
      CASE
        WHEN b.prev_close IS NOT NULL AND b.prev_close > 0 THEN 100.0 * (b.close - b.prev_close) / b.prev_close
        ELSE 0
      END AS changePct
    FROM b
    INNER JOIN companies co ON co.symbol = b.symbol
    INNER JOIN indicators_daily i ON i.symbol = b.symbol AND i.date = b.date
    WHERE b.date = ?
      AND (${emaPred})
    ORDER BY changePct DESC
  `;
    const rows = db.prepare(sql).all(
      asOfDate,
      MM_MIN_MARKET_CAP_USD,
      asOfDate,
      asOfDate
    ) as Array<{
      symbol: string;
      name: string;
      industry: string;
      price: number;
      changePct: number;
    }>;

    return rows.map((r) => ({
      symbol: String(r.symbol),
      name: String(r.name ?? ""),
      industry: String(r.industry ?? ""),
      price: Number(r.price ?? 0),
      changePct: Number(r.changePct ?? 0),
    }));
  }

  const from = new Date(`${asOfDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 120);
  const bufferStartDate = from.toISOString().slice(0, 10);

  const cfg: Record<
    MarketMonitorBreadthMetricKey,
    { predicate: string; changeExpr: string; sortDesc: boolean }
  > = {
    up4pct: {
      predicate: `b.C1 > 0 AND 100.0*(b.C-b.C1)/b.C1 >= 4 AND b.V >= 1000 AND b.V > b.V1`,
      changeExpr: `100.0*(b.C-b.C1)/b.C1`,
      sortDesc: true,
    },
    down4pct: {
      predicate: `b.C1 > 0 AND 100.0*(b.C-b.C1)/b.C1 <= -4 AND b.V >= 1000 AND b.V > b.V1`,
      changeExpr: `100.0*(b.C-b.C1)/b.C1`,
      sortDesc: false,
    },
    up25pct_qtr: {
      predicate: `b.C65 > 0 AND b.avg_c_20*b.avg_v_20 >= 2500 AND 100.0*(b.C-b.C65)/b.C65 >= 25`,
      changeExpr: `100.0*(b.C-b.C65)/b.C65`,
      sortDesc: true,
    },
    down25pct_qtr: {
      predicate: `b.C65 > 0 AND b.avg_c_20*b.avg_v_20 >= 2500 AND 100.0*(b.C-b.C65)/b.C65 <= -25`,
      changeExpr: `100.0*(b.C-b.C65)/b.C65`,
      sortDesc: false,
    },
    up25pct_month: {
      predicate: `b.C20 >= 5 AND b.avg_c_20*b.avg_v_20 >= 2500 AND 100.0*(b.C-b.C20)/b.C20 >= 25`,
      changeExpr: `100.0*(b.C-b.C20)/b.C20`,
      sortDesc: true,
    },
    down25pct_month: {
      predicate: `b.C20 >= 5 AND b.avg_c_20*b.avg_v_20 >= 2500 AND 100.0*(b.C-b.C20)/b.C20 <= -25`,
      changeExpr: `100.0*(b.C-b.C20)/b.C20`,
      sortDesc: false,
    },
    up50pct_month: {
      predicate: `b.C20 >= 5 AND b.avg_c_20*b.avg_v_20 >= 2500 AND 100.0*(b.C-b.C20)/b.C20 >= 50`,
      changeExpr: `100.0*(b.C-b.C20)/b.C20`,
      sortDesc: true,
    },
    down50pct_month: {
      predicate: `b.C20 >= 5 AND b.avg_c_20*b.avg_v_20 >= 2500 AND 100.0*(b.C-b.C20)/b.C20 <= -50`,
      changeExpr: `100.0*(b.C-b.C20)/b.C20`,
      sortDesc: false,
    },
  };

  const { predicate, changeExpr, sortDesc } = cfg[metric];
  const orderDir = sortDesc ? "DESC" : "ASC";

  const sql = `
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
      LEFT JOIN quote_daily q ON q.symbol = d.symbol AND q.date = d.date
      WHERE d.date BETWEEN ? AND ?
        AND (${MM_EFFECTIVE_MARKET_CAP_SQL}) >= ?
      WINDOW w AS (PARTITION BY d.symbol ORDER BY d.date)
    )
    SELECT
      b.symbol AS symbol,
      COALESCE(co.name, '') AS name,
      COALESCE(co.industry, '') AS industry,
      b.C AS price,
      (${changeExpr}) AS changePct
    FROM base b
    INNER JOIN companies co ON co.symbol = b.symbol
    WHERE b.date = ?
    AND (${predicate})
    ORDER BY changePct ${orderDir}
  `;

  const rows = db.prepare(sql).all(bufferStartDate, asOfDate, MM_MIN_MARKET_CAP_USD, asOfDate) as Array<{
    symbol: string;
    name: string;
    industry: string;
    price: number;
    changePct: number;
  }>;

  return rows.map((r) => ({
    symbol: String(r.symbol),
    name: String(r.name ?? ""),
    industry: String(r.industry ?? ""),
    price: Number(r.price ?? 0),
    changePct: Number(r.changePct ?? 0),
  }));
}

/** Top non-biotech industries among the 4% up/down Market Monitor constituents, grouped per session. */
export function getTopMarketMonitor4PctIndustries(
  startDate: string,
  endDate: string
): MarketMonitorTop4PctIndustriesByDate {
  const db = getDb();
  if (!db) return {};

  const hasIsEtf = (db.prepare(
    "SELECT COUNT(*) AS c FROM pragma_table_info('companies') WHERE name = 'is_etf'"
  ).get() as { c: number })?.c > 0;
  const etfFilter = hasIsEtf ? "AND co.is_etf = 0" : "";

  const from = new Date(`${startDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 10);
  const bufferStartDate = from.toISOString().slice(0, 10);

  const sql = `
    WITH base AS (
      SELECT
        d.symbol,
        d.date,
        d.close AS C,
        d.volume AS V,
        LAG(d.close, 1) OVER w AS C1,
        LAG(d.volume, 1) OVER w AS V1,
        TRIM(COALESCE(co.industry, '')) AS industry
      FROM daily_bars d
      INNER JOIN companies co ON co.symbol = d.symbol ${etfFilter}
      LEFT JOIN quote_daily q ON q.symbol = d.symbol AND q.date = d.date
      WHERE d.date BETWEEN ? AND ?
        AND (${MM_EFFECTIVE_MARKET_CAP_SQL}) >= ?
      WINDOW w AS (PARTITION BY d.symbol ORDER BY d.date)
    ),
    matches AS (
      SELECT date, 'up' AS side, industry, COUNT(*) AS stockCount
      FROM base
      WHERE date BETWEEN ? AND ?
        AND industry <> ''
        AND LOWER(industry) NOT LIKE '%biotech%'
        AND C1 > 0
        AND 100.0*(C-C1)/C1 >= 4
        AND V >= 1000
        AND V > V1
      GROUP BY date, industry
      UNION ALL
      SELECT date, 'down' AS side, industry, COUNT(*) AS stockCount
      FROM base
      WHERE date BETWEEN ? AND ?
        AND industry <> ''
        AND LOWER(industry) NOT LIKE '%biotech%'
        AND C1 > 0
        AND 100.0*(C-C1)/C1 <= -4
        AND V >= 1000
        AND V > V1
      GROUP BY date, industry
    ),
    ranked AS (
      SELECT
        date,
        side,
        industry,
        stockCount,
        ROW_NUMBER() OVER (PARTITION BY date, side ORDER BY stockCount DESC, industry ASC) AS rn
      FROM matches
    )
    SELECT date, side, industry, stockCount
    FROM ranked
    WHERE rn = 1
    ORDER BY date DESC, side ASC
  `;

  const rows = db.prepare(sql).all(
    bufferStartDate,
    endDate,
    MM_MIN_MARKET_CAP_USD,
    startDate,
    endDate,
    startDate,
    endDate
  ) as Array<{
    date: string;
    side: MarketMonitorTop4PctIndustrySide;
    industry: string;
    stockCount: number;
  }>;

  const byDate: MarketMonitorTop4PctIndustriesByDate = {};
  for (const row of rows) {
    const date = String(row.date);
    const side = row.side === "down" ? "down" : "up";
    byDate[date] ??= {};
    byDate[date][side] = {
      industry: String(row.industry ?? ""),
      side,
      count: Number(row.stockCount ?? 0),
    };
  }
  return byDate;
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
  universe_pct_above_50d: number | null;
  universe_pct_above_200d: number | null;
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
  count_7x_atr_50d: number | null;
  count_episodic_pivot: number | null;
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
    universe_pct_above_50d:
      r.universe_pct_above_50d != null ? Number(r.universe_pct_above_50d) : null,
    universe_pct_above_200d:
      r.universe_pct_above_200d != null ? Number(r.universe_pct_above_200d) : null,
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
    count_7x_atr_50d: r.count_7x_atr_50d != null ? Number(r.count_7x_atr_50d) : null,
    count_episodic_pivot: r.count_episodic_pivot != null ? Number(r.count_episodic_pivot) : null,
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

/* ── Pre-computed Performance Cache ── */

export type CachedPerformanceRow = {
  category_type: string;
  name: string;
  timeframe: string;
  change_pct: number;
  total_market_cap: number | null;
  stock_count: number | null;
  date: string;
};

export function ensurePerformanceCacheTable(): void {
  const db = getDb();
  if (!db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS performance_cache (
        category_type TEXT NOT NULL,
        name TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        change_pct REAL,
        total_market_cap REAL,
        stock_count INTEGER,
        date TEXT NOT NULL,
        PRIMARY KEY (category_type, name, timeframe, date)
      )
    `);
  } catch {
    // DB may be read-only (e.g. on Render); table creation is best-effort.
    // The precompute script creates it during daily refresh instead.
  }
}

export function getPrecomputedPerformance(
  categoryType: string,
  timeframe: PerformanceTimeframe,
  date?: string
): CachedPerformanceRow[] | null {
  const db = getDb();
  if (!db) return null;
  const asOfDate = date ?? getLatestCompletedTradingDate();
  if (!asOfDate) return null;
  try {
    // Find the latest cached date that's <= the requested date (handles same-day mismatch)
    const dateRow = db
      .prepare(
        "SELECT MAX(date) AS d FROM performance_cache WHERE category_type = ? AND timeframe = ? AND date <= ?"
      )
      .get(categoryType, timeframe, asOfDate) as { d: string | null } | undefined;
    const cacheDate = dateRow?.d;
    if (!cacheDate) return null;
    const rows = db
      .prepare(
        "SELECT category_type, name, timeframe, change_pct, total_market_cap, stock_count, date FROM performance_cache WHERE category_type = ? AND timeframe = ? AND date = ? ORDER BY change_pct DESC"
      )
      .all(categoryType, timeframe, cacheDate) as CachedPerformanceRow[];
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

