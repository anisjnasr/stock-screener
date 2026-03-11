#!/usr/bin/env node
/**
 * Extend existing 5-year backfill to full 10 years: fetch the older 5 years of daily_bars
 * from Polygon (Massive), backfill quote_daily for the full 10-year range, then run
 * compute-indicators for 10 years.
 *
 * Uses better-sqlite3 (opens DB on disk) so it works when screener.db is larger than 2GB.
 * Requires: npm install better-sqlite3 (or use devDependencies).
 *
 * Prerequisites: You already have 5 years of data (daily_bars, quote_daily, indicators_daily).
 *
 * Run: node scripts/backfill-extend-to-10y.mjs [--limit N]
 *
 * Requires: MASSIVE_API_KEY, data/screener.db with companies seeded.
 */

import { createRequire } from "module";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");

function loadEnvLocal() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  const content = readFileSync(p, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
loadEnvLocal();

const API_KEY = process.env.MASSIVE_API_KEY;
if (!API_KEY) {
  console.error("Missing MASSIVE_API_KEY. Set it in .env.local or the environment.");
  process.exit(1);
}

const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : null;

const BASE = "https://api.polygon.io";
function url(path, params = {}) {
  const search = new URLSearchParams({ ...params, apiKey: API_KEY });
  return `${BASE}${path}?${search}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchDailyBars(symbol, from, to) {
  const res = await fetch(
    url(`/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}`, {
      adjusted: "true",
      sort: "asc",
      limit: "50000",
    })
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results = data.results ?? [];
  return results.map((b) => ({
    date: new Date(b.t).toISOString().slice(0, 10),
    open: b.o ?? 0,
    high: b.h ?? 0,
    low: b.l ?? 0,
    close: b.c ?? 0,
    volume: b.v ?? 0,
  }));
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  console.log("Opening DB (on-disk, better-sqlite3)...");
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = OFF");

  let symbols = db.prepare("SELECT symbol FROM companies ORDER BY symbol").all().map((r) => r.symbol);
  if (!symbols.length) {
    console.error("No symbols in companies. Run seed-companies first.");
    db.close();
    process.exit(1);
  }
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }

  const toDate = new Date();
  const fromDateFull = new Date(toDate);
  fromDateFull.setUTCFullYear(fromDateFull.getUTCFullYear() - 10);
  const toDateExtension = new Date(toDate);
  toDateExtension.setUTCFullYear(toDateExtension.getUTCFullYear() - 5);

  const fromStr = fromDateFull.toISOString().slice(0, 10);
  const toStrExtension = toDateExtension.toISOString().slice(0, 10);
  const toStrFull = toDate.toISOString().slice(0, 10);

  console.log("Extending history: fetch daily_bars from", fromStr, "to", toStrExtension, "(older 5 years).");
  console.log("Then backfill quote_daily and run indicators for full 10 years.\n");

  const insertBar = db.prepare(
    "INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  console.log("1. Fetching SPY for extension range...");
  const spyBars = await fetchDailyBars("SPY", fromStr, toStrExtension);
  const insertMany = db.transaction((bars, sym) => {
    for (const b of bars) {
      insertBar.run(sym, b.date, b.open, b.high, b.low, b.close, b.volume);
    }
  });
  insertMany(spyBars, "SPY");
  await sleep(120);
  console.log("   SPY:", spyBars.length, "bars.");

  console.log("\n2. Backfilling daily_bars (older 5 years) for each symbol...");
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const bars = await fetchDailyBars(sym, fromStr, toStrExtension);
      insertMany(bars, sym);
    } catch (e) {
      console.warn("  ", sym, e.message);
    }
    if ((i + 1) % 50 === 0 || i === symbols.length - 1) {
      process.stdout.write("  daily_bars: " + (i + 1) + "/" + symbols.length + "\r");
    }
    await sleep(120);
  }
  console.log("\n  daily_bars extension done.");

  console.log("\n3. Backfilling quote_daily for full 10-year range...");
  const placeholders = symbols.map(() => "?").join(",");
  const bars = db
    .prepare(
      "SELECT symbol, date, close, volume FROM daily_bars WHERE date >= ? AND date <= ? AND symbol IN (" +
        placeholders +
        ") ORDER BY symbol, date"
    )
    .all(fromStr, toStrFull, ...symbols);

  const getShares = db.prepare("SELECT shares_outstanding FROM companies WHERE symbol = ?");
  const upsertQuote = db.prepare(`
    INSERT OR REPLACE INTO quote_daily (symbol, date, market_cap, last_price, change_pct, volume, avg_volume_30d_shares, high_52w, off_52w_high_pct, atr_pct_21d, free_float)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const fillQuotes = db.transaction((rows) => {
    for (const b of rows) {
      const row = getShares.get(b.symbol);
      const shares = row?.shares_outstanding != null ? Number(row.shares_outstanding) : null;
      const marketCap = shares != null && b.close != null ? b.close * shares : null;
      upsertQuote.run(
        b.symbol,
        b.date,
        marketCap,
        b.close,
        null,
        b.volume,
        null,
        null,
        null,
        null,
        null
      );
    }
  });
  fillQuotes(bars);
  console.log("  quote_daily: " + bars.length + " rows.");

  console.log("\n4. Updating statistics (ANALYZE)...");
  db.exec("ANALYZE");

  db.close();
  console.log("\n5. Running compute-indicators --years 10...");
  const scriptPath = join(root, "scripts", "compute-indicators-from-bars.mjs");
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--years", "10", ...(LIMIT != null ? ["--limit", String(LIMIT)] : [])],
    { stdio: "inherit", cwd: root, env: { ...process.env, NODE_OPTIONS: "" } }
  );
  if (result.status !== 0) {
    console.error("compute-indicators exited with", result.status);
    process.exit(result.status ?? 1);
  }

  console.log("\nBackfill extend to 10 years complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
