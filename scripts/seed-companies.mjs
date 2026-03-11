#!/usr/bin/env node
/**
 * Seed companies table from data/all-stocks.json.
 * Run after init-screener-db. Run: node scripts/seed-companies.mjs  or  npm run seed-companies
 * Requires: data/all-stocks.json, data/screener.db (from npm run init-screener-db)
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");
const STOCKS_PATH = join(DATA_DIR, "all-stocks.json");

if (!existsSync(STOCKS_PATH)) {
  console.error("Missing data/all-stocks.json. Run: npm run build-stocks-db");
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db. Run: npm run init-screener-db");
  process.exit(1);
}

const raw = readFileSync(STOCKS_PATH, "utf8");
const { stocks } = JSON.parse(raw);
if (!Array.isArray(stocks) || stocks.length === 0) {
  console.error("No stocks in all-stocks.json");
  process.exit(1);
}

const SQL = await initSqlJs();
const buf = readFileSync(DB_PATH);
const db = new SQL.Database(buf);

const now = new Date().toISOString();
const stmt = db.prepare(
  `INSERT OR REPLACE INTO companies (symbol, name, exchange, industry, sector, is_adr, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

let count = 0;
for (const s of stocks) {
  const symbol = String(s.symbol ?? "").toUpperCase();
  const name = s.name != null ? String(s.name) : "";
  const exchange = s.exchange != null ? String(s.exchange) : null;
  const industry = s.industry != null ? String(s.industry) : null;
  const sector = s.sector != null ? String(s.sector) : null;
  const isAdr = s.type === "ADRC" ? 1 : 0;
  stmt.run([symbol, name, exchange, industry, sector, isAdr, now]);
  count++;
  if (count % 500 === 0) process.stdout.write(`  ${count}/${stocks.length}...\r`);
}
stmt.free();

writeFileSync(DB_PATH, Buffer.from(db.export()));
db.close();

console.log("\nSeeded", count, "companies into screener.db");
