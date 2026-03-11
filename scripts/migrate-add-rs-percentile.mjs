#!/usr/bin/env node
/**
 * Migration: Add rs_pct_1w, rs_pct_1m, rs_pct_3m, rs_pct_6m, rs_pct_12m to indicators_daily.
 * Run: node scripts/migrate-add-rs-percentile.mjs
 * Safe to run multiple times.
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "screener.db");

if (!existsSync(DB_PATH)) {
  console.log("Screener DB not found, skipping migration.");
  process.exit(0);
}

const SQL = await initSqlJs();
const buf = readFileSync(DB_PATH);
const db = new SQL.Database(buf);

const cols = ["rs_pct_1w", "rs_pct_1m", "rs_pct_3m", "rs_pct_6m", "rs_pct_12m"];

try {
  const info = db.exec("PRAGMA table_info(indicators_daily)");
  const existing = new Set((info[0]?.values ?? []).map((r) => r[1]));

  for (const col of cols) {
    if (existing.has(col)) {
      console.log(`Column ${col} already exists.`);
    } else {
      db.run(`ALTER TABLE indicators_daily ADD COLUMN ${col} REAL`);
      console.log(`Added ${col} to indicators_daily.`);
    }
  }

  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
} finally {
  db.close();
}
