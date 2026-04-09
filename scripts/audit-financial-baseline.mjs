#!/usr/bin/env node
/**
 * Full-universe financial completeness audit baseline.
 *
 * Outputs a JSON report with:
 * - symbols missing annual/quarterly financial rows
 * - stale latest period_end distributions
 * - null/invalid eps/revenue counts by period type
 * - growth null rates by period type
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";
import { computeQuarterlyYoYGrowth } from "./_financial-growth.mjs";

const reportsDir = join(root, "data", "reports");
const outPath = join(reportsDir, "financial-baseline-audit.json");

if (!existsSync(DB_PATH)) {
  console.error(`Missing DB at ${DB_PATH}`);
  process.exit(1);
}

mkdirSync(reportsDir, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

const finColNames = new Set(db.prepare("PRAGMA table_info(financials)").all().map((r) => r.name));
const hasFiscalColumns = finColNames.has("fiscal_period") && finColNames.has("fiscal_year");

function numberOrZero(v) {
  return Number(v ?? 0);
}

function percentage(part, total) {
  if (!total || total <= 0) return null;
  return Number(((part / total) * 100).toFixed(2));
}

try {
  const generatedAt = new Date().toISOString();
  const universe = numberOrZero(
    db.prepare("SELECT COUNT(*) AS c FROM companies WHERE COALESCE(is_etf,0)=0").get()?.c
  );

  const missingAnnualRows = db
    .prepare(
      `
      SELECT c.symbol
      FROM companies c
      LEFT JOIN financials f
        ON f.symbol = c.symbol
       AND f.period_type = 'annual'
      WHERE COALESCE(c.is_etf, 0) = 0
      GROUP BY c.symbol
      HAVING COUNT(f.period_end) = 0
      ORDER BY c.symbol
      `
    )
    .all()
    .map((r) => String(r.symbol));

  const missingQuarterlyRows = db
    .prepare(
      `
      SELECT c.symbol
      FROM companies c
      LEFT JOIN financials f
        ON f.symbol = c.symbol
       AND f.period_type = 'quarterly'
      WHERE COALESCE(c.is_etf, 0) = 0
      GROUP BY c.symbol
      HAVING COUNT(f.period_end) = 0
      ORDER BY c.symbol
      `
    )
    .all()
    .map((r) => String(r.symbol));

  const latestAnnual = db
    .prepare(
      `
      SELECT symbol, MAX(period_end) AS latest_period_end
      FROM financials
      WHERE period_type = 'annual'
      GROUP BY symbol
      `
    )
    .all();
  const latestQuarterly = db
    .prepare(
      `
      SELECT symbol, MAX(period_end) AS latest_period_end
      FROM financials
      WHERE period_type = 'quarterly'
      GROUP BY symbol
      `
    )
    .all();

  const annualDist = db
    .prepare(
      `
      SELECT SUBSTR(latest_period_end, 1, 4) AS year, COUNT(*) AS count
      FROM (
        SELECT symbol, MAX(period_end) AS latest_period_end
        FROM financials
        WHERE period_type = 'annual'
        GROUP BY symbol
      )
      GROUP BY year
      ORDER BY year DESC
      `
    )
    .all();
  const quarterlyDist = db
    .prepare(
      `
      SELECT SUBSTR(latest_period_end, 1, 4) AS year, COUNT(*) AS count
      FROM (
        SELECT symbol, MAX(period_end) AS latest_period_end
        FROM financials
        WHERE period_type = 'quarterly'
        GROUP BY symbol
      )
      GROUP BY year
      ORDER BY year DESC
      `
    )
    .all();

  const qualityByType = db
    .prepare(
      `
      SELECT
        period_type,
        COUNT(*) AS rows_total,
        SUM(CASE WHEN eps IS NULL OR eps != eps THEN 1 ELSE 0 END) AS eps_null_or_nan,
        SUM(CASE WHEN sales IS NULL OR sales != sales THEN 1 ELSE 0 END) AS sales_null_or_nan,
        SUM(CASE WHEN eps_growth_yoy IS NULL OR eps_growth_yoy != eps_growth_yoy THEN 1 ELSE 0 END) AS eps_growth_null_or_nan,
        SUM(CASE WHEN sales_growth_yoy IS NULL OR sales_growth_yoy != sales_growth_yoy THEN 1 ELSE 0 END) AS sales_growth_null_or_nan
      FROM financials
      GROUP BY period_type
      ORDER BY period_type
      `
    )
    .all()
    .map((r) => {
      const rowsTotal = numberOrZero(r.rows_total);
      const epsNull = numberOrZero(r.eps_null_or_nan);
      const salesNull = numberOrZero(r.sales_null_or_nan);
      const epsGrowthNull = numberOrZero(r.eps_growth_null_or_nan);
      const salesGrowthNull = numberOrZero(r.sales_growth_null_or_nan);
      return {
        period_type: String(r.period_type),
        rows_total: rowsTotal,
        eps_null_or_nan: epsNull,
        sales_null_or_nan: salesNull,
        eps_growth_null_or_nan: epsGrowthNull,
        sales_growth_null_or_nan: salesGrowthNull,
        eps_null_or_nan_pct: percentage(epsNull, rowsTotal),
        sales_null_or_nan_pct: percentage(salesNull, rowsTotal),
        eps_growth_null_or_nan_pct: percentage(epsGrowthNull, rowsTotal),
        sales_growth_null_or_nan_pct: percentage(salesGrowthNull, rowsTotal),
      };
    });

  /** Sample replay of quarterly YoY vs stored values (same logic as ingestion). */
  const SAMPLE_SYMBOLS = 400;
  const tolerance = 1e-4;
  let sampleRowsChecked = 0;
  let sampleEpsMismatch = 0;
  let sampleSalesMismatch = 0;
  const sampleSymbols = db
    .prepare(
      `
      SELECT symbol FROM (
        SELECT DISTINCT symbol FROM financials WHERE period_type = 'quarterly'
      )
      ORDER BY RANDOM()
      LIMIT ?
      `
    )
    .all(SAMPLE_SYMBOLS)
    .map((r) => String(r.symbol));

  const qSelect = hasFiscalColumns
    ? "SELECT period_end, eps, sales AS revenue, eps_growth_yoy, sales_growth_yoy, fiscal_period, fiscal_year FROM financials WHERE symbol = ? AND period_type = 'quarterly' ORDER BY period_end DESC"
    : "SELECT period_end, eps, sales AS revenue, eps_growth_yoy, sales_growth_yoy, NULL AS fiscal_period, NULL AS fiscal_year FROM financials WHERE symbol = ? AND period_type = 'quarterly' ORDER BY period_end DESC";

  const qStmt = db.prepare(qSelect);
  for (const sym of sampleSymbols) {
    const rows = qStmt.all(sym);
    const series = rows.map((r) => ({
      period_end: r.period_end,
      fiscal_period: r.fiscal_period ?? null,
      fiscal_year: r.fiscal_year != null && Number.isFinite(Number(r.fiscal_year)) ? Number(r.fiscal_year) : null,
      eps: r.eps,
      revenue: r.revenue,
    }));
    for (const r of rows) {
      const cur = series.find((s) => s.period_end === r.period_end);
      if (!cur) continue;
      const { epsGrowth: expEps, salesGrowth: expSales } = computeQuarterlyYoYGrowth(cur, series);
      const storedEps = r.eps_growth_yoy != null ? Number(r.eps_growth_yoy) : null;
      const storedSales = r.sales_growth_yoy != null ? Number(r.sales_growth_yoy) : null;
      sampleRowsChecked++;
      if (expEps == null) {
        if (storedEps != null) sampleEpsMismatch++;
      } else if (storedEps == null || !Number.isFinite(storedEps) || Math.abs(expEps - storedEps) > tolerance) {
        sampleEpsMismatch++;
      }
      if (expSales == null) {
        if (storedSales != null) sampleSalesMismatch++;
      } else if (storedSales == null || !Number.isFinite(storedSales) || Math.abs(expSales - storedSales) > tolerance) {
        sampleSalesMismatch++;
      }
    }
  }

  const report = {
    generated_at: generatedAt,
    db_path: DB_PATH,
    universe: {
      non_etf_symbols: universe,
    },
    missing_financial_rows: {
      annual_count: missingAnnualRows.length,
      quarterly_count: missingQuarterlyRows.length,
      annual_symbols_sample: missingAnnualRows.slice(0, 200),
      quarterly_symbols_sample: missingQuarterlyRows.slice(0, 200),
    },
    latest_period_end_distribution: {
      annual: annualDist,
      quarterly: quarterlyDist,
      latest_annual_sample: latestAnnual.slice(0, 50),
      latest_quarterly_sample: latestQuarterly.slice(0, 50),
    },
    null_invalid_counts_by_period_type: qualityByType,
    schema: {
      financials_has_fiscal_columns: hasFiscalColumns,
    },
    quarterly_yoy_replay_sample: {
      symbols_sampled: sampleSymbols.length,
      rows_checked: sampleRowsChecked,
      eps_mismatch_rows: sampleEpsMismatch,
      sales_mismatch_rows: sampleSalesMismatch,
      eps_mismatch_pct: percentage(sampleEpsMismatch, sampleRowsChecked),
      sales_mismatch_pct: percentage(sampleSalesMismatch, sampleRowsChecked),
      note:
        "Replay uses _financial-growth.mjs. After adding fiscal_period/fiscal_year, run refresh-financials so stored growth matches replay when fiscal metadata matters.",
    },
  };

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        report: outPath,
        universe_non_etf: universe,
        missing_annual: missingAnnualRows.length,
        missing_quarterly: missingQuarterlyRows.length,
      },
      null,
      2
    )
  );
} finally {
  db.close();
}

