#!/usr/bin/env node
/**
 * Enrich screener.db companies with GICS industry and sector from Yahoo Finance (yahoo-finance2).
 * Only updates rows that are missing industry and/or sector.
 * Run: node scripts/enrich-companies-gics.mjs  or  npm run enrich-companies-gics
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");

const DELAY_MS = 80;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  const YahooFinance = (await import("yahoo-finance2")).default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  const SQL = await initSqlJs();
  const buf = readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const rows = db.exec(
    "SELECT symbol FROM companies WHERE (COALESCE(industry,'') = '') OR (COALESCE(sector,'') = '') ORDER BY symbol"
  );
  const symbols = rows[0] ? rows[0].values.map((r) => r[0]) : [];
  if (symbols.length === 0) {
    console.log("All companies already have industry and sector. Nothing to do.");
    db.close();
    return;
  }

  console.log(`Enriching ${symbols.length} companies with GICS industry/sector from Yahoo Finance...\n`);

  const updateStmt = db.prepare(
    "UPDATE companies SET industry = ?, sector = ?, updated_at = ? WHERE symbol = ?"
  );
  const now = new Date().toISOString();

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = String(symbols[i]);

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

      updateStmt.run([industry, sector, now, symbol]);
      updated++;
    } catch {
      failed++;
    }

    if ((i + 1) % 50 === 0 || i === symbols.length - 1) {
      process.stdout.write(`  ${i + 1}/${symbols.length} processed (${updated} updated, ${failed} failed)\r`);
    }
    await sleep(DELAY_MS);
  }

  updateStmt.free();
  writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log("\n");
  console.log("Done. Saved to:", DB_PATH);
  console.log("  Updated:", updated);
  console.log("  Failed (no data):", failed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
