#!/usr/bin/env node
/** Quick check: how many companies have industry/sector in screener.db */
import initSqlJs from "sql.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "screener.db");

if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db");
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(DB_PATH));

const total = db.exec("SELECT COUNT(*) FROM companies")[0].values[0][0];
const missing = db.exec(
  "SELECT COUNT(*) FROM companies WHERE (COALESCE(industry,'') = '') OR (COALESCE(sector,'') = '')"
)[0].values[0][0];
const withBoth = total - missing;

console.log("Total companies:", total);
console.log("With both industry and sector:", withBoth);
console.log("Missing industry and/or sector:", missing);

db.close();
