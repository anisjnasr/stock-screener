#!/usr/bin/env node
/**
 * Daily refresh: fetch daily bars from Polygon, upsert daily_bars, quote_daily, indicators_daily.
 * Run: node scripts/refresh-daily.mjs [--limit N]  or  npm run refresh-daily
 * Requires: MASSIVE_API_KEY, data/screener.db, companies seeded.
 * Use --limit N to refresh only first N symbols (for testing).
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

function computeEMA(bars, key = "close", period) {
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
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 400);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  const insertBar = db.prepare(
    "INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  // 1) Fetch SPY bars for RS benchmark
  console.log("Fetching SPY bars...");
  const spyBars = await fetchDailyBars("SPY", fromStr, toStr);
  for (const b of spyBars) {
    insertBar.bind(["SPY", b.date, b.open, b.high, b.low, b.close, b.volume]);
    insertBar.step();
    insertBar.reset();
  }
  insertBar.free();

  // 2) Fetch and upsert daily_bars for each symbol
  const insertBar2 = db.prepare(
    "INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const bars = await fetchDailyBars(sym, fromStr, toStr);
    for (const b of bars) {
      insertBar2.bind([sym, b.date, b.open, b.high, b.low, b.close, b.volume]);
      insertBar2.step();
      insertBar2.reset();
    }
    if ((i + 1) % 50 === 0 || i === symbols.length - 1) {
      process.stdout.write(`  daily_bars: ${i + 1}/${symbols.length}\r`);
    }
    await sleep(120);
  }
  insertBar2.free();

  let latestDate = toStr;
  if (symbols.length > 0) {
    const maxStmt = db.prepare("SELECT MAX(date) AS d FROM daily_bars WHERE symbol = ?");
    maxStmt.bind([symbols[0]]);
    if (maxStmt.step()) {
      const row = maxStmt.getAsObject();
      if (row.d) latestDate = row.d;
    }
    maxStmt.free();
  }

  const upsertQuote = db.prepare(`
    INSERT OR REPLACE INTO quote_daily (symbol, date, market_cap, last_price, change_pct, volume, avg_volume_30d_shares, high_52w, off_52w_high_pct, atr_pct_21d, free_float)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Ensure rs_pct columns exist (migration for existing DBs)
  const indInfo = db.exec("PRAGMA table_info(indicators_daily)");
  const indCols = new Set((indInfo[0]?.values ?? []).map((r) => r[1]));
  for (const col of ["rs_pct_1w", "rs_pct_1m", "rs_pct_3m", "rs_pct_6m", "rs_pct_12m"]) {
    if (!indCols.has(col)) {
      db.run(`ALTER TABLE indicators_daily ADD COLUMN ${col} REAL`);
    }
  }

  const upsertInd = db.prepare(`
    INSERT OR REPLACE INTO indicators_daily (
      symbol, date,
      price_change_1w_pct, price_change_1m_pct, price_change_3m_pct, price_change_6m_pct, price_change_12m_pct,
      avg_volume_1w, avg_volume_1m,
      atr_14, atr_pct_14, atr_21, atr_pct_21,
      ema_20, ema_50, ema_100, ema_200,
      above_ema_20, pct_from_ema_20, above_ema_50, pct_from_ema_50, above_ema_100, pct_from_ema_100, above_ema_200, pct_from_ema_200,
      ema_20_above_50, ema_20_50_spread_pct, ema_50_above_100, ema_50_100_spread_pct, ema_50_above_200, ema_50_200_spread_pct, ema_100_above_200, ema_100_200_spread_pct,
      rs_vs_spy_1w, rs_vs_spy_1m, rs_vs_spy_3m, rs_vs_spy_6m, rs_vs_spy_12m
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const allSymbolsForRanks = [...symbols];
  const indicatorRows = [];

  const getBarsStmt = db.prepare(
    "SELECT date, open, high, low, close, volume FROM daily_bars WHERE symbol = ? ORDER BY date"
  );
  for (let i = 0; i < allSymbolsForRanks.length; i++) {
    const sym = allSymbolsForRanks[i];
    getBarsStmt.bind([sym]);
    const bars = [];
    while (getBarsStmt.step()) {
      const r = getBarsStmt.get();
      bars.push({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] });
    }
    if (bars.length < 22) continue;

    const lastBar = bars[bars.length - 1];
    if (lastBar.date !== latestDate) continue;

    const idx = bars.findIndex((b) => b.date === latestDate);
    if (idx < 0) continue;
    const slice = bars.slice(0, idx + 1);

    const high52w = Math.max(...slice.slice(-252).map((b) => b.high));
    const prevClose = slice.length >= 2 ? slice[slice.length - 2].close : lastBar.close;
    const changePct = prevClose ? ((lastBar.close - prevClose) / prevClose) * 100 : null;
    const vol30 = slice.slice(-30).map((b) => b.volume);
    const avgVol30 = vol30.length ? vol30.reduce((a, b) => a + b, 0) / vol30.length : null;

    const atr21Arr = computeATR(slice, 21);
    const atr21 = atr21Arr[atr21Arr.length - 1];
    const atrPct21 = lastBar.close && atr21 ? (atr21 / lastBar.close) * 100 : null;
    const off52w = high52w ? ((high52w - lastBar.close) / high52w) * 100 : null;

    upsertQuote.bind([
      sym,
      latestDate,
      null,
      lastBar.close,
      changePct,
      lastBar.volume,
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

    const pctFrom = (close, ema) => (ema ? ((close - ema) / ema) * 100 : null);
    const spread = (a, b) => (b ? ((a - b) / b) * 100 : null);

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

    const spyRows = db.exec("SELECT date, close FROM daily_bars WHERE symbol = 'SPY' ORDER BY date");
    const spyBarsList = spyRows.length && spyRows[0].values ? spyRows[0].values : [];
    const spyIdx = spyBarsList.findIndex((r) => r[0] === latestDate);
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

    const rs = (stock, spy) =>
      stock != null && spy != null ? ((1 + stock / 100) / (1 + spy / 100)) * 100 : null;

    const rs1w = rs(ch1w, spyRet1w);
    const rs1m = rs(ch1m, spyRet1m);
    const rs3m = rs(ch3m, spyRet3m);
    const rs6m = rs(ch6m, spyRet6m);
    const rs12m = rs(ch12m, spyRet12m);

    const companyStmt = db.prepare("SELECT industry, sector FROM companies WHERE symbol = ?");
    companyStmt.bind([sym]);
    let industry = null;
    let sector = null;
    if (companyStmt.step()) {
      const r = companyStmt.get();
      industry = r[0];
      sector = r[1];
    }
    companyStmt.free();

    upsertInd.bind([
      sym,
      latestDate,
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
    ]);
    upsertInd.step();
    upsertInd.reset();

    indicatorRows.push({
      symbol: sym,
      industry,
      sector,
      rs1w: rs1w ?? -1e9,
      rs1m: rs1m ?? -1e9,
      rs3m: rs3m ?? -1e9,
      rs6m: rs6m ?? -1e9,
      rs12m: rs12m ?? -1e9,
    });
  }
  getBarsStmt.free();

  upsertQuote.free();
  upsertInd.free();

  const byIndustry = new Map();
  const bySector = new Map();
  for (const r of indicatorRows) {
    if (r.industry) {
      if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []);
      byIndustry.get(r.industry).push(r);
    }
    if (r.sector) {
      if (!bySector.has(r.sector)) bySector.set(r.sector, []);
      bySector.get(r.sector).push(r);
    }
  }
  for (const [industry, list] of byIndustry) {
    list.sort((a, b) => b.rs1m - a.rs1m);
    list.forEach((r, i) => {
      r.industry_rank_3m = i + 1;
    });
    list.sort((a, b) => b.rs6m - a.rs6m);
    list.forEach((r, i) => {
      r.industry_rank_6m = i + 1;
    });
    list.sort((a, b) => b.rs12m - a.rs12m);
    list.forEach((r, i) => {
      r.industry_rank_12m = i + 1;
    });
  }
  for (const [sector, list] of bySector) {
    list.sort((a, b) => b.rs1m - a.rs1m);
    list.forEach((r, i) => {
      r.sector_rank_1m = i + 1;
    });
    list.sort((a, b) => b.rs3m - a.rs3m);
    list.forEach((r, i) => {
      r.sector_rank_3m = i + 1;
    });
    list.sort((a, b) => b.rs6m - a.rs6m);
    list.forEach((r, i) => {
      r.sector_rank_6m = i + 1;
    });
    list.sort((a, b) => b.rs12m - a.rs12m);
    list.forEach((r, i) => {
      r.sector_rank_12m = i + 1;
    });
  }

  const updateRank = db.prepare(
    `UPDATE indicators_daily SET industry_rank_1m=?, industry_rank_3m=?, industry_rank_6m=?, industry_rank_12m=?, sector_rank_1m=?, sector_rank_3m=?, sector_rank_6m=?, sector_rank_12m=? WHERE symbol=? AND date=?`
  );
  for (const r of indicatorRows) {
    updateRank.bind([
      r.industry_rank_1m ?? null,
      r.industry_rank_3m ?? null,
      r.industry_rank_6m ?? null,
      r.industry_rank_12m ?? null,
      r.sector_rank_1m ?? null,
      r.sector_rank_3m ?? null,
      r.sector_rank_6m ?? null,
      r.sector_rank_12m ?? null,
      r.symbol,
      latestDate,
    ]);
    updateRank.step();
    updateRank.reset();
  }
  updateRank.free();

  // RS percentile: rank all stocks by rs_vs_spy (highest first), 90 = 90th percentile (top 10%)
  const rsCols = ["rs1w", "rs1m", "rs3m", "rs6m", "rs12m"];
  const rsPctCols = ["rs_pct_1w", "rs_pct_1m", "rs_pct_3m", "rs_pct_6m", "rs_pct_12m"];
  const total = indicatorRows.length;
  for (let i = 0; i < rsCols.length; i++) {
    const col = rsCols[i];
    const pctCol = rsPctCols[i];
    indicatorRows.sort((a, b) => b[col] - a[col]);
    const pctBySymbol = new Map();
    indicatorRows.forEach((r, idx) => {
      const pct = total > 0 ? ((total - idx) / total) * 100 : null;
      pctBySymbol.set(r.symbol, pct);
    });
    const updatePct = db.prepare(
      `UPDATE indicators_daily SET ${pctCol}=? WHERE symbol=? AND date=?`
    );
    for (const r of indicatorRows) {
      const pct = pctBySymbol.get(r.symbol);
      updatePct.bind([pct ?? null, r.symbol, latestDate]);
      updatePct.step();
      updatePct.reset();
    }
    updatePct.free();
  }

  writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log("\nDaily refresh done. Latest date:", latestDate);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
