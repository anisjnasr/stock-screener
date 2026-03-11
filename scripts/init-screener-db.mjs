#!/usr/bin/env node
/**
 * Create SQLite screener database and apply schema.
 * Run: node scripts/init-screener-db.mjs  or  npm run init-screener-db
 * Creates data/screener.db and runs data/screener-schema.sql.
 * Uses sql.js (no native build required).
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");
const SCHEMA_PATH = join(DATA_DIR, "screener-schema.sql");

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

if (!existsSync(SCHEMA_PATH)) {
  console.error("Schema file not found:", SCHEMA_PATH);
  process.exit(1);
}

const schema = readFileSync(SCHEMA_PATH, "utf8");
const SQL = await initSqlJs();
const db = new SQL.Database();

try {
  db.exec(schema);
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
  console.log("Screener database initialized at", DB_PATH);
} finally {
  db.close();
}
