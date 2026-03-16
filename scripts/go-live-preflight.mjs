#!/usr/bin/env node
/**
 * Production go-live preflight checks.
 *
 * Validates:
 * - MASSIVE_API_KEY presence (optional hard-fail with --require-api-key)
 * - data/screener.db exists and opens in readonly mode
 * - required tables and indexes exist
 * - key row counts are non-zero
 * - latest market dates are recent enough
 * - refresh scripts are safe for >2GB DBs (no sql.js full-file loads)
 *
 * Run:
 *   node scripts/go-live-preflight.mjs
 *   node scripts/go-live-preflight.mjs --require-api-key --max-stale-days 5
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");

const args = process.argv.slice(2);
const requireApiKey = args.includes("--require-api-key");
const deepIntegrity = args.includes("--deep-integrity-check");
const staleIdx = args.indexOf("--max-stale-days");
const maxStaleDays =
  staleIdx >= 0 && args[staleIdx + 1] ? Math.max(1, Number.parseInt(args[staleIdx + 1], 10) || 5) : 5;

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
loadEnvLocal();

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

function daysOld(dateStr) {
  const then = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}

function checkRefreshScriptSafety() {
  const files = [
    "scripts/refresh-daily.mjs",
    "scripts/refresh-financials.mjs",
    "scripts/refresh-ownership.mjs",
    "scripts/seed-companies.mjs",
  ];
  for (const rel of files) {
    const full = join(root, rel);
    if (!existsSync(full)) {
      fail(`Missing required script: ${rel}`);
      continue;
    }
    const content = readFileSync(full, "utf8");
    if (content.includes("initSqlJs")) {
      fail(`${rel} still uses sql.js (not safe for >2GB DB).`);
    }
    if (content.includes("readFileSync(DB_PATH)") || content.includes("new SQL.Database(")) {
      fail(`${rel} appears to load entire DB into memory.`);
    }
  }
}

function main() {
  console.log("=== Go-Live Preflight ===");

  const hasApiKey = Boolean(process.env.MASSIVE_API_KEY);
  if (!hasApiKey && requireApiKey) fail("MASSIVE_API_KEY is missing.");
  if (!hasApiKey && !requireApiKey) warn("MASSIVE_API_KEY is missing (required for refresh jobs).");

  if (!existsSync(DB_PATH)) {
    fail(`Database file missing: ${DB_PATH}`);
  } else {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const requiredTables = ["companies", "daily_bars", "quote_daily", "indicators_daily", "financials", "ownership"];
      const existingTables = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name))
      );
      for (const t of requiredTables) {
        if (!existingTables.has(t)) fail(`Missing required table: ${t}`);
      }

      const requiredIndexes = [
        "idx_daily_bars_symbol_date",
        "idx_daily_bars_date",
        "idx_quote_daily_date_symbol",
        "idx_indicators_daily_date_symbol",
        "idx_financials_symbol",
        "idx_ownership_symbol",
      ];
      const existingIndexes = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => String(r.name))
      );
      for (const idx of requiredIndexes) {
        if (!existingIndexes.has(idx)) fail(`Missing required index: ${idx}`);
      }

      const counts = {
        companies: db.prepare("SELECT COUNT(*) AS c FROM companies").get().c,
        daily_bars: db.prepare("SELECT COUNT(*) AS c FROM daily_bars").get().c,
        quote_daily: db.prepare("SELECT COUNT(*) AS c FROM quote_daily").get().c,
        indicators_daily: db.prepare("SELECT COUNT(*) AS c FROM indicators_daily").get().c,
        financials: db.prepare("SELECT COUNT(*) AS c FROM financials").get().c,
      };
      if (counts.companies <= 0) fail("companies table is empty.");
      if (counts.daily_bars <= 0) fail("daily_bars table is empty.");
      if (counts.quote_daily <= 0) fail("quote_daily table is empty.");
      if (counts.indicators_daily <= 0) fail("indicators_daily table is empty.");

      const latest = {
        bars: db.prepare("SELECT MAX(date) AS d FROM daily_bars").get().d,
        quote: db.prepare("SELECT MAX(date) AS d FROM quote_daily").get().d,
        indicators: db.prepare("SELECT MAX(date) AS d FROM indicators_daily").get().d,
      };
      for (const [k, d] of Object.entries(latest)) {
        if (!d) fail(`No latest date found for ${k}.`);
        else {
          const age = daysOld(String(d));
          if (age > maxStaleDays) {
            fail(`${k} is stale by ${age} days (latest=${d}, max=${maxStaleDays}).`);
          }
        }
      }

      if (deepIntegrity) {
        const integrity = db.pragma("quick_check");
        if (!integrity || integrity[0]?.quick_check !== "ok") {
          fail("SQLite integrity quick_check failed.");
        }
      }

      console.log("DB stats:");
      console.log(`  companies:   ${counts.companies.toLocaleString()}`);
      console.log(`  daily_bars:  ${counts.daily_bars.toLocaleString()}`);
      console.log(`  quote_daily: ${counts.quote_daily.toLocaleString()}`);
      console.log(`  indicators:  ${counts.indicators_daily.toLocaleString()}`);
      console.log(`  financials:  ${counts.financials.toLocaleString()}`);
      console.log(`  latest bars: ${latest.bars}`);
    } finally {
      db.close();
    }
  }

  checkRefreshScriptSafety();

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    console.log(`\nPreflight failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
    process.exit(1);
  }

  console.log("\nPreflight passed. Ready for go-live.");
}

main();
