#!/usr/bin/env node
/**
 * Validation gates for historical backfill rollout.
 * Quarterly YoY checks use the same fiscal pairing as ingestion (see _financial-growth.mjs).
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dbPath as DB_PATH } from "./_db-paths.mjs";
import { computeQuarterlyYoYGrowth } from "./_financial-growth.mjs";

if (!existsSync(DB_PATH)) {
  console.error(`Missing DB at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

function pct(part, total) {
  if (!total || total <= 0) return null;
  return Number(((part / total) * 100).toFixed(2));
}

try {
  const finCols = new Set(db.prepare("PRAGMA table_info(financials)").all().map((r) => r.name));
  const hasFiscal = finCols.has("fiscal_period") && finCols.has("fiscal_year");
  const fiscalPopulatedCount = hasFiscal
    ? Number(
        db
          .prepare(
            `
            SELECT COUNT(*) AS c FROM financials
            WHERE period_type = 'quarterly'
              AND fiscal_period IS NOT NULL
              AND TRIM(COALESCE(fiscal_period, '')) <> ''
            `
          )
          .get()?.c ?? 0
      )
    : 0;
  /** Strict replay matches ingestion only after refresh-financials has written fiscal labels. */
  const applyStrictQuarterlyReplay = fiscalPopulatedCount >= 100;

  const latestIndicators = String(db.prepare("SELECT MAX(date) AS d FROM indicators_daily").get()?.d ?? "");
  const latestBars = String(db.prepare("SELECT MAX(date) AS d FROM daily_bars").get()?.d ?? "");
  const latestQuote = String(db.prepare("SELECT MAX(date) AS d FROM quote_daily").get()?.d ?? "");

  const dailyBarCols = new Set(db.prepare("PRAGMA table_info(daily_bars)").all().map((r) => r.name));
  const hasDollarVolumeCol = dailyBarCols.has("dollar_volume");
  const indCols = new Set(db.prepare("PRAGMA table_info(indicators_daily)").all().map((r) => r.name));
  const hasAdvCols = indCols.has("avg_dollar_volume_1m") && indCols.has("avg_dollar_volume_3m");

  const dollarStats = hasDollarVolumeCol
    ? db
        .prepare(
          `
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN high IS NOT NULL AND low IS NOT NULL AND close IS NOT NULL AND volume IS NOT NULL THEN 1 ELSE 0 END) AS eligible_rows,
        SUM(CASE WHEN dollar_volume IS NOT NULL AND dollar_volume = dollar_volume THEN 1 ELSE 0 END) AS with_dollar_volume
      FROM daily_bars
      `
        )
        .get()
    : { total_rows: 0, eligible_rows: 0, with_dollar_volume: 0 };

  const adv1Eligible = hasAdvCols
    ? Number(
        db
          .prepare(
            `
        SELECT COUNT(*) AS c
        FROM indicators_daily i
        WHERE i.date = ?
          AND (
            SELECT COUNT(*)
            FROM daily_bars b
            WHERE b.symbol = i.symbol AND b.date <= i.date
          ) >= 21
        `
          )
          .get(latestIndicators)?.c ?? 0
      )
    : 0;
  const adv1Present = hasAdvCols
    ? Number(
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM indicators_daily WHERE date = ? AND avg_dollar_volume_1m IS NOT NULL AND avg_dollar_volume_1m = avg_dollar_volume_1m"
          )
          .get(latestIndicators)?.c ?? 0
      )
    : 0;

  const adv3Eligible = hasAdvCols
    ? Number(
        db
          .prepare(
            `
        SELECT COUNT(*) AS c
        FROM indicators_daily i
        WHERE i.date = ?
          AND (
            SELECT COUNT(*)
            FROM daily_bars b
            WHERE b.symbol = i.symbol AND b.date <= i.date
          ) >= 63
        `
          )
          .get(latestIndicators)?.c ?? 0
      )
    : 0;
  const adv3Present = hasAdvCols
    ? Number(
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM indicators_daily WHERE date = ? AND avg_dollar_volume_3m IS NOT NULL AND avg_dollar_volume_3m = avg_dollar_volume_3m"
          )
          .get(latestIndicators)?.c ?? 0
      )
    : 0;

  let comparableRows = 0;
  let epsMismatch = 0;
  let salesMismatch = 0;
  let epsNullOnComparable = 0;
  let salesNullOnComparable = 0;
  const tolerance = 1e-4;

  if (applyStrictQuarterlyReplay) {
    const quarterlySelect = `
      SELECT symbol, period_end, eps, sales AS revenue, eps_growth_yoy, sales_growth_yoy, fiscal_period, fiscal_year
      FROM financials
      WHERE period_type = 'quarterly'
      ORDER BY symbol, period_end DESC
    `;
    const quarterlyRows = db.prepare(quarterlySelect).all();
    const bySymbol = new Map();
    for (const r of quarterlyRows) {
      const symbol = String(r.symbol);
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
      bySymbol.get(symbol).push(r);
    }

    for (const [, rows] of bySymbol.entries()) {
      const series = rows.map((r) => ({
        period_end: r.period_end,
        fiscal_period: r.fiscal_period ?? null,
        fiscal_year: r.fiscal_year != null && Number.isFinite(Number(r.fiscal_year)) ? Number(r.fiscal_year) : null,
        eps: r.eps,
        revenue: r.revenue,
      }));

      for (const row of rows) {
        const cur = series.find((s) => s.period_end === row.period_end);
        if (!cur) continue;
        const { epsGrowth: expEps, salesGrowth: expSales } = computeQuarterlyYoYGrowth(cur, series);
        const storedEpsGrowth = row.eps_growth_yoy != null ? Number(row.eps_growth_yoy) : null;
        const storedSalesGrowth = row.sales_growth_yoy != null ? Number(row.sales_growth_yoy) : null;

        comparableRows++;
        if (expEps == null) {
          if (storedEpsGrowth != null) epsMismatch++;
        } else if (storedEpsGrowth == null || !Number.isFinite(storedEpsGrowth)) {
          epsNullOnComparable++;
        } else if (Math.abs(expEps - storedEpsGrowth) > tolerance) {
          epsMismatch++;
        }

        if (expSales == null) {
          if (storedSalesGrowth != null) salesMismatch++;
        } else if (storedSalesGrowth == null || !Number.isFinite(storedSalesGrowth)) {
          salesNullOnComparable++;
        } else if (Math.abs(expSales - storedSalesGrowth) > tolerance) {
          salesMismatch++;
        }
      }
    }
  }

  const dollarEligible = Number(dollarStats?.eligible_rows ?? 0);
  const dollarPresent = Number(dollarStats?.with_dollar_volume ?? 0);
  const dollarCoveragePct = hasDollarVolumeCol ? pct(dollarPresent, dollarEligible) : null;
  const adv1CoveragePct = hasAdvCols ? pct(adv1Present, adv1Eligible) : null;
  const adv3CoveragePct = hasAdvCols ? pct(adv3Present, adv3Eligible) : null;
  const epsMismatchPct = pct(epsMismatch, comparableRows);
  const salesMismatchPct = pct(salesMismatch, comparableRows);

  /** After full compute-indicators, expect ~99%+; allow 85% until a full recompute (e.g. large DB partial run). */
  const advMinPct = Number(process.env.VALIDATE_ADV_MIN_PCT ?? "85");
  const gates = {
    freshnessSynced: Boolean(latestBars && latestBars === latestIndicators && latestBars === latestQuote),
    dollarVolumeCoverage:
      !hasDollarVolumeCol || (dollarCoveragePct != null && dollarCoveragePct >= 99.5),
    adv1mCoverage: !hasAdvCols || (adv1CoveragePct != null && adv1CoveragePct >= advMinPct),
    adv3mCoverage: !hasAdvCols || (adv3CoveragePct != null && adv3CoveragePct >= advMinPct),
    quarterlyEpsMismatch:
      !applyStrictQuarterlyReplay || (epsMismatchPct != null && epsMismatchPct <= 0.5),
    quarterlySalesMismatch:
      !applyStrictQuarterlyReplay || (salesMismatchPct != null && salesMismatchPct <= 0.5),
  };

  const pass = Object.values(gates).every(Boolean);
  const output = {
    pass,
    dbPath: DB_PATH,
    latest: {
      daily_bars: latestBars || null,
      quote_daily: latestQuote || null,
      indicators_daily: latestIndicators || null,
    },
    schema: {
      daily_bars_has_dollar_volume: hasDollarVolumeCol,
      indicators_has_avg_dollar_volume: hasAdvCols,
    },
    coverage: {
      dollar_volume: {
        eligible_rows: dollarEligible,
        present_rows: dollarPresent,
        coverage_pct: dollarCoveragePct,
      },
      avg_dollar_volume_1m: {
        eligible_rows: adv1Eligible,
        present_rows: adv1Present,
        coverage_pct: adv1CoveragePct,
      },
      avg_dollar_volume_3m: {
        eligible_rows: adv3Eligible,
        present_rows: adv3Present,
        coverage_pct: adv3CoveragePct,
      },
    },
    quarterly_yoy_validation: {
      strict_replay_applied: applyStrictQuarterlyReplay,
      fiscal_quarterly_rows_with_period: fiscalPopulatedCount,
      comparable_rows: comparableRows,
      fiscal_columns_in_schema: hasFiscal,
      eps_mismatch_rows: epsMismatch,
      eps_mismatch_pct: epsMismatchPct,
      sales_mismatch_rows: salesMismatch,
      sales_mismatch_pct: salesMismatchPct,
      eps_null_on_comparable_rows: epsNullOnComparable,
      sales_null_on_comparable_rows: salesNullOnComparable,
      note: hasFiscal
        ? "Validated using the same fiscal pairing as refresh-financials (_financial-growth.mjs). Re-run refresh-financials after schema upgrade to populate fiscal_period/fiscal_year."
        : "Run DB migration (refresh-financials adds columns) so fiscal_period/fiscal_year are stored; then re-run refresh-financials for accurate replay validation.",
    },
    gates,
  };

  console.log(JSON.stringify(output, null, 2));
  if (!pass) process.exit(1);
} finally {
  db.close();
}
