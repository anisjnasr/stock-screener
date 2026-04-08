#!/usr/bin/env node
/**
 * Generate stock counts by sector and industry (non-ETF universe).
 * Outputs CSV reports under data/reports/.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

if (!existsSync(DB_PATH)) {
  console.error(`Missing DB at ${DB_PATH}`);
  process.exit(1);
}

const reportsDir = join(root, "data", "reports");
mkdirSync(reportsDir, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const header = "name,count";
  const lines = rows.map((r) => `${csvEscape(r.name)},${r.count}`);
  return [header, ...lines].join("\n") + "\n";
}

try {
  const sectors = db
    .prepare(
      "SELECT COALESCE(NULLIF(TRIM(sector), ''), '(Unclassified)') AS name, COUNT(*) AS count FROM companies WHERE COALESCE(is_etf,0)=0 GROUP BY 1 ORDER BY count DESC, name"
    )
    .all();

  const industries = db
    .prepare(
      "SELECT COALESCE(NULLIF(TRIM(industry), ''), '(Unclassified)') AS name, COUNT(*) AS count FROM companies WHERE COALESCE(is_etf,0)=0 GROUP BY 1 ORDER BY count DESC, name"
    )
    .all();

  const sectorsPath = join(reportsDir, "stock-count-by-sector.csv");
  const industriesPath = join(reportsDir, "stock-count-by-industry.csv");
  writeFileSync(sectorsPath, toCsv(sectors), "utf8");
  writeFileSync(industriesPath, toCsv(industries), "utf8");

  console.log(
    JSON.stringify(
      {
        sectors_count: sectors.length,
        industries_count: industries.length,
        sectors_csv: sectorsPath,
        industries_csv: industriesPath,
        top_sectors: sectors.slice(0, 15),
        top_industries: industries.slice(0, 20),
      },
      null,
      2
    )
  );
} finally {
  db.close();
}

