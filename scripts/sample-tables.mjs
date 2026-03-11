#!/usr/bin/env node
/**
 * Display the most recent 10 rows of each table in data/screener.db as a sample.
 * Run: node scripts/sample-tables.mjs  or  npm run sample-tables
 */

import initSqlJs from "sql.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "screener.db");

function formatCell(v) {
  if (v == null) return "—";
  const s = String(v);
  return s.length > 20 ? s.slice(0, 17) + "…" : s;
}

function printTable(title, columns, rows) {
  console.log("\n" + "=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
  if (!rows || rows.length === 0) {
    console.log("  (no rows)\n");
    return;
  }
  const colWidths = columns.map((c, i) =>
    Math.max(c.length, ...rows.map((r) => String(r[i] ?? "").length).concat([0]))
  );
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + (columns.length - 1) * 2;
  const maxW = 120;
  const header = columns.map((c, i) => c.padEnd(Math.min(colWidths[i], 24))).join("  ");
  console.log(header);
  console.log("-".repeat(Math.min(totalWidth, maxW)));
  for (const row of rows) {
    const line = row.map((v, i) => formatCell(v).padEnd(Math.min(colWidths[i], 24))).join("  ");
    console.log(line.slice(0, maxW));
  }
  console.log("");
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db");
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(DB_PATH));

  const tables = [
    {
      name: "companies",
      query: "SELECT symbol, name, exchange, industry, sector, updated_at FROM companies ORDER BY updated_at DESC, symbol LIMIT 10",
      cols: ["symbol", "name", "exchange", "industry", "sector", "updated_at"],
    },
    {
      name: "quote_daily",
      query: "SELECT symbol, date, market_cap, last_price, change_pct, volume FROM quote_daily ORDER BY date DESC, symbol LIMIT 10",
      cols: ["symbol", "date", "market_cap", "last_price", "change_pct", "volume"],
    },
    {
      name: "daily_bars",
      query: "SELECT symbol, date, open, high, low, close, volume FROM daily_bars ORDER BY date DESC, symbol LIMIT 10",
      cols: ["symbol", "date", "open", "high", "low", "close", "volume"],
    },
    {
      name: "financials",
      query: "SELECT symbol, period_type, period_end, eps, sales, updated_at FROM financials ORDER BY period_end DESC, symbol LIMIT 10",
      cols: ["symbol", "period_type", "period_end", "eps", "sales", "updated_at"],
    },
    {
      name: "ownership",
      query: "SELECT symbol, report_date, num_funds, institutional_pct, short_interest_pct, updated_at FROM ownership ORDER BY report_date DESC, symbol LIMIT 10",
      cols: ["symbol", "report_date", "num_funds", "institutional_pct", "short_interest_pct", "updated_at"],
    },
    {
      name: "indicators_daily",
      query: "SELECT symbol, date, price_change_1m_pct, ema_20, ema_50, industry_rank_1m, sector_rank_1m FROM indicators_daily ORDER BY date DESC, symbol LIMIT 10",
      cols: ["symbol", "date", "price_change_1m_pct", "ema_20", "ema_50", "industry_rank_1m", "sector_rank_1m"],
    },
  ];

  for (const t of tables) {
    try {
      const result = db.exec(t.query);
      const rows = result[0] ? result[0].values : [];
      const cols = result[0] ? result[0].columns : t.cols;
      printTable(`Table: ${t.name} (10 most recent rows)`, cols, rows);
    } catch (e) {
      console.log("\n" + "=".repeat(80));
      console.log(`Table: ${t.name}`);
      console.log("=".repeat(80));
      console.log("  Error:", e.message, "\n");
    }
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
