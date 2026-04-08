#!/usr/bin/env node
/**
 * Quick production sign-off audit for classification + IPO ingestion.
 * Read-only checks against screener.db (or SCREENER_DB_PATH).
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dbPath as DB_PATH } from "./_db-paths.mjs";

if (!existsSync(DB_PATH)) {
  console.error(`Missing DB at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

try {
  const latestBarsDate = String(db.prepare("SELECT MAX(date) AS d FROM daily_bars").get()?.d ?? "");
  const latestQuoteDate = String(db.prepare("SELECT MAX(date) AS d FROM quote_daily").get()?.d ?? "");
  const latestIndicatorsDate = String(db.prepare("SELECT MAX(date) AS d FROM indicators_daily").get()?.d ?? "");

  const nonEtfTotal = Number(
    db.prepare("SELECT COUNT(*) AS c FROM companies WHERE COALESCE(is_etf, 0) = 0").get()?.c ?? 0
  );
  const missingEither = Number(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM companies WHERE COALESCE(is_etf, 0) = 0 AND (COALESCE(TRIM(sector), '') = '' OR COALESCE(TRIM(industry), '') = '')"
      )
      .get()?.c ?? 0
  );
  const missingBoth = Number(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM companies WHERE COALESCE(is_etf, 0) = 0 AND COALESCE(TRIM(sector), '') = '' AND COALESCE(TRIM(industry), '') = ''"
      )
      .get()?.c ?? 0
  );

  const missingSamples = db
    .prepare(
      `
      SELECT symbol, sector, industry
      FROM companies
      WHERE COALESCE(is_etf, 0) = 0
        AND (COALESCE(TRIM(sector), '') = '' OR COALESCE(TRIM(industry), '') = '')
      ORDER BY symbol
      LIMIT 20
      `
    )
    .all();

  const today = new Date().toISOString().slice(0, 10);
  const ipoDiscoveredToday = Number(
    db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM ipo_discovery_log WHERE run_date = ?").get(today)?.c ?? 0
  );
  const ipoStateCounts = db
    .prepare("SELECT status, COUNT(*) AS c FROM ipo_ingest_state GROUP BY status ORDER BY c DESC")
    .all();

  console.log(
    JSON.stringify(
      {
        dbPath: DB_PATH,
        freshness: {
          daily_bars: latestBarsDate || null,
          quote_daily: latestQuoteDate || null,
          indicators_daily: latestIndicatorsDate || null,
        },
        classification: {
          non_etf_total: nonEtfTotal,
          missing_sector_or_industry: missingEither,
          missing_both: missingBoth,
          coverage_pct: nonEtfTotal > 0 ? Number((((nonEtfTotal - missingEither) / nonEtfTotal) * 100).toFixed(2)) : null,
          missing_samples: missingSamples,
        },
        ipo: {
          run_date: today,
          discovered_today: ipoDiscoveredToday,
          state_counts: ipoStateCounts,
        },
      },
      null,
      2
    )
  );
} finally {
  db.close();
}

