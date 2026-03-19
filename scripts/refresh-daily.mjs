#!/usr/bin/env node
/**
 * Daily refresh for large screener.db files.
 * - Fetches latest daily bars from Polygon into daily_bars
 * - Recomputes latest-day quote_daily + indicators_daily rows
 * - Recomputes latest-day industry/sector ranks + RS percentiles
 *
 * Uses better-sqlite3 (on-disk), so it supports multi-GB DB files.
 *
 * Run: node scripts/refresh-daily.mjs [--limit N]
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

const USING_CUSTOM_DB = Boolean(process.env.SCREENER_DB_PATH);

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
const MIN_COVERAGE_PCT = Number(process.env.DAILY_REFRESH_MIN_COVERAGE_PCT ?? 80);
const COVERAGE_LOOKBACK_DATES = Number(process.env.DAILY_REFRESH_COVERAGE_LOOKBACK_DATES ?? 10);
const COMPANY_REFERENCE_ENRICH_LIMIT = Number(process.env.DAILY_REFRESH_COMPANY_REFERENCE_LIMIT ?? 200);
const COMPANY_REFERENCE_DELAY_MS = Number(process.env.DAILY_REFRESH_COMPANY_REFERENCE_DELAY_MS ?? 80);
const REFRESH_INDEX_CONSTITUENTS = String(process.env.DAILY_REFRESH_INDEX_CONSTITUENTS ?? "1") !== "0";
const REFRESH_THEMATIC_ETF_CONSTITUENTS =
  String(process.env.DAILY_REFRESH_THEMATIC_ETF_CONSTITUENTS ?? "1") !== "0";
const REQUIRED_ETF_SYMBOLS = [
  "SPY",
  "QQQ",
  "IWM",
  "BOTZ",
  "SMH",
  "SKYY",
  "CIBR",
  "DTCR",
  "SNSR",
  "QTUM",
  "ARKX",
  "ARKK",
  "XOP",
  "ICLN",
  "TAN",
  "URA",
  "HYDR",
  "PHO",
  "LIT",
  "PAVE",
  "ITA",
  "GRID",
  "GDX",
  "SIL",
  "COPX",
  "REMX",
  "MOO",
  "IBIT",
  "BLOK",
  "FINX",
  "XBI",
  "OZEM",
  "MSOS",
  "BETZ",
  "ESPO",
  "ITB",
  "JETS",
  "SOCL",
  "IBUY",
  "KWEB",
  "INDA",
];

const BASE = "https://api.polygon.io";
function url(path, params = {}) {
  const search = new URLSearchParams({ ...params, apiKey: API_KEY });
  return `${BASE}${path}?${search}`;
}

const MAX_RETRIES = 3;

async function fetchWithRetry(fetchUrl, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(fetchUrl);
      if (res.status === 429) {
        const wait = Math.min(2000 * attempt, 10000);
        console.warn(`  Rate limited, waiting ${wait}ms (attempt ${attempt}/${retries})`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = 1000 * attempt;
      console.warn(`  Network error, retry in ${wait}ms: ${err.message}`);
      await sleep(wait);
    }
  }
  return null;
}

async function fetchDailyBars(symbol, from, to) {
  const res = await fetchWithRetry(
    url(`/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}`, {
      adjusted: "true",
      sort: "asc",
      limit: "50000",
    })
  );
  if (!res || !res.ok) return [];
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

async function fetchTickerReference(symbol) {
  const res = await fetchWithRetry(url(`/v3/reference/tickers/${encodeURIComponent(symbol)}`));
  if (!res || !res.ok) return null;
  const data = await res.json();
  return data?.results ?? null;
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

function runScript(relativeScriptPath) {
  const scriptPath = join(root, relativeScriptPath);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${relativeScriptPath} exited with code ${result.status ?? "unknown"}`);
  }
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Missing screener DB at ${DB_PATH}. Run: npm run init-screener-db && npm run seed-companies`);
    process.exit(1);
  }
  if (USING_CUSTOM_DB) {
    console.log("Using SCREENER_DB_PATH:", DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000");
  db.pragma("busy_timeout = 10000");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_daily_bars_symbol_date ON daily_bars(symbol, date);
    CREATE INDEX IF NOT EXISTS idx_quote_daily_date_symbol ON quote_daily(date, symbol);
    CREATE INDEX IF NOT EXISTS idx_indicators_daily_date_symbol ON indicators_daily(date, symbol);
  `);

  let symbols = db.prepare("SELECT symbol FROM companies ORDER BY symbol").all().map((r) => String(r.symbol));
  symbols = Array.from(new Set([...symbols.map((s) => s.toUpperCase()), ...REQUIRED_ETF_SYMBOLS]));
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }

  // Keep company reference fields fresh for newly-added symbols and any historical gaps.
  // Full historical catch-up should be done with: npm run enrich-company-reference
  if (COMPANY_REFERENCE_ENRICH_LIMIT > 0) {
    const candidates = db
      .prepare(
        `
        SELECT symbol
        FROM companies
        WHERE
          ipo_date IS NULL OR TRIM(ipo_date) = ''
          OR shares_outstanding IS NULL OR shares_outstanding <= 0
        ORDER BY symbol
        LIMIT ?
        `
      )
      .all(COMPANY_REFERENCE_ENRICH_LIMIT)
      .map((r) => String(r.symbol).toUpperCase());

    if (candidates.length > 0) {
      console.log(`Enriching company reference fields for up to ${candidates.length} symbols...`);
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
      const updateCompanyTx = db.transaction((patches) => {
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

      let ok = 0;
      let emptyOrFailed = 0;
      const now = new Date().toISOString();
      const patches = [];
      for (let i = 0; i < candidates.length; i++) {
        const sym = candidates[i];
        const ref = await fetchTickerReference(sym);
        if (ref) {
          patches.push({
            symbol: sym,
            name: ref.name ?? null,
            exchange: ref.primary_exchange ?? null,
            industry: ref.sic_description ?? null,
            sector: null,
            ipoDate: ref.list_date ?? null,
            sharesOutstanding:
              ref.share_class_shares_outstanding != null
                ? Number(ref.share_class_shares_outstanding)
                : ref.weighted_shares_outstanding != null
                  ? Number(ref.weighted_shares_outstanding)
                  : null,
            now,
          });
          ok++;
        } else {
          emptyOrFailed++;
        }
        if (patches.length >= 100) updateCompanyTx(patches.splice(0, patches.length));
        if ((i + 1) % 50 === 0 || i === candidates.length - 1) {
          process.stdout.write(`  company_ref: ${i + 1}/${candidates.length}\r`);
        }
        await sleep(COMPANY_REFERENCE_DELAY_MS);
      }
      if (patches.length > 0) updateCompanyTx(patches);
      console.log("");
      console.log(`Company reference enrichment: ok=${ok}, empty_or_failed=${emptyOrFailed}`);
    }
  }

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 420);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  const upsertBar = db.prepare(
    "INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const upsertBarsTx = db.transaction((sym, bars) => {
    for (const b of bars) {
      upsertBar.run(sym, b.date, b.open, b.high, b.low, b.close, b.volume);
    }
  });

  let fetchOkCount = 0;
  let fetchEmptyCount = 0;
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const bars = await fetchDailyBars(sym, fromStr, toStr);
    if (bars.length > 0) fetchOkCount++;
    else fetchEmptyCount++;
    upsertBarsTx(sym, bars);
    if ((i + 1) % 50 === 0 || i === symbols.length - 1) {
      process.stdout.write(`  daily_bars: ${i + 1}/${symbols.length}\r`);
    }
    await sleep(120);
  }
  console.log("");
  console.log(`Fetched bars: ok=${fetchOkCount}, empty_or_failed=${fetchEmptyCount}`);

  const latestDateRow = db.prepare("SELECT MAX(date) AS d FROM daily_bars").get();
  const rawLatestDate = latestDateRow?.d;
  if (!rawLatestDate) {
    console.error("No latest date found in daily_bars.");
    db.close();
    process.exit(1);
  }

  // Coverage guard + date selection:
  // if the newest date is partial (intraday/incomplete fetch), use the latest reliable recent date.
  const expectedSymbols = symbols.length;
  const minCoverageAbs = Math.max(200, Math.floor((expectedSymbols * MIN_COVERAGE_PCT) / 100));
  const recentCoverageRows = db
    .prepare(
      `
      WITH recent_dates AS (
        SELECT date
        FROM daily_bars
        GROUP BY date
        ORDER BY date DESC
        LIMIT ?
      )
      SELECT rd.date AS date, COUNT(d.symbol) AS c
      FROM recent_dates rd
      LEFT JOIN daily_bars d ON d.date = rd.date
      GROUP BY rd.date
      ORDER BY rd.date DESC
      `
    )
    .all(COVERAGE_LOOKBACK_DATES);

  if (!recentCoverageRows.length) {
    console.error("No recent coverage rows found in daily_bars.");
    db.close();
    process.exit(1);
  }

  const reliableRow = recentCoverageRows.find((r) => Number(r.c ?? 0) >= minCoverageAbs);
  if (!reliableRow) {
    const summary = recentCoverageRows
      .map((r) => `${r.date}:${r.c}`)
      .join(", ");
    console.error(
      `Coverage too low across recent dates. Minimum required: ${minCoverageAbs}/${expectedSymbols} (${MIN_COVERAGE_PCT}%). Recent: ${summary}. Aborting to avoid partial screener snapshot.`
    );
    db.close();
    process.exit(1);
  }

  const latestDate = String(reliableRow.date);
  const latestCoverage = Number(reliableRow.c ?? 0);
  const rawLatestCoverage =
    Number(recentCoverageRows.find((r) => String(r.date) === String(rawLatestDate))?.c ?? 0);
  if (String(rawLatestDate) !== latestDate) {
    console.log(
      `Latest raw date ${rawLatestDate} is partial (${rawLatestCoverage}/${expectedSymbols}); using reliable date ${latestDate} (${latestCoverage}/${expectedSymbols}).`
    );
  }
  console.log(
    `Coverage check passed for ${latestDate}: ${latestCoverage}/${expectedSymbols} (${((latestCoverage / expectedSymbols) * 100).toFixed(2)}%)`
  );

  const indCols = new Set(db.prepare("PRAGMA table_info(indicators_daily)").all().map((r) => r.name));
  for (const col of ["rs_pct_1w", "rs_pct_1m", "rs_pct_3m", "rs_pct_6m", "rs_pct_12m"]) {
    if (!indCols.has(col)) db.exec(`ALTER TABLE indicators_daily ADD COLUMN ${col} REAL`);
  }

  const quoteCols = new Set(db.prepare("PRAGMA table_info(quote_daily)").all().map((r) => r.name));
  if (!quoteCols.has("prev_close")) {
    db.exec("ALTER TABLE quote_daily ADD COLUMN prev_close REAL");
    console.log("  Added prev_close column to quote_daily");
  }

  const upsertQuote = db.prepare(`
    INSERT OR REPLACE INTO quote_daily (symbol, date, market_cap, last_price, change_pct, volume, avg_volume_30d_shares, high_52w, off_52w_high_pct, atr_pct_21d, free_float, prev_close)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      rs_vs_spy_1w, rs_vs_spy_1m, rs_vs_spy_3m, rs_vs_spy_6m, rs_vs_spy_12m
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getBarsStmt = db.prepare(
    "SELECT date, open, high, low, close, volume FROM daily_bars WHERE symbol = ? AND date <= ? ORDER BY date"
  );
  const getQuoteStmt = db.prepare("SELECT market_cap, last_price, volume FROM quote_daily WHERE symbol = ? AND date = ?");
  const getSharesStmt = db.prepare("SELECT shares_outstanding FROM companies WHERE symbol = ?");
  const companyMap = new Map(db.prepare("SELECT symbol, industry, sector FROM companies").all().map((r) => [r.symbol, r]));

  const spyBarsList = db
    .prepare("SELECT date, close FROM daily_bars WHERE symbol = 'SPY' ORDER BY date")
    .all()
    .map((r) => ({ date: r.date, close: r.close }));
  const spyIndexByDate = new Map(spyBarsList.map((r, i) => [r.date, i]));

  const indicatorRows = [];
  const pctFrom = (close, ema) => (ema ? ((close - ema) / ema) * 100 : null);
  const spread = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const rs = (stock, spy) =>
    stock != null && spy != null ? ((1 + stock / 100) / (1 + spy / 100)) * 100 : null;

  const calcTx = db.transaction(() => {
    for (const sym of symbols) {
      const bars = getBarsStmt.all(sym, latestDate).map((r) => ({
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }));
      if (bars.length === 0) continue;

      const lastBar = bars[bars.length - 1];
      if (lastBar.date !== latestDate) continue;

      const q = getQuoteStmt.get(sym, latestDate);
      const sharesRow = getSharesStmt.get(sym);
      const sharesOutstanding =
        sharesRow?.shares_outstanding != null ? Number(sharesRow.shares_outstanding) : null;
      const marketCap =
        q?.market_cap != null && Number(q.market_cap) > 0
          ? Number(q.market_cap)
          : sharesOutstanding != null && sharesOutstanding > 0
            ? sharesOutstanding * lastBar.close
            : null;
      const lastPrice = q?.last_price ?? lastBar.close;
      const volume = q?.volume ?? lastBar.volume;
      const prevClose = bars.length >= 2 ? bars[bars.length - 2].close : lastBar.close;
      const changePct = prevClose ? ((lastBar.close - prevClose) / prevClose) * 100 : null;
      const vol30 = bars.slice(-30).map((b) => b.volume);
      const avgVol30 = vol30.length ? vol30.reduce((a, b) => a + b, 0) / vol30.length : null;
      const high52w = Math.max(...bars.slice(-252).map((b) => b.high));
      const off52w = high52w ? ((high52w - lastBar.close) / high52w) * 100 : null;
      const atr21Arr = computeATR(bars, 21);
      const atr21 = atr21Arr[atr21Arr.length - 1];
      const atrPct21 = lastBar.close && atr21 ? (atr21 / lastBar.close) * 100 : null;

      upsertQuote.run(
        sym,
        latestDate,
        marketCap,
        lastPrice,
        changePct,
        volume,
        avgVol30,
        high52w,
        off52w,
        atrPct21,
        null,
        prevClose
      );

      const ema20Arr = computeEMA(bars, "close", 20);
      const ema50Arr = computeEMA(bars, "close", 50);
      const ema100Arr = computeEMA(bars, "close", 100);
      const ema200Arr = computeEMA(bars, "close", 200);
      const ema20 = ema20Arr[ema20Arr.length - 1];
      const ema50 = ema50Arr[ema50Arr.length - 1];
      const ema100 = ema100Arr[ema100Arr.length - 1];
      const ema200 = ema200Arr[ema200Arr.length - 1];

      const close5 = bars.length >= 6 ? bars[bars.length - 6].close : null;
      const close21 = bars.length >= 22 ? bars[bars.length - 22].close : null;
      const close63 = bars.length >= 64 ? bars[bars.length - 64].close : null;
      const close126 = bars.length >= 127 ? bars[bars.length - 127].close : null;
      const close252 = bars.length >= 253 ? bars[bars.length - 253].close : null;

      const ch1w = close5 ? ((lastBar.close - close5) / close5) * 100 : null;
      const ch1m = close21 ? ((lastBar.close - close21) / close21) * 100 : null;
      const ch3m = close63 ? ((lastBar.close - close63) / close63) * 100 : null;
      const ch6m = close126 ? ((lastBar.close - close126) / close126) * 100 : null;
      const ch12m = close252 ? ((lastBar.close - close252) / close252) * 100 : null;

      const vol1w = bars.slice(-5).map((b) => b.volume);
      const vol1m = bars.slice(-21).map((b) => b.volume);
      const avgVol1w = vol1w.length ? vol1w.reduce((a, b) => a + b, 0) / vol1w.length : null;
      const avgVol1m = vol1m.length ? vol1m.reduce((a, b) => a + b, 0) / vol1m.length : null;
      const atr14Arr = computeATR(bars, 14);
      const atr14 = atr14Arr[atr14Arr.length - 1];
      const atrPct14 = lastBar.close && atr14 ? (atr14 / lastBar.close) * 100 : null;

      const spyIdx = spyIndexByDate.get(latestDate);
      const spyClose = spyIdx != null ? spyBarsList[spyIdx]?.close : null;
      const spyClose5 = spyIdx != null && spyIdx >= 5 ? spyBarsList[spyIdx - 5]?.close : null;
      const spyClose21 = spyIdx != null && spyIdx >= 21 ? spyBarsList[spyIdx - 21]?.close : null;
      const spyClose63 = spyIdx != null && spyIdx >= 63 ? spyBarsList[spyIdx - 63]?.close : null;
      const spyClose126 = spyIdx != null && spyIdx >= 126 ? spyBarsList[spyIdx - 126]?.close : null;
      const spyClose252 = spyIdx != null && spyIdx >= 252 ? spyBarsList[spyIdx - 252]?.close : null;

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
        rs12m
      );

      const company = companyMap.get(sym) ?? {};
      indicatorRows.push({
        symbol: sym,
        industry: company.industry ?? null,
        sector: company.sector ?? null,
        rs1w: rs1w ?? -1e9,
        rs1m: rs1m ?? -1e9,
        rs3m: rs3m ?? -1e9,
        rs6m: rs6m ?? -1e9,
        rs12m: rs12m ?? -1e9,
      });
    }
  });
  calcTx();

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

  for (const [, list] of byIndustry) {
    list.sort((a, b) => b.rs1m - a.rs1m);
    list.forEach((r, i) => (r.industry_rank_1m = i + 1));
    list.sort((a, b) => b.rs3m - a.rs3m);
    list.forEach((r, i) => (r.industry_rank_3m = i + 1));
    list.sort((a, b) => b.rs6m - a.rs6m);
    list.forEach((r, i) => (r.industry_rank_6m = i + 1));
    list.sort((a, b) => b.rs12m - a.rs12m);
    list.forEach((r, i) => (r.industry_rank_12m = i + 1));
  }
  for (const [, list] of bySector) {
    list.sort((a, b) => b.rs1m - a.rs1m);
    list.forEach((r, i) => (r.sector_rank_1m = i + 1));
    list.sort((a, b) => b.rs3m - a.rs3m);
    list.forEach((r, i) => (r.sector_rank_3m = i + 1));
    list.sort((a, b) => b.rs6m - a.rs6m);
    list.forEach((r, i) => (r.sector_rank_6m = i + 1));
    list.sort((a, b) => b.rs12m - a.rs12m);
    list.forEach((r, i) => (r.sector_rank_12m = i + 1));
  }

  const total = indicatorRows.length;
  const pctCols = [
    ["rs1w", "rs_pct_1w"],
    ["rs1m", "rs_pct_1m"],
    ["rs3m", "rs_pct_3m"],
    ["rs6m", "rs_pct_6m"],
    ["rs12m", "rs_pct_12m"],
  ];
  for (const [col, pctCol] of pctCols) {
    indicatorRows.sort((a, b) => b[col] - a[col]);
    indicatorRows.forEach((r, idx) => {
      r[pctCol] = total > 0 ? ((total - idx) / total) * 100 : null;
    });
  }

  const updateRank = db.prepare(
    `UPDATE indicators_daily SET industry_rank_1m=?, industry_rank_3m=?, industry_rank_6m=?, industry_rank_12m=?, sector_rank_1m=?, sector_rank_3m=?, sector_rank_6m=?, sector_rank_12m=?, rs_pct_1w=?, rs_pct_1m=?, rs_pct_3m=?, rs_pct_6m=?, rs_pct_12m=? WHERE symbol=? AND date=?`
  );
  const ranksTx = db.transaction(() => {
    for (const r of indicatorRows) {
      updateRank.run(
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
        latestDate
      );
    }
  });
  ranksTx();

  // Strict freshness guard: daily refresh should keep these tables on the same selected latestDate.
  const latestQuoteDateRow = db.prepare("SELECT MAX(date) AS d FROM quote_daily").get();
  const latestIndicatorsDateRow = db.prepare("SELECT MAX(date) AS d FROM indicators_daily").get();
  const latestQuoteDate = latestQuoteDateRow?.d ? String(latestQuoteDateRow.d) : null;
  const latestIndicatorsDate = latestIndicatorsDateRow?.d ? String(latestIndicatorsDateRow.d) : null;
  if (latestQuoteDate !== latestDate || latestIndicatorsDate !== latestDate) {
    db.close();
    throw new Error(
      `Post-refresh freshness check failed. Expected quote_daily and indicators_daily at ${latestDate}, got quote_daily=${latestQuoteDate}, indicators_daily=${latestIndicatorsDate}.`
    );
  }

  const quoteCoverage = Number(
    db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM quote_daily WHERE date = ?").get(latestDate)?.c ?? 0
  );
  const indicatorCoverage = Number(
    db.prepare("SELECT COUNT(DISTINCT symbol) AS c FROM indicators_daily WHERE date = ?").get(latestDate)?.c ?? 0
  );
  if (quoteCoverage < minCoverageAbs || indicatorCoverage < minCoverageAbs) {
    db.close();
    throw new Error(
      `Post-refresh coverage check failed for ${latestDate}. quote_daily=${quoteCoverage}, indicators_daily=${indicatorCoverage}, required minimum=${minCoverageAbs}.`
    );
  }

  console.log("Running WAL checkpoint...");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  db.close();

  if (REFRESH_INDEX_CONSTITUENTS) {
    try {
      console.log("Refreshing index constituents...");
      runScript("scripts/build-index-constituents.mjs");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Warning: index constituents refresh failed (${msg}). Keeping existing files.`);
    }
  }

  if (REFRESH_THEMATIC_ETF_CONSTITUENTS) {
    try {
      console.log("Refreshing thematic ETF constituents...");
      runScript("scripts/build-thematic-etf-constituents.mjs");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Warning: thematic ETF constituents refresh failed (${msg}). Keeping existing file.`);
    }
  }

  console.log("Daily refresh done. Latest date:", latestDate, "| Symbols processed:", symbols.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

