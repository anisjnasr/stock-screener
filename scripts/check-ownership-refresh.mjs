#!/usr/bin/env node
/**
 * Ownership refresh sanity checks:
 * - verifies latest quarter coverage by symbol count
 * - prints key-symbol quarter-over-quarter fund counts
 * - checks quarter ordering monotonicity per symbol
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");
const KEY_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA"];

if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db");
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
try {
  const latestRow = db.prepare("SELECT MAX(report_date) AS d FROM ownership").get();
  const latestDate = latestRow?.d ? String(latestRow.d) : null;
  if (!latestDate) {
    console.error("No ownership rows found.");
    process.exit(1);
  }

  const latestCoverage = Number(
    db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM ownership WHERE report_date = ?").get(latestDate)?.c ?? 0
  );
  console.log(`Latest ownership quarter: ${latestDate} | symbols: ${latestCoverage.toLocaleString()}`);

  const rows = db
    .prepare(
      `
      SELECT symbol, report_date, num_funds, num_funds_change
      FROM ownership
      WHERE symbol IN (${KEY_SYMBOLS.map(() => "?").join(",")})
      ORDER BY symbol ASC, report_date DESC
      `
    )
    .all(...KEY_SYMBOLS);

  console.log("\nKey symbol snapshots:");
  for (const s of KEY_SYMBOLS) {
    const one = rows.filter((r) => String(r.symbol) === s).slice(0, 8);
    console.log(`- ${s}`);
    if (one.length === 0) {
      console.log("  (no rows)");
      continue;
    }
    let prevDate = "9999-99-99";
    for (const r of one) {
      const date = String(r.report_date);
      if (date > prevDate) {
        console.warn(`  WARN order mismatch at ${date}`);
      }
      prevDate = date;
      const n = r.num_funds != null ? Number(r.num_funds).toLocaleString() : "NA";
      const c = r.num_funds_change != null ? Number(r.num_funds_change).toLocaleString() : "NA";
      console.log(`  ${date}  funds=${n}  chg=${c}`);
    }
  }

  const missingChange = Number(
    db.prepare(
      `
      SELECT COUNT(*) AS c
      FROM ownership o
      WHERE o.report_date = ?
        AND o.num_funds IS NOT NULL
        AND o.num_funds_change IS NULL
      `
    ).get(latestDate)?.c ?? 0
  );
  console.log(`\nLatest quarter null Funds Chg rows: ${missingChange.toLocaleString()}`);
} finally {
  db.close();
}

