#!/usr/bin/env node
/**
 * Check GICS coverage in screener.db, enrich missing from yfinance, report count still missing.
 * Uses better-sqlite3 so the (large) DB is opened on disk without loading into memory.
 * Run: node scripts/check-and-enrich-gics.mjs
 * Requires: npm install better-sqlite3 (dev or regular)
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");

const DELAY_MS = 80;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runCheck(db) {
  const total = db.prepare("SELECT COUNT(*) AS c FROM companies").get().c;
  const missing = db
    .prepare(
      "SELECT COUNT(*) AS c FROM companies WHERE (COALESCE(industry,'') = '') OR (COALESCE(sector,'') = '')"
    )
    .get().c;
  return { total, missing };
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: false });

  console.log("GICS coverage check (screener.db companies)\n");

  const before = runCheck(db);
  console.log("Before enrichment:");
  console.log("  Total companies:     ", before.total);
  console.log("  Missing industry/sector:", before.missing);

  const rows = db
    .prepare(
      "SELECT symbol FROM companies WHERE (COALESCE(industry,'') = '') OR (COALESCE(sector,'') = '') ORDER BY symbol"
    )
    .all();
  const symbols = rows.map((r) => String(r.symbol));

  if (symbols.length === 0) {
    console.log("\nAll companies already have industry and sector. Nothing to do.");
    db.close();
    return;
  }

  const YahooFinance = (await import("yahoo-finance2")).default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  const updateStmt = db.prepare(
    "UPDATE companies SET industry = ?, sector = ?, updated_at = ? WHERE symbol = ?"
  );
  const now = new Date().toISOString();

  let updated = 0;
  let failed = 0;

  console.log(`\nEnriching ${symbols.length} companies from Yahoo Finance...\n`);

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    try {
      const result = await yf.quoteSummary(symbol, { modules: ["assetProfile"] });
      const profile = result?.assetProfile ?? {};
      const sector =
        profile.sector != null && String(profile.sector).trim() !== ""
          ? String(profile.sector).trim()
          : null;
      const industry =
        profile.industry != null && String(profile.industry).trim() !== ""
          ? String(profile.industry).trim()
          : null;

      updateStmt.run(industry, sector, now, symbol);
      updated++;
    } catch {
      failed++;
    }

    if ((i + 1) % 50 === 0 || i === symbols.length - 1) {
      process.stdout.write(`  ${i + 1}/${symbols.length} processed (${updated} updated, ${failed} failed)\r`);
    }
    await sleep(DELAY_MS);
  }

  const after = runCheck(db);
  db.close();

  console.log("\n");
  console.log("After enrichment:");
  console.log("  Updated from Yahoo:  ", updated);
  console.log("  Failed (no data):   ", failed);
  console.log("  Still missing industry and/or sector:", after.missing);
  console.log("\nCount of stocks unable to assign either industry or sector:", after.missing);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
