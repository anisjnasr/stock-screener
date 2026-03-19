#!/usr/bin/env node
/**
 * Compute all indicators from daily_bars (OHLCV) and populate quote_daily + indicators_daily.
 * No API calls - uses only local data. Run after backfill-historical-massive.
 *
 * When screener.db is larger than ~2GB, uses better-sqlite3 (on-disk) to avoid Node buffer limit.
 *
 * Run: node scripts/compute-indicators-from-bars.mjs [--limit N] [--years N]
 *   --limit N   Only process first N symbols (for testing)
 *   --years N   Only process last N years of data (default: 5)
 */

import initSqlJs from "sql.js";
import { readFileSync, existsSync, openSync, writeSync, closeSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DATA_DIR = join(root, "data");
const DB_PATH = join(DATA_DIR, "screener.db");

const USE_NATIVE_IF_LARGER_BYTES = 1.5e9;

function writeDatabaseChunked(db, filePath) {
  const data = db.export();
  const chunkSize = 256 * 1024 * 1024;
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

function computeEMA(bars, key, period) {
  const k = 2 / (period + 1);
  const out = [];
  let ema = null;
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i][key];
    if (ema == null) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - period + 1); j <= i; j++) {
        sum += bars[j][key];
        count++;
      }
      ema = count > 0 ? sum / count : v;
    } else {
      ema = v * k + ema * (1 - k);
    }
    out.push(ema);
  }
  return out;
}

function computeATR(bars, period) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < 1) {
      out.push(0);
      continue;
    }
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    if (i === 1) {
      out.push(tr);
      continue;
    }
    const atrPrev = out[i - 1];
    const atr = (atrPrev * (period - 1) + tr) / period;
    out.push(atr);
  }
  return out;
}

