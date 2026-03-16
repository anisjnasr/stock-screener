#!/usr/bin/env node
/**
 * Seed companies table from data/all-stocks.json.
 * Run after init-screener-db. Run: node scripts/seed-companies.mjs  or  npm run seed-companies
 * Requires: data/all-stocks.json, data/screener.db (from npm run init-screener-db)
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");
const STOCKS_PATH = join(DATA_DIR, "all-stocks.json");
const STOCKS_FALLBACK_PATH = join(root, "bootstrap-data", "all-stocks.json");

const stocksPath = existsSync(STOCKS_PATH) ? STOCKS_PATH : existsSync(STOCKS_FALLBACK_PATH) ? STOCKS_FALLBACK_PATH : null;
if (!stocksPath) {
  console.error("Missing data/all-stocks.json. Run: npm run build-stocks-db");
  console.error("Fallback missing:", STOCKS_FALLBACK_PATH);
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db. Run: npm run init-screener-db");
  process.exit(1);
}

const raw = readFileSync(stocksPath, "utf8");
const { stocks } = JSON.parse(raw);
if (!Array.isArray(stocks) || stocks.length === 0) {
  console.error("No stocks in all-stocks.json");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");
db.pragma("busy_timeout = 10000");

const now = new Date().toISOString();
const stmt = db.prepare(
  `INSERT OR REPLACE INTO companies (symbol, name, exchange, industry, sector, is_adr, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const insertMany = db.transaction((rows) => {
  let localCount = 0;
  for (const s of rows) {
    const symbol = String(s.symbol ?? "").toUpperCase();
    const name = s.name != null ? String(s.name) : "";
    const exchange = s.exchange != null ? String(s.exchange) : null;
    const industry = s.industry != null ? String(s.industry) : null;
    const sector = s.sector != null ? String(s.sector) : null;
    const isAdr = s.type === "ADRC" ? 1 : 0;
    stmt.run(symbol, name, exchange, industry, sector, isAdr, now);
    localCount++;
    if (localCount % 500 === 0) process.stdout.write(`  ${localCount}/${stocks.length}...\r`);
  }
  return localCount;
});
const count = insertMany(stocks);
db.close();

console.log("\nSeeded", count, "companies into screener.db");
