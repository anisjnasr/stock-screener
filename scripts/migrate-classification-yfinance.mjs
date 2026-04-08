#!/usr/bin/env node
/**
 * One-time migration: replace company sector/industry classification with Yahoo Finance mapping.
 *
 * Default behavior:
 * - Processes non-ETF symbols in companies
 * - Overwrites sector/industry when Yahoo returns values
 * - Preserves existing values when Yahoo returns empty data
 *
 * Usage:
 *   node scripts/migrate-classification-yfinance.mjs
 *   node scripts/migrate-classification-yfinance.mjs --only-missing --limit 500
 *   node scripts/migrate-classification-yfinance.mjs --delay-ms 120
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
};
const hasArg = (name) => args.includes(name);

const LIMIT_ARG = getArg("--limit");
const LIMIT = LIMIT_ARG != null ? Math.max(1, Number.parseInt(LIMIT_ARG, 10) || 0) : null;
const DELAY_ARG = getArg("--delay-ms");
const DELAY_MS = DELAY_ARG != null ? Math.max(0, Number.parseInt(DELAY_ARG, 10) || 0) : 80;
const ONLY_MISSING = hasArg("--only-missing");
const INCLUDE_ETFS = hasArg("--include-etfs");

const USING_CUSTOM_DB = Boolean(process.env.SCREENER_DB_PATH);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

function normalizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function fetchAssetProfile(yf, symbol) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await yf.quoteSummary(symbol, { modules: ["assetProfile"] });
      const profile = result?.assetProfile ?? {};
      return {
        sector: normalizeText(profile.sector),
        industry: normalizeText(profile.industry),
      };
    } catch {
      if (attempt >= maxAttempts) return { sector: null, industry: null };
      await sleep(250 * attempt);
    }
  }
  return { sector: null, industry: null };
}

async function main() {
  loadEnvLocal();
  if (!existsSync(DB_PATH)) {
    console.error(`Missing DB at ${DB_PATH}`);
    process.exit(1);
  }
  if (USING_CUSTOM_DB) {
    console.log("Using SCREENER_DB_PATH:", DB_PATH);
  }

  const YahooFinance = (await import("yahoo-finance2")).default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  db.pragma("busy_timeout = 10000");

  const where = [];
  if (!INCLUDE_ETFS) where.push("COALESCE(is_etf, 0) = 0");
  if (ONLY_MISSING) where.push("(COALESCE(TRIM(industry), '') = '' OR COALESCE(TRIM(sector), '') = '')");
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limitSql = LIMIT != null ? "LIMIT ?" : "";
  const query = `
    SELECT symbol, sector, industry
    FROM companies
    ${whereSql}
    ORDER BY symbol
    ${limitSql}
  `;
  const rows = LIMIT != null ? db.prepare(query).all(LIMIT) : db.prepare(query).all();
  if (!rows.length) {
    console.log("No companies matched migration filter. Nothing to do.");
    db.close();
    return;
  }

  const updateStmt = db.prepare(
    "UPDATE companies SET sector = ?, industry = ?, updated_at = ? WHERE symbol = ?"
  );

  let updated = 0;
  let unchanged = 0;
  let noYahooData = 0;
  let processed = 0;
  const startedAt = Date.now();

  console.log(
    `Starting yfinance classification migration for ${rows.length} symbol(s)...` +
      ` onlyMissing=${ONLY_MISSING ? "yes" : "no"} includeEtfs=${INCLUDE_ETFS ? "yes" : "no"} delayMs=${DELAY_MS}`
  );

  for (const row of rows) {
    const symbol = String(row.symbol).toUpperCase();
    const currentSector = normalizeText(row.sector);
    const currentIndustry = normalizeText(row.industry);

    const profile = await fetchAssetProfile(yf, symbol);
    if (profile.sector == null && profile.industry == null) {
      noYahooData++;
      processed++;
      if (processed % 50 === 0 || processed === rows.length) {
        process.stdout.write(
          `  ${processed}/${rows.length} processed | updated=${updated} unchanged=${unchanged} no_data=${noYahooData}\r`
        );
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
      continue;
    }

    const nextSector = profile.sector ?? currentSector;
    const nextIndustry = profile.industry ?? currentIndustry;
    if (nextSector === currentSector && nextIndustry === currentIndustry) {
      unchanged++;
    } else {
      updateStmt.run(nextSector, nextIndustry, new Date().toISOString(), symbol);
      updated++;
    }

    processed++;
    if (processed % 50 === 0 || processed === rows.length) {
      process.stdout.write(
        `  ${processed}/${rows.length} processed | updated=${updated} unchanged=${unchanged} no_data=${noYahooData}\r`
      );
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  db.close();

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("\n");
  console.log("Migration complete.");
  console.log(`  Processed: ${processed}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  No Yahoo classification data: ${noYahooData}`);
  console.log(`  Elapsed: ${elapsedSec}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

