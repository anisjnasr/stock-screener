#!/usr/bin/env node
import initSqlJs from "sql.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dbPath = join(root, "data", "screener.db");
const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(dbPath));
const r = db.exec(
  "SELECT symbol, report_date, num_funds, num_funds_change FROM ownership WHERE symbol IN ('NVDA','MSFT','AAPL','TSLA') ORDER BY report_date DESC, symbol"
);
const rows = r[0] ? r[0].values : [];
console.log("Ownership rows for NVDA, MSFT, AAPL, TSLA (latest first):\n");
for (const row of rows) {
  console.log(row[0], row[1], "| num_funds:", row[2], "| change:", row[3]);
}
db.close();
