#!/usr/bin/env node
/**
 * One-time backfill for daily_bars.dollar_volume using:
 * TypicalPrice * Volume = ((high + low + close) / 3) * volume
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dbPath as DB_PATH } from "./_db-paths.mjs";

if (!existsSync(DB_PATH)) {
  console.error(`Missing DB at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000");

try {
  const cols = new Set(db.prepare("PRAGMA table_info(daily_bars)").all().map((r) => r.name));
  if (!cols.has("dollar_volume")) {
    db.exec("ALTER TABLE daily_bars ADD COLUMN dollar_volume REAL");
  }

  const updated = db
    .prepare(
      `
      UPDATE daily_bars
      SET dollar_volume = ((high + low + close) / 3.0) * volume
      WHERE (dollar_volume IS NULL OR dollar_volume != dollar_volume)
        AND high IS NOT NULL
        AND low IS NOT NULL
        AND close IS NOT NULL
        AND volume IS NOT NULL
      `
    )
    .run();

  const coverage = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN high IS NOT NULL AND low IS NOT NULL AND close IS NOT NULL AND volume IS NOT NULL THEN 1 ELSE 0 END) AS rows_with_ohlcv,
        SUM(CASE WHEN dollar_volume IS NOT NULL AND dollar_volume = dollar_volume THEN 1 ELSE 0 END) AS rows_with_dollar_volume
      FROM daily_bars
      `
    )
    .get();

  console.log(
    JSON.stringify(
      {
        updated_rows: Number(updated.changes ?? 0),
        total_rows: Number(coverage?.total_rows ?? 0),
        rows_with_ohlcv: Number(coverage?.rows_with_ohlcv ?? 0),
        rows_with_dollar_volume: Number(coverage?.rows_with_dollar_volume ?? 0),
      },
      null,
      2
    )
  );
} finally {
  db.close();
}

