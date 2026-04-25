#!/usr/bin/env node
/**
 * Backfill companies.ipo_date from Massive/Polygon ticker details.
 *
 * The bulk /v3/reference/tickers endpoint does not include list_date, so this
 * uses per-ticker /v3/reference/tickers/{ticker} and updates only ipo_date.
 *
 * Usage:
 *   node scripts/backfill-ipo-dates-massive.mjs
 *   node scripts/backfill-ipo-dates-massive.mjs --limit 500
 *   node scripts/backfill-ipo-dates-massive.mjs --all
 *   node scripts/backfill-ipo-dates-massive.mjs --dry-run
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");
const BASE = "https://api.polygon.io";

function loadEnvLocal() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
}

loadEnvLocal();

const API_KEY = process.env.MASSIVE_API_KEY;
if (!API_KEY) {
  console.error("Missing MASSIVE_API_KEY. Set it in .env.local or environment.");
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db.");
  process.exit(1);
}

const FORCE_ALL = process.argv.includes("--all");
const DRY_RUN = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? Number(process.argv[limitIdx + 1]) : null;
const CONCURRENCY = Number(process.env.IPO_BACKFILL_CONCURRENCY ?? 5);
const PER_REQUEST_DELAY_MS = Number(process.env.IPO_BACKFILL_DELAY_MS ?? 80);
const MAX_RETRIES = Number(process.env.IPO_BACKFILL_MAX_RETRIES ?? 3);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTickerDetails(symbol) {
  const url = `${BASE}/v3/reference/tickers/${encodeURIComponent(symbol)}?apiKey=${API_KEY}`;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        await sleep(Math.min(1200 * attempt, 8000));
        continue;
      }
      if (response.status === 404) return { found: false, listDate: null };
      if (!response.ok) return { found: false, listDate: null };
      const json = await response.json();
      const listDate = json?.results?.list_date;
      return {
        found: true,
        listDate: typeof listDate === "string" && listDate.trim() ? listDate.slice(0, 10) : null,
      };
    } catch {
      if (attempt === MAX_RETRIES) return { found: false, listDate: null };
      await sleep(700 * attempt);
    }
  }
  return { found: false, listDate: null };
}

async function runPool(items, worker, concurrency) {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current, index);
    }
  });
  await Promise.all(workers);
}

function getTargetSymbols(db) {
  const where = FORCE_ALL ? "" : "WHERE ipo_date IS NULL OR TRIM(ipo_date) = ''";
  const rows = db.prepare(`SELECT symbol FROM companies ${where} ORDER BY symbol`).all();
  return rows.map((row) => String(row.symbol));
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");

  const beforeMissing = Number(
    db.prepare("SELECT COUNT(*) AS c FROM companies WHERE ipo_date IS NULL OR TRIM(ipo_date) = ''").get().c
  );

  let symbols = getTargetSymbols(db);
  if (LIMIT && LIMIT > 0) symbols = symbols.slice(0, LIMIT);
  console.log(
    `Backfilling IPO dates for ${symbols.length} symbol(s)... dryRun=${DRY_RUN ? "yes" : "no"} all=${FORCE_ALL ? "yes" : "no"}`
  );

  const updateIpoDate = db.prepare(
    "UPDATE companies SET ipo_date = ?, updated_at = ? WHERE symbol = ? AND (ipo_date IS NULL OR TRIM(ipo_date) = '' OR ? = 1)"
  );
  const txUpdate = db.transaction((patches) => {
    for (const patch of patches) {
      updateIpoDate.run(patch.listDate, patch.now, patch.symbol, FORCE_ALL ? 1 : 0);
    }
  });

  let processed = 0;
  let found = 0;
  let withListDate = 0;
  let noListDate = 0;
  let notFound = 0;
  let updated = 0;
  const patches = [];
  const now = new Date().toISOString();
  const BATCH_SIZE = 100;

  await runPool(
    symbols,
    async (symbol) => {
      const result = await fetchTickerDetails(symbol);
      processed += 1;
      if (!result.found) {
        notFound += 1;
      } else {
        found += 1;
        if (result.listDate) {
          withListDate += 1;
          patches.push({ symbol, listDate: result.listDate, now });
        } else {
          noListDate += 1;
        }
      }
      if (!DRY_RUN && patches.length >= BATCH_SIZE) {
        updated += patches.length;
        txUpdate(patches.splice(0, patches.length));
      }
      if (processed % 100 === 0 || processed === symbols.length) {
        process.stdout.write(`  IPO reference: ${processed}/${symbols.length}\r`);
      }
      if (PER_REQUEST_DELAY_MS > 0) await sleep(PER_REQUEST_DELAY_MS);
    },
    CONCURRENCY
  );

  if (!DRY_RUN && patches.length > 0) {
    updated += patches.length;
    txUpdate(patches.splice(0, patches.length));
  }
  process.stdout.write("\n");

  const afterMissing = Number(
    db.prepare("SELECT COUNT(*) AS c FROM companies WHERE ipo_date IS NULL OR TRIM(ipo_date) = ''").get().c
  );
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  db.close();

  console.log("Before missing IPO:", beforeMissing);
  console.log("After missing IPO :", afterMissing);
  console.log("Processed:", processed);
  console.log("Found:", found);
  console.log("With list_date:", withListDate);
  console.log("No list_date:", noListDate);
  console.log("Not found/errors:", notFound);
  console.log("Rows queued for update:", DRY_RUN ? 0 : updated);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
