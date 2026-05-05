#!/usr/bin/env node
/**
 * Refresh quote_daily.free_float for the latest quote date using Yahoo Finance.
 *
 * Strategy:
 * - Keep existing latest-date values when present.
 * - Carry forward the most recent historical free_float when available.
 * - Query Yahoo (yfinance) only for symbols still missing float.
 *
 * Run: node scripts/refresh-free-float-yfinance.mjs
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

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

const MAX_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.FREE_FLOAT_YF_CONCURRENCY ?? 5)));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.FREE_FLOAT_YF_DELAY_MS ?? 60));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPositiveNumber(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (v && typeof v === "object") {
    if (typeof v.raw === "number" && Number.isFinite(v.raw) && v.raw > 0) return v.raw;
    if (typeof v.longFmt === "string") {
      const n = Number(String(v.longFmt).replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function extractFloatShares(summary) {
  const dks = summary?.defaultKeyStatistics ?? {};
  const sd = summary?.summaryDetail ?? {};
  return (
    toPositiveNumber(dks.floatShares) ??
    toPositiveNumber(sd.floatShares) ??
    toPositiveNumber(dks.sharesFloat) ??
    null
  );
}

async function fetchYahooFloat(yf, symbol) {
  try {
    const summary = await yf.quoteSummary(symbol, {
      modules: ["defaultKeyStatistics", "summaryDetail"],
    });
    return extractFloatShares(summary);
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Missing screener DB at ${DB_PATH}`);
    process.exit(1);
  }

  const YahooFinance = (await import("yahoo-finance2")).default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");

  const latestRow = db.prepare("SELECT MAX(date) AS d FROM quote_daily").get();
  const latestDate = latestRow?.d ? String(latestRow.d) : null;
  if (!latestDate) {
    console.log("No quote_daily rows found; skipping free-float refresh.");
    db.close();
    return;
  }

  const quoteCols = new Set(db.prepare("PRAGMA table_info(quote_daily)").all().map((r) => r.name));
  if (!quoteCols.has("free_float")) {
    db.exec("ALTER TABLE quote_daily ADD COLUMN free_float REAL");
    console.log("Added free_float column to quote_daily.");
  }

  const latestRows = db
    .prepare("SELECT symbol, free_float FROM quote_daily WHERE date = ? ORDER BY symbol")
    .all(latestDate)
    .map((r) => ({
      symbol: String(r.symbol).toUpperCase(),
      freeFloat: typeof r.free_float === "number" && Number.isFinite(r.free_float) && r.free_float > 0 ? Number(r.free_float) : null,
    }));

  if (latestRows.length === 0) {
    console.log(`No symbols found for latest quote date ${latestDate}; skipping.`);
    db.close();
    return;
  }

  const historicalRows = db
    .prepare(
      `
      SELECT q.symbol, q.free_float
      FROM quote_daily q
      INNER JOIN (
        SELECT symbol, MAX(date) AS max_date
        FROM quote_daily
        WHERE free_float IS NOT NULL AND free_float > 0
        GROUP BY symbol
      ) h ON h.symbol = q.symbol AND h.max_date = q.date
      `
    )
    .all();
  const historicalMap = new Map(
    historicalRows.map((r) => [String(r.symbol).toUpperCase(), Number(r.free_float)])
  );

  const resolvedMap = new Map();
  const toFetch = [];
  let kept = 0;
  let carried = 0;

  for (const row of latestRows) {
    if (row.freeFloat != null) {
      resolvedMap.set(row.symbol, row.freeFloat);
      kept++;
      continue;
    }
    const carry = historicalMap.get(row.symbol);
    if (typeof carry === "number" && Number.isFinite(carry) && carry > 0) {
      resolvedMap.set(row.symbol, carry);
      carried++;
      continue;
    }
    toFetch.push(row.symbol);
  }

  console.log(
    `Free float refresh on ${latestDate}: total=${latestRows.length}, keep=${kept}, carry=${carried}, fetch=${toFetch.length}`
  );

  let fetchedOk = 0;
  let fetchedMiss = 0;
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= toFetch.length) return;
      const symbol = toFetch[idx];
      const v = await fetchYahooFloat(yf, symbol);
      if (v != null) {
        resolvedMap.set(symbol, v);
        fetchedOk++;
      } else {
        fetchedMiss++;
      }
      if ((idx + 1) % 50 === 0 || idx + 1 === toFetch.length) {
        process.stdout.write(`  yfinance float: ${idx + 1}/${toFetch.length}\r`);
      }
      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, toFetch.length)) }, () => worker()));
  if (toFetch.length > 0) process.stdout.write("\n");

  const updateStmt = db.prepare("UPDATE quote_daily SET free_float = ? WHERE symbol = ? AND date = ?");
  const updateTx = db.transaction((entries) => {
    for (const [symbol, value] of entries) {
      updateStmt.run(value, symbol, latestDate);
    }
  });

  const entries = Array.from(resolvedMap.entries());
  const BATCH = 500;
  for (let i = 0; i < entries.length; i += BATCH) {
    updateTx(entries.slice(i, i + BATCH));
  }

  const updatedCountRow = db
    .prepare("SELECT COUNT(*) AS c FROM quote_daily WHERE date = ? AND free_float IS NOT NULL AND free_float > 0")
    .get(latestDate);
  const updatedCount = Number(updatedCountRow?.c ?? 0);

  db.close();
  console.log(
    `Free float complete: yfinance_ok=${fetchedOk}, yfinance_missing=${fetchedMiss}, updated_on_latest_date=${updatedCount}/${latestRows.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
