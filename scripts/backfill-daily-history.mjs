#!/usr/bin/env node
/**
 * One-time (or occasional) backfill: fetch the maximum available daily OHLCV
 * history for all screener symbols and store it in daily_bars.
 *
 * Run: node scripts/backfill-daily-history.mjs [--limit N]
 *  or: npm run backfill-daily-history
 *
 * This script only populates the daily_bars table; quote_daily and
 * indicators_daily will continue to be updated by refresh-daily.mjs, which
 * uses whatever history is present in daily_bars to compute indicators.
 */

import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");

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

async function fetchDailyBars(symbol, from, to) {
  const res = await fetch(
    url(`/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}`, {
      adjusted: "true",
      sort: "asc",
      // 5k bars per request; with a ~50+ year range this is well within limits.
      limit: "5000",
    })
  );
  if (!res.ok) {
    console.warn(`  ${symbol}: HTTP ${res.status} from Polygon, skipping`);
    return [];
  }
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const buf = readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const symbolRows = db.exec("SELECT symbol FROM companies ORDER BY symbol");
  let symbols = symbolRows.length && symbolRows[0].values ? symbolRows[0].values.map((r) => r[0]) : [];
  if (!symbols.length) {
    console.error("No symbols found in companies table; run seed-companies first.");
    process.exit(1);
  }
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }

  // Use an early from-date within Polygon's supported range.
  // Polygon generally supports history back to the 1970s; asking earlier
  // can result in HTTP 400 responses.
  const fromStr = "1970-01-01";
  const toDate = new Date();
  const toStr = toDate.toISOString().slice(0, 10);

  const insertBar = db.prepare(
    "INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  console.log(`Backfilling daily_bars from ${fromStr} to ${toStr} for ${symbols.length} symbols...`);

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const bars = await fetchDailyBars(sym, fromStr, toStr);
      if (!bars.length) {
        console.log(`  ${sym}: no bars returned`);
      } else {
        for (const b of bars) {
          insertBar.bind([sym, b.date, b.open, b.high, b.low, b.close, b.volume]);
          insertBar.step();
          insertBar.reset();
        }
      }
    } catch (e) {
      console.warn(`  ${sym}: error during fetch/backfill:`, e instanceof Error ? e.message : e);
    }
    if ((i + 1) % 25 === 0 || i === symbols.length - 1) {
      process.stdout.write(`  symbols processed: ${i + 1}/${symbols.length}\r`);
    }
    // Small delay to be gentle on the API.
    await sleep(150);
  }

  insertBar.free();

  writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log("\nBackfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

