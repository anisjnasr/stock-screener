#!/usr/bin/env node
/** Check backfill status - phases 1-4 completion. Uses better-sqlite3 when DB is large (>2GB). */
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "screener.db");

const YEARS_5 = 5;
const YEARS_10 = 10;
const toDate = new Date();
const from5 = new Date(toDate);
from5.setUTCFullYear(from5.getUTCFullYear() - YEARS_5);
const from10 = new Date(toDate);
from10.setUTCFullYear(from10.getUTCFullYear() - YEARS_10);
const fromStr5 = from5.toISOString().slice(0, 10);
const fromStr10 = from10.toISOString().slice(0, 10);
const toStr = toDate.toISOString().slice(0, 10);

if (!existsSync(DB_PATH)) {
  console.log("No DB at", DB_PATH);
  process.exit(1);
}

const Database = require("better-sqlite3");
const db = new Database(DB_PATH, { readonly: true });

const total = db.prepare("SELECT COUNT(*) AS c FROM companies").get().c;
const barsRows5 = db.prepare("SELECT COUNT(*) AS c FROM daily_bars WHERE date >= ? AND date <= ?").get(fromStr5, toStr).c;
const barsRows10 = db.prepare("SELECT COUNT(*) AS c FROM daily_bars WHERE date >= ? AND date <= ?").get(fromStr10, toStr).c;
const barsSyms5 = db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM daily_bars WHERE date >= ? AND date <= ?").get(fromStr5, toStr).c;
const barsSyms10 = db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM daily_bars WHERE date >= ? AND date <= ?").get(fromStr10, toStr).c;
const finSyms = db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM financials").get().c;
const sharesSyms = db.prepare("SELECT COUNT(*) AS c FROM companies WHERE shares_outstanding IS NOT NULL").get().c;
const quoteRows5 = db.prepare("SELECT COUNT(*) AS c FROM quote_daily WHERE date >= ? AND date <= ?").get(fromStr5, toStr).c;
const quoteRows10 = db.prepare("SELECT COUNT(*) AS c FROM quote_daily WHERE date >= ? AND date <= ?").get(fromStr10, toStr).c;

console.log("Backfill status:");
console.log("  5-year range: daily_bars", barsSyms5, "/", total, "symbols |", barsRows5, "rows | quote_daily", quoteRows5, "rows");
console.log("  10-year range: daily_bars", barsSyms10, "/", total, "symbols |", barsRows10, "rows | quote_daily", quoteRows10, "rows");
console.log("  financials:  ", finSyms, "/", total, "symbols");
console.log("  companies:   ", sharesSyms, "/", total, "symbols (shares_outstanding)");
console.log("");
console.log("Data saved:", barsRows5 > 0 || finSyms > 0 || sharesSyms > 0 ? "Yes" : "No");

db.close();