async function runNativeCompute(LIMIT, YEARS) {
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH);
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - YEARS);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  let symbols = db.prepare("SELECT symbol FROM companies ORDER BY symbol").all().map((r) => r.symbol);
  if (LIMIT != null && LIMIT > 0) symbols = symbols.slice(0, LIMIT);
  const spyBarsList = db
    .prepare("SELECT date, close FROM daily_bars WHERE symbol = 'SPY' AND date >= ? AND date <= ? ORDER BY date")
    .all(fromStr, toStr);

  const upsertQuote = db.prepare(`
    INSERT OR REPLACE INTO quote_daily (symbol, date, market_cap, last_price, change_pct, volume, avg_volume_30d_shares, high_52w, off_52w_high_pct, atr_pct_21d, free_float)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertInd = db.prepare(`
    INSERT OR REPLACE INTO indicators_daily (symbol, date, price_change_1w_pct, price_change_1m_pct, price_change_3m_pct, price_change_6m_pct, price_change_12m_pct, avg_volume_1w, avg_volume_1m, atr_14, atr_pct_14, atr_21, atr_pct_21, ema_20, ema_50, ema_100, ema_200, above_ema_20, pct_from_ema_20, above_ema_50, pct_from_ema_50, above_ema_100, pct_from_ema_100, above_ema_200, pct_from_ema_200, ema_20_above_50, ema_20_50_spread_pct, ema_50_above_100, ema_50_100_spread_pct, ema_50_above_200, ema_50_200_spread_pct, ema_100_above_200, ema_100_200_spread_pct, rs_vs_spy_1w, rs_vs_spy_1m, rs_vs_spy_3m, rs_vs_spy_6m, rs_vs_spy_12m, industry_rank_1m, industry_rank_3m, industry_rank_6m, industry_rank_12m, sector_rank_1m, sector_rank_3m, sector_rank_6m, sector_rank_12m)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getBars = db.prepare("SELECT date, open, high, low, close, volume FROM daily_bars WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date");
  const getQuote = db.prepare("SELECT market_cap, last_price, volume FROM quote_daily WHERE symbol = ? AND date = ?");
  const getCompany = db.prepare("SELECT industry, sector FROM companies WHERE symbol = ?");
  const pctFrom = (close, ema) => (ema ? ((close - ema) / ema) * 100 : null);
  const spread = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const rs = (stock, spy) => (stock != null && spy != null ? ((1 + stock / 100) / (1 + spy / 100)) * 100 : null);

  let totalRows = 0;
  console.log("\n1. Computing quote_daily + indicators_daily from daily_bars...");
  for (let s = 0; s < symbols.length; s++) {
    const sym = symbols[s];
    const bars = getBars.all(sym, fromStr, toStr).map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
    if (bars.length < 22) continue;
    const company = getCompany.get(sym);
    const industry = company?.industry ?? null;
    const sector = company?.sector ?? null;
    for (let i = 21; i < bars.length; i++) {
      const slice = bars.slice(0, i + 1);
      const lastBar = slice[slice.length - 1];
      const date = lastBar.date;
      const q = getQuote.get(sym, date);
      let marketCap = q?.market_cap ?? null;
      let lastPrice = q?.last_price ?? lastBar.close;
      let volume = q?.volume ?? lastBar.volume;
      const prevClose = slice.length >= 2 ? slice[slice.length - 2].close : lastBar.close;
      const changePct = prevClose ? ((lastBar.close - prevClose) / prevClose) * 100 : null;
      const vol30 = slice.slice(-30).map((b) => b.volume);
      const avgVol30 = vol30.length ? vol30.reduce((a, b) => a + b, 0) / vol30.length : null;
      const high52w = Math.max(...slice.slice(-252).map((b) => b.high));
      const off52w = high52w ? ((high52w - lastBar.close) / high52w) * 100 : null;
      const atr21Arr = computeATR(slice, 21);
      const atr21 = atr21Arr[atr21Arr.length - 1];
      const atrPct21 = lastBar.close && atr21 ? (atr21 / lastBar.close) * 100 : null;
      upsertQuote.run(sym, date, marketCap, lastPrice, changePct, volume, avgVol30, high52w, off52w, atrPct21, null);

      const ema20Arr = computeEMA(slice, "close", 20);
      const ema50Arr = computeEMA(slice, "close", 50);
      const ema100Arr = computeEMA(slice, "close", 100);
      const ema200Arr = computeEMA(slice, "close", 200);
      const ema20 = ema20Arr[ema20Arr.length - 1];
      const ema50 = ema50Arr[ema50Arr.length - 1];
      const ema100 = ema100Arr[ema100Arr.length - 1];
      const ema200 = ema200Arr[ema200Arr.length - 1];
      const close5 = slice.length >= 6 ? slice[slice.length - 6].close : null;
      const close21 = slice.length >= 22 ? slice[slice.length - 22].close : null;
      const close63 = slice.length >= 64 ? slice[slice.length - 64].close : null;
      const close126 = slice.length >= 127 ? slice[slice.length - 127].close : null;
      const close252 = slice.length >= 253 ? slice[slice.length - 253].close : null;
      const ch1w = close5 ? ((lastBar.close - close5) / close5) * 100 : null;
      const ch1m = close21 ? ((lastBar.close - close21) / close21) * 100 : null;
      const ch3m = close63 ? ((lastBar.close - close63) / close63) * 100 : null;
      const ch6m = close126 ? ((lastBar.close - close126) / close126) * 100 : null;
      const ch12m = close252 ? ((lastBar.close - close252) / close252) * 100 : null;
      const vol1w = slice.slice(-5).map((b) => b.volume);
      const vol1m = slice.slice(-21).map((b) => b.volume);
      const avgVol1w = vol1w.length ? vol1w.reduce((a, b) => a + b, 0) / vol1w.length : null;
      const avgVol1m = vol1m.length ? vol1m.reduce((a, b) => a + b, 0) / vol1m.length : null;
      const atr14Arr = computeATR(slice, 14);
      const atr14 = atr14Arr[atr14Arr.length - 1];
      const atrPct14 = lastBar.close && atr14 ? (atr14 / lastBar.close) * 100 : null;
      const spyIdx = spyBarsList.findIndex((r) => r.date === date);
      const spyClose = spyIdx >= 0 ? spyBarsList[spyIdx].close : null;
      const spyClose5 = spyIdx >= 5 ? spyBarsList[spyIdx - 5].close : null;
      const spyClose21 = spyIdx >= 21 ? spyBarsList[spyIdx - 21].close : null;
      const spyClose63 = spyIdx >= 63 ? spyBarsList[spyIdx - 63].close : null;
      const spyClose126 = spyIdx >= 126 ? spyBarsList[spyIdx - 126].close : null;
      const spyClose252 = spyIdx >= 252 ? spyBarsList[spyIdx - 252].close : null;
      const spyRet1w = spyClose5 ? ((spyClose - spyClose5) / spyClose5) * 100 : null;
      const spyRet1m = spyClose21 ? ((spyClose - spyClose21) / spyClose21) * 100 : null;
      const spyRet3m = spyClose63 ? ((spyClose - spyClose63) / spyClose63) * 100 : null;
      const spyRet6m = spyClose126 ? ((spyClose - spyClose126) / spyClose126) * 100 : null;
      const spyRet12m = spyClose252 ? ((spyClose - spyClose252) / spyClose252) * 100 : null;
      const rs1w = rs(ch1w, spyRet1w);
      const rs1m = rs(ch1m, spyRet1m);
      const rs3m = rs(ch3m, spyRet3m);
      const rs6m = rs(ch6m, spyRet6m);
      const rs12m = rs(ch12m, spyRet12m);
      upsertInd.run(
        sym, date, ch1w, ch1m, ch3m, ch6m, ch12m, avgVol1w, avgVol1m, atr14, atrPct14, atr21, atrPct21,
        ema20, ema50, ema100, ema200,
        lastBar.close > ema20 ? 1 : 0, pctFrom(lastBar.close, ema20), lastBar.close > ema50 ? 1 : 0, pctFrom(lastBar.close, ema50), lastBar.close > ema100 ? 1 : 0, pctFrom(lastBar.close, ema100), lastBar.close > ema200 ? 1 : 0, pctFrom(lastBar.close, ema200),
        ema20 > ema50 ? 1 : 0, spread(ema20, ema50), ema50 > ema100 ? 1 : 0, spread(ema50, ema100), ema50 > ema200 ? 1 : 0, spread(ema50, ema200), ema100 > ema200 ? 1 : 0, spread(ema100, ema200),
        rs1w, rs1m, rs3m, rs6m, rs12m, null, null, null, null, null, null, null, null
      );
      totalRows++;
    }
    if ((s + 1) % 100 === 0 || s === symbols.length - 1) process.stdout.write("  symbols: " + (s + 1) + "/" + symbols.length + " | rows: " + totalRows + "\r");
  }
  console.log("\n  Computed", totalRows, "indicator rows.");

  console.log("\n2. Computing industry/sector ranks and RS percentiles...");
  const indInfo = db.prepare("PRAGMA table_info(indicators_daily)").all();
  const indCols = new Set(indInfo.map((r) => r.name));
  for (const col of ["rs_pct_1w", "rs_pct_1m", "rs_pct_3m", "rs_pct_6m", "rs_pct_12m"]) {
    if (!indCols.has(col)) db.exec("ALTER TABLE indicators_daily ADD COLUMN " + col + " REAL");
  }
  const dateList = db.prepare("SELECT DISTINCT date FROM indicators_daily WHERE date >= ? AND date <= ? ORDER BY date").all(fromStr, toStr).map((r) => r.date);
  const getIndForDate = db.prepare("SELECT i.symbol, c.industry, c.sector, i.rs_vs_spy_1w, i.rs_vs_spy_1m, i.rs_vs_spy_3m, i.rs_vs_spy_6m, i.rs_vs_spy_12m FROM indicators_daily i LEFT JOIN companies c ON c.symbol = i.symbol WHERE i.date = ?");
  const updateRanks = db.prepare("UPDATE indicators_daily SET industry_rank_1m=?, industry_rank_3m=?, industry_rank_6m=?, industry_rank_12m=?, sector_rank_1m=?, sector_rank_3m=?, sector_rank_6m=?, sector_rank_12m=?, rs_pct_1w=?, rs_pct_1m=?, rs_pct_3m=?, rs_pct_6m=?, rs_pct_12m=? WHERE symbol=? AND date=?");

  for (let d = 0; d < dateList.length; d++) {
    const date = dateList[d];
    const rows = getIndForDate.all(date).map((r) => ({ symbol: r.symbol, industry: r.industry, sector: r.sector, rs1w: r.rs_vs_spy_1w, rs1m: r.rs_vs_spy_1m, rs3m: r.rs_vs_spy_3m, rs6m: r.rs_vs_spy_6m, rs12m: r.rs_vs_spy_12m }));
    const byIndustry = new Map();
    const bySector = new Map();
    for (const r of rows) {
      if (r.industry) { if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []); byIndustry.get(r.industry).push(r); }
      if (r.sector) { if (!bySector.has(r.sector)) bySector.set(r.sector, []); bySector.get(r.sector).push(r); }
    }
    for (const [, list] of byIndustry) {
      list.sort((a, b) => (b.rs1m ?? -1e9) - (a.rs1m ?? -1e9)); list.forEach((r, i) => { r.industry_rank_1m = i + 1; });
      list.sort((a, b) => (b.rs3m ?? -1e9) - (a.rs3m ?? -1e9)); list.forEach((r, i) => { r.industry_rank_3m = i + 1; });
      list.sort((a, b) => (b.rs6m ?? -1e9) - (a.rs6m ?? -1e9)); list.forEach((r, i) => { r.industry_rank_6m = i + 1; });
      list.sort((a, b) => (b.rs12m ?? -1e9) - (a.rs12m ?? -1e9)); list.forEach((r, i) => { r.industry_rank_12m = i + 1; });
    }
    for (const [, list] of bySector) {
      list.sort((a, b) => (b.rs1m ?? -1e9) - (a.rs1m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_1m = i + 1; });
      list.sort((a, b) => (b.rs3m ?? -1e9) - (a.rs3m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_3m = i + 1; });
      list.sort((a, b) => (b.rs6m ?? -1e9) - (a.rs6m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_6m = i + 1; });
      list.sort((a, b) => (b.rs12m ?? -1e9) - (a.rs12m ?? -1e9)); list.forEach((r, i) => { r.sector_rank_12m = i + 1; });
    }
    for (const col of ["rs1w", "rs1m", "rs3m", "rs6m", "rs12m"]) {
      const pctCol = "rs_pct_" + col.replace("rs", "");
      rows.sort((a, b) => (b[col] ?? -1e9) - (a[col] ?? -1e9));
      const total = rows.length;
      rows.forEach((r, idx) => { r[pctCol] = total > 0 ? ((total - idx) / total) * 100 : null; });
    }
    for (const r of rows) {
      updateRanks.run(r.industry_rank_1m ?? null, r.industry_rank_3m ?? null, r.industry_rank_6m ?? null, r.industry_rank_12m ?? null, r.sector_rank_1m ?? null, r.sector_rank_3m ?? null, r.sector_rank_6m ?? null, r.sector_rank_12m ?? null, r.rs_pct_1w ?? null, r.rs_pct_1m ?? null, r.rs_pct_3m ?? null, r.rs_pct_6m ?? null, r.rs_pct_12m ?? null, r.symbol, date);
    }
    if ((d + 1) % 100 === 0 || d === dateList.length - 1) process.stdout.write("  dates: " + (d + 1) + "/" + dateList.length + "\r");
  }
  console.log("\n  Ranks done.");
  db.close();
  console.log("Compute indicators complete (native).");
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing data/screener.db");
    process.exit(1);
  }

  const limitIdx = process.argv.indexOf("--limit");
  const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : null;
  const yearsIdx = process.argv.indexOf("--years");
  const YEARS = yearsIdx >= 0 && process.argv[yearsIdx + 1] ? parseInt(process.argv[yearsIdx + 1], 10) : 5;

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - YEARS);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  try {
    const stat = statSync(DB_PATH);
    if (stat.size > USE_NATIVE_IF_LARGER_BYTES) {
      console.log("DB is large (" + (stat.size / 1e9).toFixed(1) + " GB), using better-sqlite3 (on-disk)...");
      await runNativeCompute(LIMIT, YEARS);
      return;
    }
  } catch (_) {}

  console.log("Loading DB...");
  const SQL = await initSqlJs();
  const buf = readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const symbolRows = db.exec("SELECT symbol FROM companies ORDER BY symbol");
  let symbols = symbolRows[0]?.values?.map((r) => r[0]) ?? [];
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }

  const spyRows = db.exec(
    "SELECT date, close FROM daily_bars WHERE symbol = 'SPY' AND date >= '" + fromStr + "' AND date <= '" + toStr + "' ORDER BY date"
  );
  const spyBarsList = spyRows[0]?.values ?? [];

  const upsertQuote = db.prepare(`
    INSERT OR REPLACE INTO quote_daily (symbol, date, market_cap, last_price, change_pct, volume, avg_volume_30d_shares, high_52w, off_52w_high_pct, atr_pct_21d, free_float)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertInd = db.prepare(`
    INSERT OR REPLACE INTO indicators_daily (
      symbol, date,
      price_change_1w_pct, price_change_1m_pct, price_change_3m_pct, price_change_6m_pct, price_change_12m_pct,
      avg_volume_1w, avg_volume_1m,
      atr_14, atr_pct_14, atr_21, atr_pct_21,
      ema_20, ema_50, ema_100, ema_200,
      above_ema_20, pct_from_ema_20, above_ema_50, pct_from_ema_50, above_ema_100, pct_from_ema_100, above_ema_200, pct_from_ema_200,
      ema_20_above_50, ema_20_50_spread_pct, ema_50_above_100, ema_50_100_spread_pct, ema_50_above_200, ema_50_200_spread_pct, ema_100_above_200, ema_100_200_spread_pct,
      rs_vs_spy_1w, rs_vs_spy_1m, rs_vs_spy_3m, rs_vs_spy_6m, rs_vs_spy_12m,
      industry_rank_1m, industry_rank_3m, industry_rank_6m, industry_rank_12m,
      sector_rank_1m, sector_rank_3m, sector_rank_6m, sector_rank_12m
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getQuote = db.prepare("SELECT market_cap, last_price, volume FROM quote_daily WHERE symbol = ? AND date = ?");
  const getBars = db.prepare(
    "SELECT date, open, high, low, close, volume FROM daily_bars WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date"
  );
  const companyStmt = db.prepare("SELECT industry, sector FROM companies WHERE symbol = ?");

  const pctFrom = (close, ema) => (ema ? ((close - ema) / ema) * 100 : null);
  const spread = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const rs = (stock, spy) =>
    stock != null && spy != null ? ((1 + stock / 100) / (1 + spy / 100)) * 100 : null;

  let totalRows = 0;
  const BATCH = 5000;

  console.log("\n1. Computing quote_daily + indicators_daily from daily_bars...");

  for (let s = 0; s < symbols.length; s++) {
    const sym = symbols[s];
    getBars.bind([sym, fromStr, toStr]);
    const bars = [];
    while (getBars.step()) {
      const r = getBars.get();
      bars.push({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] });
    }
    getBars.reset();
    if (bars.length < 22) continue;

    companyStmt.bind([sym]);
    let industry = null;
    let sector = null;
    if (companyStmt.step()) {
      const r = companyStmt.get();
      industry = r[0];
      sector = r[1];
    }
    companyStmt.reset();

    for (let i = 21; i < bars.length; i++) {
      const slice = bars.slice(0, i + 1);
      const lastBar = slice[slice.length - 1];
      const date = lastBar.date;

      getQuote.bind([sym, date]);
      let marketCap = null;
      let lastPrice = lastBar.close;
      let volume = lastBar.volume;
      if (getQuote.step()) {
        const r = getQuote.get();
        marketCap = r[0];
        lastPrice = r[1] ?? lastBar.close;
        volume = r[2] ?? lastBar.volume;
      }
      getQuote.reset();

      const prevClose = slice.length >= 2 ? slice[slice.length - 2].close : lastBar.close;
      const changePct = prevClose ? ((lastBar.close - prevClose) / prevClose) * 100 : null;
      const vol30 = slice.slice(-30).map((b) => b.volume);
      const avgVol30 = vol30.length ? vol30.reduce((a, b) => a + b, 0) / vol30.length : null;
      const high52w = Math.max(...slice.slice(-252).map((b) => b.high));
      const off52w = high52w ? ((high52w - lastBar.close) / high52w) * 100 : null;

      const atr21Arr = computeATR(slice, 21);
      const atr21 = atr21Arr[atr21Arr.length - 1];
      const atrPct21 = lastBar.close && atr21 ? (atr21 / lastBar.close) * 100 : null;

      upsertQuote.bind([
        sym,
        date,
        marketCap,
        lastPrice,
        changePct,
        volume,
        avgVol30,
        high52w,
        off52w,
        atrPct21,
        null,
      ]);
      upsertQuote.step();
      upsertQuote.reset();

      const ema20Arr = computeEMA(slice, "close", 20);
      const ema50Arr = computeEMA(slice, "close", 50);
      const ema100Arr = computeEMA(slice, "close", 100);
      const ema200Arr = computeEMA(slice, "close", 200);
      const ema20 = ema20Arr[ema20Arr.length - 1];
      const ema50 = ema50Arr[ema50Arr.length - 1];
      const ema100 = ema100Arr[ema100Arr.length - 1];
      const ema200 = ema200Arr[ema200Arr.length - 1];

      const close5 = slice.length >= 6 ? slice[slice.length - 6].close : null;
      const close21 = slice.length >= 22 ? slice[slice.length - 22].close : null;
      const close63 = slice.length >= 64 ? slice[slice.length - 64].close : null;
      const close126 = slice.length >= 127 ? slice[slice.length - 127].close : null;
      const close252 = slice.length >= 253 ? slice[slice.length - 253].close : null;

      const ch1w = close5 ? ((lastBar.close - close5) / close5) * 100 : null;
      const ch1m = close21 ? ((lastBar.close - close21) / close21) * 100 : null;
      const ch3m = close63 ? ((lastBar.close - close63) / close63) * 100 : null;
      const ch6m = close126 ? ((lastBar.close - close126) / close126) * 100 : null;
      const ch12m = close252 ? ((lastBar.close - close252) / close252) * 100 : null;

      const vol1w = slice.slice(-5).map((b) => b.volume);
      const vol1m = slice.slice(-21).map((b) => b.volume);
      const avgVol1w = vol1w.length ? vol1w.reduce((a, b) => a + b, 0) / vol1w.length : null;
      const avgVol1m = vol1m.length ? vol1m.reduce((a, b) => a + b, 0) / vol1m.length : null;

      const atr14Arr = computeATR(slice, 14);
      const atr14 = atr14Arr[atr14Arr.length - 1];
      const atrPct14 = lastBar.close && atr14 ? (atr14 / lastBar.close) * 100 : null;

      const spyIdx = spyBarsList.findIndex((r) => r[0] === date);
      const spyClose = spyIdx >= 0 ? spyBarsList[spyIdx][1] : null;
      const spyClose5 = spyIdx >= 5 ? spyBarsList[spyIdx - 5][1] : null;
      const spyClose21 = spyIdx >= 21 ? spyBarsList[spyIdx - 21][1] : null;
      const spyClose63 = spyIdx >= 63 ? spyBarsList[spyIdx - 63][1] : null;
      const spyClose126 = spyIdx >= 126 ? spyBarsList[spyIdx - 126][1] : null;
      const spyClose252 = spyIdx >= 252 ? spyBarsList[spyIdx - 252][1] : null;

      const spyRet1w = spyClose5 ? ((spyClose - spyClose5) / spyClose5) * 100 : null;
      const spyRet1m = spyClose21 ? ((spyClose - spyClose21) / spyClose21) * 100 : null;
      const spyRet3m = spyClose63 ? ((spyClose - spyClose63) / spyClose63) * 100 : null;
      const spyRet6m = spyClose126 ? ((spyClose - spyClose126) / spyClose126) * 100 : null;
      const spyRet12m = spyClose252 ? ((spyClose - spyClose252) / spyClose252) * 100 : null;

      const rs1w = rs(ch1w, spyRet1w);
      const rs1m = rs(ch1m, spyRet1m);
      const rs3m = rs(ch3m, spyRet3m);
      const rs6m = rs(ch6m, spyRet6m);
      const rs12m = rs(ch12m, spyRet12m);

      upsertInd.bind([
        sym,
        date,
        ch1w,
        ch1m,
        ch3m,
        ch6m,
        ch12m,
        avgVol1w,
        avgVol1m,
        atr14,
        atrPct14,
        atr21,
        atrPct21,
        ema20,
        ema50,
        ema100,
        ema200,
        lastBar.close > ema20 ? 1 : 0,
        pctFrom(lastBar.close, ema20),
        lastBar.close > ema50 ? 1 : 0,
        pctFrom(lastBar.close, ema50),
        lastBar.close > ema100 ? 1 : 0,
        pctFrom(lastBar.close, ema100),
        lastBar.close > ema200 ? 1 : 0,
        pctFrom(lastBar.close, ema200),
        ema20 > ema50 ? 1 : 0,
        spread(ema20, ema50),
        ema50 > ema100 ? 1 : 0,
        spread(ema50, ema100),
        ema50 > ema200 ? 1 : 0,
        spread(ema50, ema200),
        ema100 > ema200 ? 1 : 0,
        spread(ema100, ema200),
        rs1w,
        rs1m,
        rs3m,
        rs6m,
        rs12m,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
      upsertInd.step();
      upsertInd.reset();

      totalRows++;
    }

    if ((s + 1) % 100 === 0 || s === symbols.length - 1) {
      process.stdout.write("  symbols: " + (s + 1) + "/" + symbols.length + " | rows: " + totalRows + "\r");
    }
  }

  getQuote.free();
  getBars.free();
  companyStmt.free();
  upsertQuote.free();
  upsertInd.free();

  console.log("\n  Computed", totalRows, "indicator rows.");

  console.log("\n2. Computing industry/sector ranks and RS percentiles...");

  const indInfo = db.exec("PRAGMA table_info(indicators_daily)");
  const indCols = new Set((indInfo[0]?.values ?? []).map((r) => r[1]));
  for (const col of ["rs_pct_1w", "rs_pct_1m", "rs_pct_3m", "rs_pct_6m", "rs_pct_12m"]) {
    if (!indCols.has(col)) {
      db.run("ALTER TABLE indicators_daily ADD COLUMN " + col + " REAL");
    }
  }

  const dates = db.exec(
    "SELECT DISTINCT date FROM indicators_daily WHERE date >= '" + fromStr + "' AND date <= '" + toStr + "' ORDER BY date"
  );
  const dateList = (dates[0]?.values ?? []).map((r) => r[0]);

  const getIndForDate = db.prepare(
    "SELECT i.symbol, c.industry, c.sector, i.rs_vs_spy_1w, i.rs_vs_spy_1m, i.rs_vs_spy_3m, i.rs_vs_spy_6m, i.rs_vs_spy_12m FROM indicators_daily i LEFT JOIN companies c ON c.symbol = i.symbol WHERE i.date = ?"
  );
  const updateRanks = db.prepare(
    "UPDATE indicators_daily SET industry_rank_1m=?, industry_rank_3m=?, industry_rank_6m=?, industry_rank_12m=?, sector_rank_1m=?, sector_rank_3m=?, sector_rank_6m=?, sector_rank_12m=?, rs_pct_1w=?, rs_pct_1m=?, rs_pct_3m=?, rs_pct_6m=?, rs_pct_12m=? WHERE symbol=? AND date=?"
  );

  const periods = ["1m", "3m", "6m", "12m"];
  for (let d = 0; d < dateList.length; d++) {
    const date = dateList[d];
    getIndForDate.bind([date]);
    const rows = [];
    while (getIndForDate.step()) {
      const r = getIndForDate.get();
      rows.push({
        symbol: r[0],
        industry: r[1],
        sector: r[2],
        rs1w: r[3],
        rs1m: r[4],
        rs3m: r[5],
        rs6m: r[6],
        rs12m: r[7],
      });
    }
    getIndForDate.reset();

    const byIndustry = new Map();
    const bySector = new Map();
    for (const r of rows) {
      if (r.industry) {
        if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []);
        byIndustry.get(r.industry).push(r);
      }
      if (r.sector) {
        if (!bySector.has(r.sector)) bySector.set(r.sector, []);
        bySector.get(r.sector).push(r);
      }
    }

    for (const [, list] of byIndustry) {
      list.sort((a, b) => (b.rs1m ?? -1e9) - (a.rs1m ?? -1e9));
      list.forEach((r, i) => {
        r.industry_rank_1m = i + 1;
      });
      list.sort((a, b) => (b.rs3m ?? -1e9) - (a.rs3m ?? -1e9));
      list.forEach((r, i) => {
        r.industry_rank_3m = i + 1;
      });
      list.sort((a, b) => (b.rs6m ?? -1e9) - (a.rs6m ?? -1e9));
      list.forEach((r, i) => {
        r.industry_rank_6m = i + 1;
      });
      list.sort((a, b) => (b.rs12m ?? -1e9) - (a.rs12m ?? -1e9));
      list.forEach((r, i) => {
        r.industry_rank_12m = i + 1;
      });
    }
    for (const [, list] of bySector) {
      list.sort((a, b) => (b.rs1m ?? -1e9) - (a.rs1m ?? -1e9));
      list.forEach((r, i) => {
        r.sector_rank_1m = i + 1;
      });
      list.sort((a, b) => (b.rs3m ?? -1e9) - (a.rs3m ?? -1e9));
      list.forEach((r, i) => {
        r.sector_rank_3m = i + 1;
      });
      list.sort((a, b) => (b.rs6m ?? -1e9) - (a.rs6m ?? -1e9));
      list.forEach((r, i) => {
        r.sector_rank_6m = i + 1;
      });
      list.sort((a, b) => (b.rs12m ?? -1e9) - (a.rs12m ?? -1e9));
      list.forEach((r, i) => {
        r.sector_rank_12m = i + 1;
      });
    }

    for (const col of ["rs1w", "rs1m", "rs3m", "rs6m", "rs12m"]) {
      const pctCol = "rs_pct_" + col.replace("rs", "");
      rows.sort((a, b) => (b[col] ?? -1e9) - (a[col] ?? -1e9));
      const total = rows.length;
      rows.forEach((r, idx) => {
        r[pctCol] = total > 0 ? ((total - idx) / total) * 100 : null;
      });
    }

    for (const r of rows) {
      updateRanks.bind([
        r.industry_rank_1m ?? null,
        r.industry_rank_3m ?? null,
        r.industry_rank_6m ?? null,
        r.industry_rank_12m ?? null,
        r.sector_rank_1m ?? null,
        r.sector_rank_3m ?? null,
        r.sector_rank_6m ?? null,
        r.sector_rank_12m ?? null,
        r.rs_pct_1w ?? null,
        r.rs_pct_1m ?? null,
        r.rs_pct_3m ?? null,
        r.rs_pct_6m ?? null,
        r.rs_pct_12m ?? null,
        r.symbol,
        date,
      ]);
      updateRanks.step();
      updateRanks.reset();
    }

    if ((d + 1) % 100 === 0 || d === dateList.length - 1) {
      process.stdout.write("  dates: " + (d + 1) + "/" + dateList.length + "\r");
    }
  }

  getIndForDate.free();
  updateRanks.free();

  console.log("\n  Ranks done.");

  console.log("\nWriting database...");
  writeDatabaseChunked(db, DB_PATH);
  db.close();
  console.log("Compute indicators complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
