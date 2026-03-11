#!/usr/bin/env node
/**
 * Backfill 10 years of historical data from Polygon (Massive): companies, daily_bars,
 * financials, and market cap (quote_daily) for all symbols in companies table.
 *
 * Run: node scripts/backfill-historical-massive.mjs [--years 10] [--limit N] [--resume]
 *   --years N   Backfill N years (default 10)
 *   --limit N   Only process first N symbols (for testing)
 *   --resume    Skip symbols already completed in each phase (persists after each phase)
 *
 * Requires: MASSIVE_API_KEY, data/screener.db with companies seeded.
 */

import initSqlJs from "sql.js";
import { readFileSync, existsSync, openSync, writeSync, closeSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/** Write sql.js DB to file in chunks to avoid Buffer size limit (~2.15 GB). */
function writeDatabaseChunked(db, filePath) {
  const data = db.export();
  const chunkSize = 256 * 1024 * 1024; // 256 MB
  const fd = openSync(filePath, "w");
  const totalMB = (data.length / (1024 * 1024)).toFixed(1);
  try {
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, data.length);
      const chunk = data.subarray(offset, end);
      writeSync(fd, chunk, 0, chunk.length);
      const writtenMB = (end / (1024 * 1024)).toFixed(1);
      process.stdout.write("  " + writtenMB + " / " + totalMB + " MB\r");
    }
  } finally {
    closeSync(fd);
  }
  console.log("");
}

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

const yearsIdx = process.argv.indexOf("--years");
const YEARS = yearsIdx >= 0 && process.argv[yearsIdx + 1] ? parseInt(process.argv[yearsIdx + 1], 10) : 10;
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : null;
const RESUME = process.argv.includes("--resume");

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

async function fetchProfile(symbol) {
  const res = await fetch(url(`/v3/reference/tickers/${symbol}`));
  if (!res.ok) return null;
  const data = await res.json();
  const r = data.results;
  if (!r) return null;
  return {
    name: r.name ?? null,
    primary_exchange: r.primary_exchange ?? null,
    market_cap: r.market_cap ?? null,
    share_class_shares_outstanding: r.share_class_shares_outstanding ?? null,
    weighted_shares_outstanding: r.weighted_shares_outstanding ?? null,
  };
}

