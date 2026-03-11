#!/usr/bin/env node
/**
 * Migration: Add is_etf column to companies table if it doesn't exist.
 * Run: node scripts/migrate-add-is-etf.mjs
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

try {
  const info = db.exec("PRAGMA table_info(companies)");
  const columns = info[0]?.values?.map((r) => r[1]) ?? [];
  if (columns.includes("is_etf")) {
    console.log("Column is_etf already exists.");
  } else {
    db.run("ALTER TABLE companies ADD COLUMN is_etf INTEGER NOT NULL DEFAULT 0");
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
    console.log("Added is_etf column to companies.");
  }
} finally {
  db.close();
}
