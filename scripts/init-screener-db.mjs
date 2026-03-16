#!/usr/bin/env node
/**
 * Create SQLite screener database and apply schema.
 * Run: node scripts/init-screener-db.mjs  or  npm run init-screener-db
 * Creates data/screener.db and runs data/screener-schema.sql.
 * Uses better-sqlite3 (works with large on-disk DB).
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
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

// Recreate DB from schema for deterministic init.
if (existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");
db.pragma("busy_timeout = 10000");
db.exec(schema);
db.close();

console.log("Screener database initialized at", DB_PATH);