async function fetchIncomeStatement(symbol, timeframe) {
  const res = await fetch(
    url("/stocks/financials/v1/income-statements", {
      tickers: symbol,
      "timeframe.any_of": timeframe,
      limit: "50",
      sort: "period_end.desc",
    })
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results = data.results ?? [];
  return results.map((row) => ({
    period_end: row.period_end ?? "",
    revenue: row.revenue,
    net_income: row.consolidated_net_income_loss,
    eps: row.diluted_earnings_per_share ?? row.basic_earnings_per_share,
  }));
}

function computeGrowth(current, prior) {
  if (prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function ensureSharesOutstandingColumn(db) {
  try {
    const info = db.exec("PRAGMA table_info(companies)");
    const cols = info[0]?.values?.map((r) => r[1]) ?? [];
    if (cols.includes("shares_outstanding")) return;
    db.run("ALTER TABLE companies ADD COLUMN shares_outstanding REAL");
  } catch (_) {}
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const buf = readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  ensureSharesOutstandingColumn(db);

  const symbolRows = db.exec("SELECT symbol FROM companies ORDER BY symbol");
  let symbols = symbolRows.length && symbolRows[0].values ? symbolRows[0].values.map((r) => r[0]) : [];
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
  const fromDate = new Date(toDate);
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - YEARS);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  let symbolsToProcess = [...symbols];
  if (RESUME) {
    console.log("--resume: skipping already-completed symbols per phase.");
    const doneBars = db.exec(
      "SELECT DISTINCT symbol FROM daily_bars WHERE date >= '" + fromStr + "' AND date <= '" + toStr + "'"
    );
    const doneBarSet = new Set((doneBars[0]?.values ?? []).map((r) => r[0]));
    symbolsToProcess = symbolsToProcess.filter((s) => !doneBarSet.has(s));
    if (doneBarSet.size > 0) {
      console.log("  daily_bars: " + doneBarSet.size + " symbols already done, " + symbolsToProcess.length + " remaining.");
    }
  }

  console.log("\n1. Backfilling daily_bars (" + fromStr + " to " + toStr + ")...");
  const insertBar = db.prepare(
    "INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < symbolsToProcess.length; i++) {
    const sym = symbolsToProcess[i];
    try {
      const bars = await fetchDailyBars(sym, fromStr, toStr);
      for (const b of bars) {
        insertBar.bind([sym, b.date, b.open, b.high, b.low, b.close, b.volume]);
        insertBar.step();
        insertBar.reset();
      }
    } catch (e) {
      console.warn("  ", sym, e.message);
    }
    if ((i + 1) % 50 === 0 || i === symbolsToProcess.length - 1) {
      process.stdout.write("  daily_bars: " + (i + 1) + "/" + symbolsToProcess.length + "\r");
    }
    await sleep(120);
  }
  insertBar.free();
  console.log("\n  daily_bars done.");
  if (RESUME) {
    console.log("  Persisting DB...");
    writeDatabaseChunked(db, DB_PATH);
  }

  if (RESUME) {
    const doneFin = db.exec("SELECT DISTINCT symbol FROM financials");
    const doneFinSet = new Set((doneFin[0]?.values ?? []).map((r) => r[0]));
    symbolsToProcess = symbols.filter((s) => !doneFinSet.has(s));
    if (doneFinSet.size > 0) {
      console.log("  financials: " + doneFinSet.size + " symbols already done, " + symbolsToProcess.length + " remaining.");
    }
  }

  console.log("\n2. Backfilling financials (quarterly + annual)...");
  const now = new Date().toISOString();
  const upsertFin = db.prepare(`
    INSERT OR REPLACE INTO financials (symbol, period_type, period_end, eps, eps_growth_yoy, sales, sales_growth_yoy, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const cutoffDate = new Date(toDate);
  cutoffDate.setUTCFullYear(cutoffDate.getUTCFullYear() - YEARS);
  const financialsCutoff = cutoffDate.toISOString().slice(0, 10);

  for (let i = 0; i < symbolsToProcess.length; i++) {
    const sym = symbolsToProcess[i];
    try {
      const [annual, quarterly] = await Promise.all([
        fetchIncomeStatement(sym, "annual"),
        fetchIncomeStatement(sym, "quarterly"),
      ]);
      for (let j = 0; j < annual.length; j++) {
        const row = annual[j];
        if (row.period_end < financialsCutoff) continue;
        const prev = annual[j + 1];
        upsertFin.bind([
          sym,
          "annual",
          row.period_end,
          row.eps ?? null,
          prev != null ? computeGrowth(row.eps, prev.eps) : null,
          row.revenue ?? null,
          prev != null ? computeGrowth(row.revenue, prev.revenue) : null,
          now,
        ]);
        upsertFin.step();
        upsertFin.reset();
      }
      for (let j = 0; j < quarterly.length; j++) {
        const row = quarterly[j];
        if (row.period_end < financialsCutoff) continue;
        const prev = quarterly[j + 1];
        upsertFin.bind([
          sym,
          "quarterly",
          row.period_end,
          row.eps ?? null,
          prev != null ? computeGrowth(row.eps, prev.eps) : null,
          row.revenue ?? null,
          prev != null ? computeGrowth(row.revenue, prev.revenue) : null,
          now,
        ]);
        upsertFin.step();
        upsertFin.reset();
      }
    } catch (e) {
      console.warn("  ", sym, e.message);
    }
    if ((i + 1) % 100 === 0 || i === symbolsToProcess.length - 1) {
      process.stdout.write("  financials: " + (i + 1) + "/" + symbolsToProcess.length + "\r");
    }
    await sleep(150);
  }
  upsertFin.free();
  console.log("\n  financials done.");
  if (RESUME) {
    console.log("  Persisting DB...");
    writeDatabaseChunked(db, DB_PATH);
  }

  if (RESUME) {
    const doneCo = db.exec("SELECT symbol FROM companies WHERE shares_outstanding IS NOT NULL");
    const doneCoSet = new Set((doneCo[0]?.values ?? []).map((r) => r[0]));
    symbolsToProcess = symbols.filter((s) => !doneCoSet.has(s));
    if (doneCoSet.size > 0) {
      console.log("  companies: " + doneCoSet.size + " symbols already done, " + symbolsToProcess.length + " remaining.");
    }
  }

  console.log("\n3. Refreshing companies (profile + shares_outstanding)...");
  const updateCompany = db.prepare(
    "UPDATE companies SET name = COALESCE(?, name), exchange = COALESCE(?, exchange), shares_outstanding = ?, updated_at = ? WHERE symbol = ?"
  );
  for (let i = 0; i < symbolsToProcess.length; i++) {
    const sym = symbolsToProcess[i];
    try {
      const profile = await fetchProfile(sym);
      if (profile) {
        const shares =
          profile.share_class_shares_outstanding ?? profile.weighted_shares_outstanding ?? null;
        updateCompany.bind([
          profile.name ?? null,
          profile.primary_exchange ?? null,
          shares,
          now,
          sym,
        ]);
        updateCompany.step();
        updateCompany.reset();
      }
    } catch (e) {
      console.warn("  ", sym, e.message);
    }
    if ((i + 1) % 100 === 0 || i === symbolsToProcess.length - 1) {
      process.stdout.write("  companies: " + (i + 1) + "/" + symbolsToProcess.length + "\r");
    }
    await sleep(120);
  }
  updateCompany.free();
  console.log("\n  companies done.");
  if (RESUME) {
    console.log("  Persisting DB...");
    writeDatabaseChunked(db, DB_PATH);
  }

  console.log("\n4. Backfilling quote_daily (market_cap = close * shares_outstanding)...");
  const placeholders = symbols.map(() => "?").join(",");
  const getBars = db.prepare(
    "SELECT symbol, date, close, volume FROM daily_bars WHERE date >= ? AND symbol IN (" +
      placeholders +
      ") ORDER BY symbol, date"
  );
  getBars.bind([fromStr, ...symbols]);
  const bars = [];
  while (getBars.step()) {
    const r = getBars.get();
    bars.push({ symbol: r[0], date: r[1], close: r[2], volume: r[3] });
  }
  getBars.free();

  const getShares = db.prepare("SELECT shares_outstanding FROM companies WHERE symbol = ?");
  const upsertQuote = db.prepare(`
    INSERT OR REPLACE INTO quote_daily (symbol, date, market_cap, last_price, change_pct, volume, avg_volume_30d_shares, high_52w, off_52w_high_pct, atr_pct_21d, free_float)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let quoted = 0;
  for (const b of bars) {
    getShares.bind([b.symbol]);
    let shares = null;
    if (getShares.step()) {
      const r = getShares.get();
      shares = r[0] != null ? Number(r[0]) : null;
    }
    getShares.reset();
    const marketCap = shares != null && b.close != null ? b.close * shares : null;
    upsertQuote.bind([
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
      null,
    ]);
    upsertQuote.step();
    upsertQuote.reset();
    quoted++;
    if (quoted % 50000 === 0) process.stdout.write("  quote_daily: " + quoted + " rows\r");
  }
  getShares.free();
  upsertQuote.free();
  console.log("\n  quote_daily: " + quoted + " rows done.");

  console.log("\nWriting database to disk (chunked)...");
  writeDatabaseChunked(db, DB_PATH);
  db.close();
  console.log("Backfill complete (" + YEARS + " years).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
