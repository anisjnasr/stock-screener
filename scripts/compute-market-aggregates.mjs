#!/usr/bin/env node
/**
 * Precompute market_monitor_daily and breadth_daily tables.
 * Run after daily bars and indicators are refreshed.
 *
 * Usage: node scripts/compute-market-aggregates.mjs [--days 504]
 *
 * Without --days, computes for the latest date only (incremental).
 * With --days N, recomputes the last N trading days.
 * Use --days 504 for a full 2-year backfill.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "screener.db");

if (!existsSync(DB_PATH)) {
  console.error("Missing data/screener.db");
  process.exit(1);
}

const daysArg = process.argv.indexOf("--days");
const backfillDays = daysArg >= 0 ? parseInt(process.argv[daysArg + 1], 10) : 1;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 30000");
db.pragma("cache_size = -64000");

// Backfill shares_outstanding from quote_daily market_cap where missing
const backfillResult = db.prepare(`
  UPDATE companies
  SET shares_outstanding = (
    SELECT q.market_cap / q.last_price
    FROM quote_daily q
    WHERE q.symbol = companies.symbol
      AND q.last_price > 0
      AND q.market_cap > 0
    ORDER BY q.date DESC
    LIMIT 1
  ),
  updated_at = datetime('now')
  WHERE shares_outstanding IS NULL
    AND EXISTS (
      SELECT 1 FROM quote_daily q
      WHERE q.symbol = companies.symbol
        AND q.market_cap > 0
        AND q.last_price > 0
    )
`).run();
console.log(`Backfilled shares_outstanding for ${backfillResult.changes} companies`);

function loadIndexSymbols(filename) {
  const path = join(__dirname, "..", "data", filename);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

const sp500Symbols = new Set(loadIndexSymbols("sp500.json"));
const nasdaqSymbols = new Set(
  db.prepare("SELECT symbol FROM companies WHERE exchange LIKE '%NASDAQ%' OR exchange LIKE '%nasdaq%'")
    .all()
    .map(r => r.symbol)
);

// Ensure is_etf column exists on companies (older DBs may lack it)
try {
  db.exec("ALTER TABLE companies ADD COLUMN is_etf INTEGER NOT NULL DEFAULT 0");
  console.log("Added missing is_etf column to companies table.");
} catch {
  // Column already exists
}

// For large backfills (>10 days), drop and recreate to handle schema changes.
// For incremental runs (--days 1), preserve existing history.
if (backfillDays > 10) {
  console.log("Full backfill requested – dropping and recreating precomputed tables.");
  db.exec("DROP TABLE IF EXISTS market_monitor_daily");
  db.exec("DROP TABLE IF EXISTS breadth_daily");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS market_monitor_daily (
    date TEXT PRIMARY KEY,
    up4pct INTEGER NOT NULL DEFAULT 0,
    down4pct INTEGER NOT NULL DEFAULT 0,
    ratio5d REAL,
    ratio10d REAL,
    up25pct_qtr INTEGER NOT NULL DEFAULT 0,
    down25pct_qtr INTEGER NOT NULL DEFAULT 0,
    up25pct_month INTEGER NOT NULL DEFAULT 0,
    down25pct_month INTEGER NOT NULL DEFAULT 0,
    up50pct_month INTEGER NOT NULL DEFAULT 0,
    down50pct_month INTEGER NOT NULL DEFAULT 0,
    sp500_pct_above_50d REAL,
    sp500_pct_above_200d REAL,
    nasdaq_pct_above_50d REAL,
    nasdaq_pct_above_200d REAL,
    universe INTEGER NOT NULL DEFAULT 0,
    nnh_1m_highs INTEGER,
    nnh_1m_lows INTEGER,
    nnh_1m_net INTEGER,
    nnh_3m_highs INTEGER,
    nnh_3m_lows INTEGER,
    nnh_3m_net INTEGER,
    nnh_6m_highs INTEGER,
    nnh_6m_lows INTEGER,
    nnh_6m_net INTEGER,
    nnh_52w_highs INTEGER,
    nnh_52w_lows INTEGER,
    nnh_52w_net INTEGER,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS breadth_daily (
    index_id TEXT NOT NULL,
    date TEXT NOT NULL,
    nnh_1m_highs INTEGER,
    nnh_1m_lows INTEGER,
    nnh_1m REAL,
    nnh_3m_highs INTEGER,
    nnh_3m_lows INTEGER,
    nnh_3m REAL,
    nnh_6m_highs INTEGER,
    nnh_6m_lows INTEGER,
    nnh_6m REAL,
    nnh_52w_highs INTEGER,
    nnh_52w_lows INTEGER,
    nnh_52w REAL,
    pct_above_50d REAL,
    pct_above_200d REAL,
    count_50d INTEGER,
    count_200d INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (index_id, date)
  );
`);

// Get dates to process.
// For incremental runs (small --days), auto-detect all dates in daily_bars that
// are missing from market_monitor_daily so we never leave gaps.
let targetDates;
if (backfillDays <= 10) {
  const missingDates = db.prepare(`
    SELECT DISTINCT d.date FROM daily_bars d
    LEFT JOIN market_monitor_daily m ON m.date = d.date
    WHERE m.date IS NULL
    ORDER BY d.date ASC
  `).all().map(r => r.date);
  const latestNDates = db.prepare(`
    SELECT DISTINCT date FROM daily_bars
    ORDER BY date DESC
    LIMIT ?
  `).all(Math.max(backfillDays, 1)).map(r => r.date);
  const combined = new Set([...missingDates, ...latestNDates]);
  targetDates = [...combined].sort();
} else {
  targetDates = db.prepare(`
    SELECT DISTINCT date FROM daily_bars
    ORDER BY date DESC
    LIMIT ?
  `).all(backfillDays).map(r => r.date).reverse();
}

if (targetDates.length === 0) {
  console.log("No dates to process.");
  db.close();
  process.exit(0);
}

console.log(`Computing aggregates for ${targetDates.length} date(s): ${targetDates[0]} to ${targetDates[targetDates.length - 1]}`);

// ── Market Monitor: compute in a single SQL batch per date range ──
// Need 65 trading days of lookback for C[65]; use 120 calendar day buffer
const bufferDate = (() => {
  const d = new Date(`${targetDates[0]}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 120);
  return d.toISOString().slice(0, 10);
})();

const startTarget = targetDates[0];
const endTarget = targetDates[targetDates.length - 1];

console.log("Computing market monitor base rows (all common equities, excluding ETFs)...");

const mmRows = db.prepare(`
  WITH base AS (
    SELECT
      d.symbol,
      d.date,
      d.close AS C,
      d.volume AS V,
      LAG(d.close, 1)  OVER w AS C1,
      LAG(d.close, 20) OVER w AS C20,
      LAG(d.close, 65) OVER w AS C65,
      LAG(d.volume, 1) OVER w AS V1,
      AVG(d.close)  OVER (PARTITION BY d.symbol ORDER BY d.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_c_20,
      AVG(CAST(d.volume AS REAL)) OVER (PARTITION BY d.symbol ORDER BY d.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_v_20
    FROM daily_bars d
    INNER JOIN companies co ON co.symbol = d.symbol AND co.is_etf = 0
    WHERE d.date BETWEEN ? AND ?
    WINDOW w AS (PARTITION BY d.symbol ORDER BY d.date)
  )
  SELECT
    date,
    COUNT(*) AS universe,
    SUM(CASE WHEN C1 > 0 AND 100.0*(C-C1)/C1 >= 4 AND V >= 1000 AND V > V1 THEN 1 ELSE 0 END) AS up4pct,
    SUM(CASE WHEN C1 > 0 AND 100.0*(C-C1)/C1 <= -4 AND V >= 1000 AND V > V1 THEN 1 ELSE 0 END) AS down4pct,
    SUM(CASE WHEN C65 > 0 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C65)/C65 >= 25 THEN 1 ELSE 0 END) AS up25pct_qtr,
    SUM(CASE WHEN C65 > 0 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C65)/C65 <= -25 THEN 1 ELSE 0 END) AS down25pct_qtr,
    SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 >= 25 THEN 1 ELSE 0 END) AS up25pct_month,
    SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 <= -25 THEN 1 ELSE 0 END) AS down25pct_month,
    SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 >= 50 THEN 1 ELSE 0 END) AS up50pct_month,
    SUM(CASE WHEN C20 >= 5 AND avg_c_20*avg_v_20 >= 2500 AND 100.0*(C-C20)/C20 <= -50 THEN 1 ELSE 0 END) AS down50pct_month
  FROM base
  WHERE date BETWEEN ? AND ?
  GROUP BY date
  ORDER BY date ASC
`).all(bufferDate, endTarget, startTarget, endTarget);

console.log(`  Got ${mmRows.length} dates of MM base data.`);

// Build lookup for rolling ratio computation
const up4ByDate = new Map();
const down4ByDate = new Map();
for (const r of mmRows) {
  up4ByDate.set(r.date, Number(r.up4pct ?? 0));
  down4ByDate.set(r.date, Number(r.down4pct ?? 0));
}

// Also load prior dates for rolling ratios (need up to 10 prior trading days)
const priorDates = db.prepare(`
  SELECT date FROM market_monitor_daily
  WHERE date < ?
  ORDER BY date DESC
  LIMIT 10
`).all(startTarget).map(r => r.date).reverse();

for (const d of priorDates) {
  if (!up4ByDate.has(d)) {
    const row = db.prepare("SELECT up4pct, down4pct FROM market_monitor_daily WHERE date = ?").get(d);
    if (row) {
      up4ByDate.set(d, Number(row.up4pct ?? 0));
      down4ByDate.set(d, Number(row.down4pct ?? 0));
    }
  }
}

const allDatesForRatio = [...new Set([...priorDates, ...mmRows.map(r => r.date)])].sort();

function windowRatio(date, window) {
  const idx = allDatesForRatio.indexOf(date);
  if (idx < 0) return null;
  let sumUp = 0, sumDown = 0;
  for (let i = Math.max(0, idx - window + 1); i <= idx; i++) {
    const d = allDatesForRatio[i];
    sumUp += up4ByDate.get(d) ?? 0;
    sumDown += down4ByDate.get(d) ?? 0;
  }
  return sumDown > 0 ? sumUp / sumDown : null;
}

// ── EMA breadth for SP500 and Nasdaq ──
function computeEMAbreadth(symbolSet, date) {
  const symbols = [...symbolSet];
  if (symbols.length === 0) return { count50d: 0, count200d: 0, pct50d: null, pct200d: null };
  const placeholders = symbols.map(() => "?").join(",");
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN i.above_ema_50 = 1 THEN 1 ELSE 0 END) AS c50,
      SUM(CASE WHEN i.above_ema_200 = 1 THEN 1 ELSE 0 END) AS c200,
      COUNT(*) AS total
    FROM indicators_daily i
    WHERE i.date = ? AND i.symbol IN (${placeholders})
  `).get(date, ...symbols);
  const total = Number(row?.total ?? 0);
  return {
    count50d: Number(row?.c50 ?? 0),
    count200d: Number(row?.c200 ?? 0),
    pct50d: total > 0 ? (Number(row?.c50 ?? 0) / total) * 100 : null,
    pct200d: total > 0 ? (Number(row?.c200 ?? 0) / total) * 100 : null,
  };
}

// ── Upsert statements ──
const mmUpsert = db.prepare(`
  INSERT INTO market_monitor_daily (
    date, up4pct, down4pct, ratio5d, ratio10d,
    up25pct_qtr, down25pct_qtr, up25pct_month, down25pct_month,
    up50pct_month, down50pct_month,
    sp500_pct_above_50d, sp500_pct_above_200d,
    nasdaq_pct_above_50d, nasdaq_pct_above_200d,
    universe, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET
    up4pct=excluded.up4pct, down4pct=excluded.down4pct,
    ratio5d=excluded.ratio5d, ratio10d=excluded.ratio10d,
    up25pct_qtr=excluded.up25pct_qtr, down25pct_qtr=excluded.down25pct_qtr,
    up25pct_month=excluded.up25pct_month, down25pct_month=excluded.down25pct_month,
    up50pct_month=excluded.up50pct_month, down50pct_month=excluded.down50pct_month,
    sp500_pct_above_50d=excluded.sp500_pct_above_50d,
    sp500_pct_above_200d=excluded.sp500_pct_above_200d,
    nasdaq_pct_above_50d=excluded.nasdaq_pct_above_50d,
    nasdaq_pct_above_200d=excluded.nasdaq_pct_above_200d,
    universe=excluded.universe,
    updated_at=excluded.updated_at
`);

const breadthUpsert = db.prepare(`
  INSERT INTO breadth_daily (
    index_id, date,
    nnh_1m_highs, nnh_1m_lows, nnh_1m,
    nnh_3m_highs, nnh_3m_lows, nnh_3m,
    nnh_6m_highs, nnh_6m_lows, nnh_6m,
    nnh_52w_highs, nnh_52w_lows, nnh_52w,
    pct_above_50d, pct_above_200d,
    count_50d, count_200d,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(index_id, date) DO UPDATE SET
    nnh_1m_highs=excluded.nnh_1m_highs, nnh_1m_lows=excluded.nnh_1m_lows, nnh_1m=excluded.nnh_1m,
    nnh_3m_highs=excluded.nnh_3m_highs, nnh_3m_lows=excluded.nnh_3m_lows, nnh_3m=excluded.nnh_3m,
    nnh_6m_highs=excluded.nnh_6m_highs, nnh_6m_lows=excluded.nnh_6m_lows, nnh_6m=excluded.nnh_6m,
    nnh_52w_highs=excluded.nnh_52w_highs, nnh_52w_lows=excluded.nnh_52w_lows, nnh_52w=excluded.nnh_52w,
    pct_above_50d=excluded.pct_above_50d, pct_above_200d=excluded.pct_above_200d,
    count_50d=excluded.count_50d, count_200d=excluded.count_200d,
    updated_at=excluded.updated_at
`);

// ── NNH helper for index-level breadth ──
function computeIndexNNH(symbolSet, date, lookbackDays) {
  const symbols = [...symbolSet];
  if (symbols.length === 0) return { highs: 0, lows: 0, net: 0 };
  const placeholders = symbols.map(() => "?").join(",");
  const bufStart = (() => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (lookbackDays + 30));
    return d.toISOString().slice(0, 10);
  })();
  const rows = db.prepare(`
    WITH base AS (
      SELECT
        d.symbol, d.date, d.close,
        MAX(d.high) OVER (PARTITION BY d.symbol ORDER BY d.date ROWS BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING) AS prior_high,
        MIN(d.low)  OVER (PARTITION BY d.symbol ORDER BY d.date ROWS BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING) AS prior_low,
        COUNT(d.high) OVER (PARTITION BY d.symbol ORDER BY d.date ROWS BETWEEN ${lookbackDays} PRECEDING AND 1 PRECEDING) AS prior_count
      FROM daily_bars d
      WHERE d.symbol IN (${placeholders})
        AND d.date BETWEEN ? AND ?
    )
    SELECT
      SUM(CASE WHEN prior_count >= ${lookbackDays} AND close > prior_high THEN 1 ELSE 0 END) AS highs,
      SUM(CASE WHEN prior_count >= ${lookbackDays} AND close < prior_low  THEN 1 ELSE 0 END) AS lows
    FROM base
    WHERE date = ?
  `).get(...symbols, bufStart, date, date);
  const highs = Number(rows?.highs ?? 0);
  const lows = Number(rows?.lows ?? 0);
  return { highs, lows, net: highs - lows };
}

const nowIso = new Date().toISOString();
let processed = 0;

// Build a map from MM SQL rows by date for fast lookup
const mmByDate = new Map();
for (const r of mmRows) mmByDate.set(r.date, r);

const insertAll = db.transaction(() => {
  for (const date of targetDates) {
    const mm = mmByDate.get(date);
    const up4 = Number(mm?.up4pct ?? 0);
    const down4 = Number(mm?.down4pct ?? 0);
    const ratio5d = windowRatio(date, 5);
    const ratio10d = windowRatio(date, 10);

    const sp500Breadth = computeEMAbreadth(sp500Symbols, date);
    const nasdaqBreadth = computeEMAbreadth(nasdaqSymbols, date);

    mmUpsert.run(
      date, up4, down4, ratio5d, ratio10d,
      Number(mm?.up25pct_qtr ?? 0), Number(mm?.down25pct_qtr ?? 0),
      Number(mm?.up25pct_month ?? 0), Number(mm?.down25pct_month ?? 0),
      Number(mm?.up50pct_month ?? 0), Number(mm?.down50pct_month ?? 0),
      sp500Breadth.pct50d, sp500Breadth.pct200d,
      nasdaqBreadth.pct50d, nasdaqBreadth.pct200d,
      Number(mm?.universe ?? 0),
      nowIso
    );

    // Index breadth tables
    for (const [indexId, symbolSet] of [["sp500", sp500Symbols], ["nasdaq", nasdaqSymbols]]) {
      const iBreadth = computeEMAbreadth(symbolSet, date);
      const iNnh1m = computeIndexNNH(symbolSet, date, 21);
      const iNnh3m = computeIndexNNH(symbolSet, date, 63);
      const iNnh6m = computeIndexNNH(symbolSet, date, 126);
      const iNnh52w = computeIndexNNH(symbolSet, date, 252);

      breadthUpsert.run(
        indexId, date,
        iNnh1m.highs, iNnh1m.lows, iNnh1m.net,
        iNnh3m.highs, iNnh3m.lows, iNnh3m.net,
        iNnh6m.highs, iNnh6m.lows, iNnh6m.net,
        iNnh52w.highs, iNnh52w.lows, iNnh52w.net,
        iBreadth.pct50d, iBreadth.pct200d,
        iBreadth.count50d, iBreadth.count200d,
        nowIso
      );
    }

    processed++;
    if (processed % 10 === 0 || processed === targetDates.length) {
      console.log(`  Processed ${processed}/${targetDates.length} dates`);
    }
  }
});

insertAll();

// Trim old data (keep 3+ years)
const cutoff = (() => {
  const d = new Date(`${targetDates[targetDates.length - 1]}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 3);
  return d.toISOString().slice(0, 10);
})();
db.prepare("DELETE FROM market_monitor_daily WHERE date < ?").run(cutoff);
db.prepare("DELETE FROM breadth_daily WHERE date < ?").run(cutoff);

db.close();
console.log(`Done. Computed aggregates for ${processed} date(s).`);
