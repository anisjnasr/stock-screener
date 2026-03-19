#!/usr/bin/env node
/**
 * One-time DB optimization for production. Run before going live.
 * - Adds prev_close column and backfills from daily_bars
 * - Checkpoints WAL (merges WAL into main DB file)
 * - Runs ANALYZE (updates query planner statistics)
 * - Verifies all required indexes exist
 * - Optionally runs VACUUM (rewrites the entire DB for minimal size)
 *
 * Run: node scripts/optimize-db.mjs [--vacuum]
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");

const DO_VACUUM = process.argv.includes("--vacuum");

if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");
db.pragma("busy_timeout = 30000");

console.log("=== Database Optimization ===\n");

// 1. Schema migration: add prev_close to quote_daily
const quoteCols = new Set(db.prepare("PRAGMA table_info(quote_daily)").all().map((r) => r.name));
if (!quoteCols.has("prev_close")) {
  console.log("1. Adding prev_close column to quote_daily...");
  db.exec("ALTER TABLE quote_daily ADD COLUMN prev_close REAL");
  console.log("   Done.");
} else {
  console.log("1. prev_close column already exists.");
}

// 2. Backfill prev_close from daily_bars for rows where it's NULL
const nullCount = db.prepare("SELECT COUNT(*) AS c FROM quote_daily WHERE prev_close IS NULL").get();
if (nullCount.c > 0) {
  console.log(`2. Backfilling prev_close for ${nullCount.c} rows...`);
  db.exec(`
    UPDATE quote_daily SET prev_close = (
      SELECT close FROM daily_bars
      WHERE symbol = quote_daily.symbol AND date < quote_daily.date
      ORDER BY date DESC LIMIT 1
    )
    WHERE prev_close IS NULL
  `);
  const remaining = db.prepare("SELECT COUNT(*) AS c FROM quote_daily WHERE prev_close IS NULL").get();
  console.log(`   Backfilled. Remaining NULL: ${remaining.c} (symbols with no prior bars)`);
} else {
  console.log("2. All prev_close values already populated.");
}

// 3. Verify and create indexes
console.log("3. Verifying indexes...");
const requiredIndexes = [
  ["idx_daily_bars_symbol_date", "daily_bars", "symbol, date"],
  ["idx_daily_bars_date", "daily_bars", "date"],
  ["idx_quote_daily_date_symbol", "quote_daily", "date, symbol"],
  ["idx_quote_daily_date_covering", "quote_daily", "date, symbol, last_price, change_pct, volume, market_cap, prev_close, atr_pct_21d, high_52w, off_52w_high_pct, avg_volume_30d_shares"],
  ["idx_indicators_daily_date_symbol", "indicators_daily", "date, symbol"],
  ["idx_financials_symbol", "financials", "symbol"],
  ["idx_ownership_symbol", "ownership", "symbol"],
];
const existingIndexes = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name)
);
for (const [name, table, cols] of requiredIndexes) {
  if (existingIndexes.has(name)) {
    console.log(`   OK: ${name}`);
  } else {
    console.log(`   Creating: ${name} ON ${table}(${cols})`);
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`);
  }
}

// 4. WAL checkpoint
console.log("4. Checkpointing WAL...");
const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)");
console.log(`   Checkpoint result:`, checkpoint);

// 5. ANALYZE
console.log("5. Running ANALYZE (updating query planner statistics)...");
db.pragma("analysis_limit = 1000");
db.exec("ANALYZE");
console.log("   Done.");

// 6. Integrity check (quick)
console.log("6. Running quick integrity check...");
const integrity = db.pragma("quick_check");
const ok = integrity.length === 1 && integrity[0].quick_check === "ok";
console.log(`   Result: ${ok ? "OK" : "ISSUES FOUND"}`);
if (!ok) console.log("   Details:", integrity);

// 7. Optional VACUUM
if (DO_VACUUM) {
  console.log("7. Running VACUUM (this may take several minutes for large DBs)...");
  db.exec("VACUUM");
  console.log("   Done.");
} else {
  console.log("7. Skipping VACUUM (pass --vacuum to enable; reclaims space but takes time).");
}

// 8. Report stats
const stats = {
  companies: db.prepare("SELECT COUNT(*) AS c FROM companies").get().c,
  daily_bars: db.prepare("SELECT COUNT(*) AS c FROM daily_bars").get().c,
  quote_daily: db.prepare("SELECT COUNT(*) AS c FROM quote_daily").get().c,
  indicators: db.prepare("SELECT COUNT(*) AS c FROM indicators_daily").get().c,
  financials: db.prepare("SELECT COUNT(*) AS c FROM financials").get().c,
  latest_date: db.prepare("SELECT MAX(date) AS d FROM daily_bars").get().d,
  page_size: db.pragma("page_size")[0].page_size,
  page_count: db.pragma("page_count")[0].page_count,
};
const dbSizeMB = (stats.page_size * stats.page_count / 1024 / 1024).toFixed(1);

console.log("\n=== Database Stats ===");
console.log(`  Companies:    ${stats.companies.toLocaleString()}`);
console.log(`  Daily bars:   ${stats.daily_bars.toLocaleString()}`);
console.log(`  Quote daily:  ${stats.quote_daily.toLocaleString()}`);
console.log(`  Indicators:   ${stats.indicators.toLocaleString()}`);
console.log(`  Financials:   ${stats.financials.toLocaleString()}`);
console.log(`  Latest date:  ${stats.latest_date}`);
console.log(`  DB size:      ${dbSizeMB} MB`);
console.log(`  Page size:    ${stats.page_size} bytes`);

db.close();
console.log("\nOptimization complete.");
