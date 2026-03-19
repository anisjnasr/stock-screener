#!/usr/bin/env node
/**
 * Precompute market_monitor_daily and breadth_daily tables.
 * Run after daily bars and indicators are refreshed.
 *
 * Usage: node scripts/compute-market-aggregates.mjs [--days 30]
 *
 * Without --days, computes for the latest date only (incremental).
 * With --days N, recomputes the last N trading days.
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
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
db.pragma("cache_size = -256000");

// Load index constituent lists
function loadIndexSymbols(indexId) {
  const path = join(__dirname, "..", "data", `${indexId}.json`);
  if (!existsSync(path)) return [];
  const raw = require("fs").readFileSync(path, "utf8");
  return JSON.parse(raw);
}

const sp500Symbols = new Set(loadIndexSymbols("sp500"));
const nasdaq100Symbols = new Set(loadIndexSymbols("nasdaq100"));
const nasdaqSymbols = new Set(
  db.prepare("SELECT symbol FROM companies WHERE exchange LIKE '%NASDAQ%' OR exchange LIKE '%nasdaq%'")
    .all()
    .map(r => r.symbol)
);

// Ensure tables exist
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

// Get dates to process
const targetDates = db.prepare(`
  SELECT DISTINCT date FROM daily_bars
  ORDER BY date DESC
  LIMIT ?
`).all(Math.max(backfillDays, 1)).map(r => r.date).reverse();

if (targetDates.length === 0) {
  console.log("No dates to process.");
  db.close();
  process.exit(0);
}

console.log(`Computing aggregates for ${targetDates.length} date(s): ${targetDates[0]} to ${targetDates[targetDates.length - 1]}`);

// Preload up4/down4 history for rolling ratio computation
const historyStartDate = (() => {
  const d = new Date(`${targetDates[0]}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 15);
  return d.toISOString().slice(0, 10);
})();

const mmUpsert = db.prepare(`
  INSERT INTO market_monitor_daily (
    date, up4pct, down4pct, ratio5d, ratio10d,
    up25pct_qtr, down25pct_qtr, up25pct_month, down25pct_month,
    up50pct_month, down50pct_month,
    sp500_pct_above_50d, sp500_pct_above_200d,
    nasdaq_pct_above_50d, nasdaq_pct_above_200d,
    universe,
    nnh_1m_highs, nnh_1m_lows, nnh_1m_net,
    nnh_3m_highs, nnh_3m_lows, nnh_3m_net,
    nnh_6m_highs, nnh_6m_lows, nnh_6m_net,
    nnh_52w_highs, nnh_52w_lows, nnh_52w_net,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    nnh_1m_highs=excluded.nnh_1m_highs, nnh_1m_lows=excluded.nnh_1m_lows, nnh_1m_net=excluded.nnh_1m_net,
    nnh_3m_highs=excluded.nnh_3m_highs, nnh_3m_lows=excluded.nnh_3m_lows, nnh_3m_net=excluded.nnh_3m_net,
    nnh_6m_highs=excluded.nnh_6m_highs, nnh_6m_lows=excluded.nnh_6m_lows, nnh_6m_net=excluded.nnh_6m_net,
    nnh_52w_highs=excluded.nnh_52w_highs, nnh_52w_lows=excluded.nnh_52w_lows, nnh_52w_net=excluded.nnh_52w_net,
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

function computeNNH(symbolSet, date, lookbackDays) {
  const symbols = [...symbolSet];
  if (symbols.length === 0) return { highs: 0, lows: 0, net: 0 };
  const placeholders = symbols.map(() => "?").join(",");
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN b.high >= (
        SELECT MAX(b2.high) FROM daily_bars b2
        WHERE b2.symbol = b.symbol AND b2.date >= date(?, '-' || ? || ' days') AND b2.date <= ?
      ) THEN 1 ELSE 0 END) AS highs,
      SUM(CASE WHEN b.low <= (
        SELECT MIN(b2.low) FROM daily_bars b2
        WHERE b2.symbol = b.symbol AND b2.date >= date(?, '-' || ? || ' days') AND b2.date <= ?
      ) THEN 1 ELSE 0 END) AS lows
    FROM daily_bars b
    WHERE b.date = ? AND b.symbol IN (${placeholders})
  `).get(date, lookbackDays, date, date, lookbackDays, date, date, ...symbols);
  const highs = Number(row?.highs ?? 0);
  const lows = Number(row?.lows ?? 0);
  return { highs, lows, net: highs - lows };
}

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
  const c50 = Number(row?.c50 ?? 0);
  const c200 = Number(row?.c200 ?? 0);
  return {
    count50d: c50,
    count200d: c200,
    pct50d: total > 0 ? (c50 / total) * 100 : null,
    pct200d: total > 0 ? (c200 / total) * 100 : null,
  };
}

// Compute market monitor base rows (up4/down4 etc.)
function computeMMBase(date) {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN q.change_pct >= 4 THEN 1 ELSE 0 END) AS up4,
      SUM(CASE WHEN q.change_pct <= -4 THEN 1 ELSE 0 END) AS down4,
      COUNT(*) AS universe
    FROM quote_daily q
    WHERE q.date = ?
  `).get(date);
  const quarterAgo = (() => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 3); return d.toISOString().slice(0, 10); })();
  const monthAgo = (() => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
  const qtrRow = db.prepare(`
    SELECT
      SUM(CASE WHEN i.price_change_3m_pct >= 25 THEN 1 ELSE 0 END) AS up25_qtr,
      SUM(CASE WHEN i.price_change_3m_pct <= -25 THEN 1 ELSE 0 END) AS down25_qtr,
      SUM(CASE WHEN i.price_change_1m_pct >= 25 THEN 1 ELSE 0 END) AS up25_mo,
      SUM(CASE WHEN i.price_change_1m_pct <= -25 THEN 1 ELSE 0 END) AS down25_mo,
      SUM(CASE WHEN i.price_change_1m_pct >= 50 THEN 1 ELSE 0 END) AS up50_mo,
      SUM(CASE WHEN i.price_change_1m_pct <= -50 THEN 1 ELSE 0 END) AS down50_mo
    FROM indicators_daily i
    WHERE i.date = ?
  `).get(date);
  return {
    up4pct: Number(row?.up4 ?? 0),
    down4pct: Number(row?.down4 ?? 0),
    universe: Number(row?.universe ?? 0),
    up25pct_qtr: Number(qtrRow?.up25_qtr ?? 0),
    down25pct_qtr: Number(qtrRow?.down25_qtr ?? 0),
    up25pct_month: Number(qtrRow?.up25_mo ?? 0),
    down25pct_month: Number(qtrRow?.down25_mo ?? 0),
    up50pct_month: Number(qtrRow?.up50_mo ?? 0),
    down50pct_month: Number(qtrRow?.down50_mo ?? 0),
  };
}

// Rolling ratio computation needs prior days too
const allMMDates = db.prepare(`
  SELECT DISTINCT date FROM daily_bars
  WHERE date >= ?
  ORDER BY date ASC
`).all(historyStartDate).map(r => r.date);

const up4ByDate = new Map();
const down4ByDate = new Map();

const nowIso = new Date().toISOString();
let processed = 0;

const insertMany = db.transaction(() => {
  for (const date of targetDates) {
    const base = computeMMBase(date);
    up4ByDate.set(date, base.up4pct);
    down4ByDate.set(date, base.down4pct);

    // Compute rolling ratios
    const dateIdx = allMMDates.indexOf(date);
    let ratio5d = null;
    let ratio10d = null;
    if (dateIdx >= 0) {
      const compute = (window) => {
        let sumUp = 0, sumDown = 0;
        for (let i = Math.max(0, dateIdx - window + 1); i <= dateIdx; i++) {
          const d = allMMDates[i];
          if (!up4ByDate.has(d)) {
            const r = db.prepare(`
              SELECT
                SUM(CASE WHEN q.change_pct >= 4 THEN 1 ELSE 0 END) AS up4,
                SUM(CASE WHEN q.change_pct <= -4 THEN 1 ELSE 0 END) AS down4
              FROM quote_daily q WHERE q.date = ?
            `).get(d);
            up4ByDate.set(d, Number(r?.up4 ?? 0));
            down4ByDate.set(d, Number(r?.down4 ?? 0));
          }
          sumUp += up4ByDate.get(d);
          sumDown += down4ByDate.get(d);
        }
        return sumDown > 0 ? sumUp / sumDown : null;
      };
      ratio5d = compute(5);
      ratio10d = compute(10);
    }

    // SP500 and Nasdaq breadth
    const sp500Breadth = computeEMAbreadth(sp500Symbols, date);
    const nasdaqBreadth = computeEMAbreadth(nasdaqSymbols, date);

    // Net new highs for all-market
    const nnh1m = computeNNH(new Set(db.prepare("SELECT DISTINCT symbol FROM daily_bars WHERE date = ?").all(date).map(r => r.symbol)), date, 21);
    const nnh3m = computeNNH(new Set(db.prepare("SELECT DISTINCT symbol FROM daily_bars WHERE date = ?").all(date).map(r => r.symbol)), date, 63);
    const nnh6m = computeNNH(new Set(db.prepare("SELECT DISTINCT symbol FROM daily_bars WHERE date = ?").all(date).map(r => r.symbol)), date, 126);
    const nnh52w = computeNNH(new Set(db.prepare("SELECT DISTINCT symbol FROM daily_bars WHERE date = ?").all(date).map(r => r.symbol)), date, 252);

    mmUpsert.run(
      date, base.up4pct, base.down4pct, ratio5d, ratio10d,
      base.up25pct_qtr, base.down25pct_qtr, base.up25pct_month, base.down25pct_month,
      base.up50pct_month, base.down50pct_month,
      sp500Breadth.pct50d, sp500Breadth.pct200d,
      nasdaqBreadth.pct50d, nasdaqBreadth.pct200d,
      base.universe,
      nnh1m.highs, nnh1m.lows, nnh1m.net,
      nnh3m.highs, nnh3m.lows, nnh3m.net,
      nnh6m.highs, nnh6m.lows, nnh6m.net,
      nnh52w.highs, nnh52w.lows, nnh52w.net,
      nowIso
    );

    // Index breadth tables
    for (const [indexId, symbolSet] of [["sp500", sp500Symbols], ["nasdaq", nasdaqSymbols]]) {
      const iBreadth = computeEMAbreadth(symbolSet, date);
      const iNnh1m = computeNNH(symbolSet, date, 21);
      const iNnh3m = computeNNH(symbolSet, date, 63);
      const iNnh6m = computeNNH(symbolSet, date, 126);
      const iNnh52w = computeNNH(symbolSet, date, 252);

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

insertMany();

// Trim old data (keep 2+ years)
const cutoff = (() => {
  const d = new Date(`${targetDates[targetDates.length - 1]}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 3);
  return d.toISOString().slice(0, 10);
})();
db.prepare("DELETE FROM market_monitor_daily WHERE date < ?").run(cutoff);
db.prepare("DELETE FROM breadth_daily WHERE date < ?").run(cutoff);

db.close();
console.log(`Done. Computed aggregates for ${processed} date(s).`);
