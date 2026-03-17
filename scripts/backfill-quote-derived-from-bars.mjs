#!/usr/bin/env node
/**
 * Backfill missing quote_daily derived fields using local daily_bars data.
 *
 * Fills (when missing):
 * - prev_close
 * - avg_volume_30d_shares
 * - high_52w
 * - off_52w_high_pct
 * - atr_pct_21d (21-day SMA true range approximation)
 * - market_cap (shares_outstanding * price fallback)
 *
 * Run: node scripts/backfill-quote-derived-from-bars.mjs
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");

function countMissing(db) {
  return db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN prev_close IS NULL OR prev_close <= 0 THEN 1 ELSE 0 END) AS prev_close_missing,
        SUM(CASE WHEN avg_volume_30d_shares IS NULL OR avg_volume_30d_shares <= 0 THEN 1 ELSE 0 END) AS avg_vol_missing,
        SUM(CASE WHEN high_52w IS NULL OR high_52w <= 0 THEN 1 ELSE 0 END) AS high_52w_missing,
        SUM(CASE WHEN off_52w_high_pct IS NULL THEN 1 ELSE 0 END) AS off_52w_missing,
        SUM(CASE WHEN atr_pct_21d IS NULL OR atr_pct_21d <= 0 THEN 1 ELSE 0 END) AS atr_missing,
        SUM(CASE WHEN market_cap IS NULL OR market_cap <= 0 THEN 1 ELSE 0 END) AS market_cap_missing
      FROM quote_daily
      `
    )
    .get();
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -200000");
  db.pragma("busy_timeout = 10000");

  const quoteCols = new Set(db.prepare("PRAGMA table_info(quote_daily)").all().map((r) => r.name));
  if (!quoteCols.has("prev_close")) {
    db.exec("ALTER TABLE quote_daily ADD COLUMN prev_close REAL");
  }

  const before = countMissing(db);
  console.log("Before:", before);
  console.log("Building temporary derived metrics table from daily_bars...");

  db.exec(`
    DROP TABLE IF EXISTS _tmp_quote_derived;
    CREATE TEMP TABLE _tmp_quote_derived AS
    WITH bars AS (
      SELECT
        d.symbol,
        d.date,
        d.close,
        d.high,
        d.low,
        d.volume,
        LAG(d.close) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
        ) AS prev_close,
        AVG(d.volume) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
          ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
        ) AS avg_vol_30,
        MAX(d.high) OVER (
          PARTITION BY d.symbol
          ORDER BY d.date
          ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
        ) AS high_52w
      FROM daily_bars d
    ),
    tr_data AS (
      SELECT
        symbol,
        date,
        close,
        prev_close,
        avg_vol_30,
        high_52w,
        CASE
          WHEN prev_close IS NULL THEN NULL
          ELSE MAX(
            high - low,
            ABS(high - prev_close),
            ABS(low - prev_close)
          )
        END AS tr
      FROM bars
    ),
    atr_data AS (
      SELECT
        symbol,
        date,
        close,
        prev_close,
        avg_vol_30,
        high_52w,
        AVG(tr) OVER (
          PARTITION BY symbol
          ORDER BY date
          ROWS BETWEEN 20 PRECEDING AND CURRENT ROW
        ) AS atr21
      FROM tr_data
    )
    SELECT
      symbol,
      date,
      close,
      prev_close,
      avg_vol_30,
      high_52w,
      CASE
        WHEN high_52w > 0 THEN ((high_52w - close) / high_52w) * 100.0
        ELSE NULL
      END AS off_52w_high_pct,
      CASE
        WHEN close > 0 AND atr21 IS NOT NULL THEN (atr21 / close) * 100.0
        ELSE NULL
      END AS atr_pct_21d
    FROM atr_data;

    CREATE INDEX IF NOT EXISTS idx_tmp_quote_derived_symbol_date
      ON _tmp_quote_derived(symbol, date);
  `);

  console.log("Updating quote_daily with missing derived fields...");
  const tx = db.transaction(() => {
    db.exec(`
      UPDATE quote_daily
      SET
        prev_close = COALESCE(
          CASE WHEN prev_close IS NULL OR prev_close <= 0 THEN NULL ELSE prev_close END,
          (SELECT t.prev_close FROM _tmp_quote_derived t WHERE t.symbol = quote_daily.symbol AND t.date = quote_daily.date)
        ),
        avg_volume_30d_shares = COALESCE(
          CASE WHEN avg_volume_30d_shares IS NULL OR avg_volume_30d_shares <= 0 THEN NULL ELSE avg_volume_30d_shares END,
          (SELECT t.avg_vol_30 FROM _tmp_quote_derived t WHERE t.symbol = quote_daily.symbol AND t.date = quote_daily.date)
        ),
        high_52w = COALESCE(
          CASE WHEN high_52w IS NULL OR high_52w <= 0 THEN NULL ELSE high_52w END,
          (SELECT t.high_52w FROM _tmp_quote_derived t WHERE t.symbol = quote_daily.symbol AND t.date = quote_daily.date)
        ),
        off_52w_high_pct = COALESCE(
          off_52w_high_pct,
          (SELECT t.off_52w_high_pct FROM _tmp_quote_derived t WHERE t.symbol = quote_daily.symbol AND t.date = quote_daily.date)
        ),
        atr_pct_21d = COALESCE(
          CASE WHEN atr_pct_21d IS NULL OR atr_pct_21d <= 0 THEN NULL ELSE atr_pct_21d END,
          (SELECT t.atr_pct_21d FROM _tmp_quote_derived t WHERE t.symbol = quote_daily.symbol AND t.date = quote_daily.date)
        );
    `);

    db.exec(`
      UPDATE quote_daily
      SET market_cap = (
        SELECT
          c.shares_outstanding * COALESCE(
            quote_daily.last_price,
            quote_daily.prev_close,
            t.close
          )
        FROM companies c
        LEFT JOIN _tmp_quote_derived t
          ON t.symbol = quote_daily.symbol
         AND t.date = quote_daily.date
        WHERE c.symbol = quote_daily.symbol
      )
      WHERE (market_cap IS NULL OR market_cap <= 0)
        AND EXISTS (
          SELECT 1
          FROM companies c
          WHERE c.symbol = quote_daily.symbol
            AND c.shares_outstanding IS NOT NULL
            AND c.shares_outstanding > 0
        );
    `);
  });
  tx();

  const after = countMissing(db);
  console.log("After :", after);

  db.exec("DROP TABLE IF EXISTS _tmp_quote_derived;");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  db.close();
  console.log("Backfill complete.");
}

main();
