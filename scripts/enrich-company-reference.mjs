#!/usr/bin/env node
/**
 * Enrich companies reference fields and backfill quote_daily.market_cap.
 *
 * Populates:
 * - companies.ipo_date (from reference list_date)
 * - companies.shares_outstanding (share_class_shares_outstanding / weighted_shares_outstanding)
 *
 * Backfills:
 * - quote_daily.market_cap where missing, using shares_outstanding * price.
 *
 * Run:
 *   node scripts/enrich-company-reference.mjs
 *   node scripts/enrich-company-reference.mjs --all
 *   node scripts/enrich-company-reference.mjs --limit 1000
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB_PATH = join(root, "data", "screener.db");

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
  console.error("Missing MASSIVE_API_KEY. Set it in .env.local or environment.");
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db.");
  process.exit(1);
}

const BASE = "https://api.polygon.io";
const FORCE_ALL = process.argv.includes("--all");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? Number(process.argv[limitIdx + 1]) : null;
const CONCURRENCY = Number(process.env.COMPANY_REFERENCE_CONCURRENCY ?? 5);
const PER_REQUEST_DELAY_MS = Number(process.env.COMPANY_REFERENCE_DELAY_MS ?? 80);
const MAX_RETRIES = Number(process.env.COMPANY_REFERENCE_MAX_RETRIES ?? 3);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTickerReference(symbol) {
  const url = `${BASE}/v3/reference/tickers/${encodeURIComponent(symbol)}?apiKey=${API_KEY}`;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await sleep(Math.min(1200 * attempt, 8000));
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return data?.results ?? null;
    } catch {
      if (attempt === MAX_RETRIES) return null;
      await sleep(700 * attempt);
    }
  }
  return null;
}

async function runPool(items, worker, concurrency) {
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const current = items[idx];
      idx += 1;
      await worker(current, idx);
    }
  });
  await Promise.all(workers);
}

function getTargetSymbols(db) {
  if (FORCE_ALL) {
    const rows = db.prepare("SELECT symbol FROM companies ORDER BY symbol").all();
    return rows.map((r) => String(r.symbol));
  }
  const rows = db
    .prepare(
      `
      SELECT symbol
      FROM companies
      WHERE
        ipo_date IS NULL OR TRIM(ipo_date) = ''
        OR shares_outstanding IS NULL OR shares_outstanding <= 0
      ORDER BY symbol
      `
    )
    .all();
  return rows.map((r) => String(r.symbol));
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 10000");

  const before = {
    missingIpo: Number(
      db.prepare("SELECT COUNT(*) AS c FROM companies WHERE ipo_date IS NULL OR TRIM(ipo_date) = ''").get().c
    ),
    missingShares: Number(
      db
        .prepare("SELECT COUNT(*) AS c FROM companies WHERE shares_outstanding IS NULL OR shares_outstanding <= 0")
        .get().c
    ),
    missingMcap: Number(
      db
        .prepare("SELECT COUNT(*) AS c FROM quote_daily WHERE market_cap IS NULL OR market_cap <= 0")
        .get().c
    ),
  };

  let symbols = getTargetSymbols(db);
  if (LIMIT && LIMIT > 0) symbols = symbols.slice(0, LIMIT);
  console.log(`Enriching company reference for ${symbols.length} symbols...`);

  const updateCompany = db.prepare(
    `
    UPDATE companies
    SET
      name = COALESCE(?, name),
      exchange = COALESCE(?, exchange),
      industry = COALESCE(?, industry),
      sector = COALESCE(?, sector),
      ipo_date = COALESCE(?, ipo_date),
      shares_outstanding = COALESCE(?, shares_outstanding),
      updated_at = ?
    WHERE symbol = ?
    `
  );
  const txUpdate = db.transaction((patches) => {
    for (const p of patches) {
      updateCompany.run(
        p.name ?? null,
        p.exchange ?? null,
        p.industry ?? null,
        p.sector ?? null,
        p.ipoDate ?? null,
        p.sharesOutstanding ?? null,
        p.now,
        p.symbol
      );
    }
  });

  let processed = 0;
  let ok = 0;
  let misses = 0;
  const patchBuffer = [];
  const BATCH_SIZE = 100;
  const now = new Date().toISOString();

  await runPool(
    symbols,
    async (symbol) => {
      const r = await fetchTickerReference(symbol);
      processed += 1;
      if (!r) {
        misses += 1;
      } else {
        patchBuffer.push({
          symbol,
          name: r.name ?? null,
          exchange: r.primary_exchange ?? null,
          industry: r.sic_description ?? null,
          sector: null,
          ipoDate: r.list_date ?? null,
          sharesOutstanding:
            r.share_class_shares_outstanding != null
              ? Number(r.share_class_shares_outstanding)
              : r.weighted_shares_outstanding != null
                ? Number(r.weighted_shares_outstanding)
                : null,
          now,
        });
        ok += 1;
      }
      if (patchBuffer.length >= BATCH_SIZE) {
        txUpdate(patchBuffer.splice(0, patchBuffer.length));
      }
      if (processed % 100 === 0 || processed === symbols.length) {
        process.stdout.write(`  reference: ${processed}/${symbols.length}\r`);
      }
      if (PER_REQUEST_DELAY_MS > 0) await sleep(PER_REQUEST_DELAY_MS);
    },
    CONCURRENCY
  );
  if (patchBuffer.length > 0) txUpdate(patchBuffer);
  process.stdout.write("\n");
  console.log(`Reference enrichment done: ok=${ok}, missing_or_failed=${misses}`);

  console.log("Backfilling quote_daily.market_cap from shares_outstanding...");
  const updatedQuote = db
    .prepare(
      `
      UPDATE quote_daily
      SET market_cap = (
        SELECT c.shares_outstanding * COALESCE(
          quote_daily.last_price,
          quote_daily.prev_close,
          (
            SELECT b.close
            FROM daily_bars b
            WHERE b.symbol = quote_daily.symbol AND b.date <= quote_daily.date
            ORDER BY b.date DESC
            LIMIT 1
          )
        )
        FROM companies c
        WHERE c.symbol = quote_daily.symbol
      )
      WHERE (market_cap IS NULL OR market_cap <= 0)
        AND EXISTS (
          SELECT 1
          FROM companies c
          WHERE c.symbol = quote_daily.symbol
            AND c.shares_outstanding IS NOT NULL
            AND c.shares_outstanding > 0
        )
      `
    )
    .run().changes;
  console.log(`quote_daily rows updated with market_cap: ${updatedQuote}`);

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");

  const after = {
    missingIpo: Number(
      db.prepare("SELECT COUNT(*) AS c FROM companies WHERE ipo_date IS NULL OR TRIM(ipo_date) = ''").get().c
    ),
    missingShares: Number(
      db
        .prepare("SELECT COUNT(*) AS c FROM companies WHERE shares_outstanding IS NULL OR shares_outstanding <= 0")
        .get().c
    ),
    missingMcap: Number(
      db
        .prepare("SELECT COUNT(*) AS c FROM quote_daily WHERE market_cap IS NULL OR market_cap <= 0")
        .get().c
    ),
  };

  db.close();
  console.log("Before:", before);
  console.log("After :", after);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

