/**
 * List Market Monitor universe symbols (non-ETF with daily_bars on latest date)
 * that lack a positive market_cap on quote_daily for that same date.
 * Usage: node scripts/audit-mm-missing-market-cap.mjs [--csv]
 */
import Database from "better-sqlite3";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

const csv = process.argv.includes("--csv");
const dbPath = join(process.cwd(), "data", "screener.db");
if (!existsSync(dbPath)) {
  console.error("screener.db not found at", dbPath);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const hasIsEtf =
  db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('companies') WHERE name = 'is_etf'").get().c > 0;
const etfClause = hasIsEtf ? "AND co.is_etf = 0" : "";

const latest = db.prepare("SELECT MAX(date) AS d FROM daily_bars").get()?.d;
if (!latest) {
  console.error("No daily_bars");
  process.exit(1);
}

const rows = db
  .prepare(
    `
    WITH universe AS (
      SELECT DISTINCT d.symbol
      FROM daily_bars d
      INNER JOIN companies co ON co.symbol = d.symbol ${etfClause}
      WHERE d.date = ?
    )
    SELECT u.symbol, q.market_cap, q.last_price
    FROM universe u
    LEFT JOIN quote_daily q ON q.symbol = u.symbol AND q.date = ?
    WHERE q.market_cap IS NULL OR q.market_cap <= 0
    ORDER BY u.symbol
    `
  )
  .all(latest, latest);

const outPath = join(process.cwd(), "data", "mm-missing-market-cap.csv");
if (csv) {
  const lines = ["symbol,market_cap,last_price,as_of_date", ...rows.map((r) => `${r.symbol},${r.market_cap ?? ""},${r.last_price ?? ""},${latest}`)];
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.error(`Wrote ${rows.length} rows to ${outPath}`);
}

console.log(JSON.stringify({ asOfDate: latest, count: rows.length, symbols: rows.map((r) => r.symbol) }, null, 2));
db.close();
