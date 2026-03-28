#!/usr/bin/env node
/**
 * Backfill gaps in daily_bars and add historical data for ETFs.
 *
 * Targets:
 *  1. All REQUIRED_ETF_SYMBOLS — full 10-year history if missing.
 *  2. SPY and any other symbol with intra-history gaps > GAP_THRESHOLD days.
 *  3. Optionally, any symbol whose earliest bar is less than MIN_HISTORY_YEARS
 *     ago (use --all-short to enable).
 *
 * Uses better-sqlite3 (on-disk) so it works with multi-GB DBs.
 *
 * Run:
 *   node scripts/backfill-gaps.mjs                # backfill ETFs + fill gaps
 *   node scripts/backfill-gaps.mjs --dry-run      # report only, no writes
 *   node scripts/backfill-gaps.mjs --symbols SPY,QQQ   # specific symbols only
 *   node scripts/backfill-gaps.mjs --recompute    # recompute indicators after
 */

import { createRequire } from "module";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

/* ── env ─────────────────────────────────────────────────────────────── */

function loadEnvLocal() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
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

/* ── CLI args ────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RECOMPUTE = args.includes("--recompute");
const symIdx = args.indexOf("--symbols");
const ONLY_SYMBOLS = symIdx >= 0 && args[symIdx + 1]
  ? new Set(args[symIdx + 1].split(",").map((s) => s.trim().toUpperCase()))
  : null;

/* ── constants ───────────────────────────────────────────────────────── */

const GAP_THRESHOLD_DAYS = 10;
const MIN_HISTORY_YEARS = 10;
const API_DELAY_MS = 120;
const MAX_RETRIES = 3;

const REQUIRED_ETF_SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA",
  "XLK", "XLF", "XLV", "XLY", "XLP", "XLC", "XLI", "XLE", "XLB", "XLRE", "XLU",
  "ITA", "JETS", "CARZ", "KBE", "KRE", "PBJ", "XBI", "KCE", "XPH", "BETZ",
  "GDX", "IHF", "ITB", "KIE", "IHI", "XME", "XOP", "VNQ", "SMH", "IGV",
  "XRT", "IYZ", "IYT",
  "BOTZ", "SKYY", "CIBR", "DTCR", "SNSR", "QTUM", "ARKX", "ARKK",
  "ICLN", "TAN", "URA", "HYDR", "PHO", "LIT", "PAVE", "GRID",
  "SIL", "COPX", "REMX", "MOO", "IBIT", "BLOK", "FINX", "OZEM",
  "MSOS", "ESPO", "SOCL", "IBUY", "KWEB", "INDA",
];

/* ── Polygon helpers ─────────────────────────────────────────────────── */

const BASE = "https://api.polygon.io";
function apiUrl(path, params = {}) {
  const search = new URLSearchParams({ ...params, apiKey: API_KEY });
  return `${BASE}${path}?${search}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    apiUrl(`/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}`, {
      adjusted: "true",
      sort: "asc",
      limit: "50000",
    })
  );
  if (!res || !res.ok) {
    if (res) console.warn(`  ${symbol}: HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  return (data.results ?? []).map((b) => ({
    date: new Date(b.t).toISOString().slice(0, 10),
    open: b.o ?? 0,
    high: b.h ?? 0,
    low: b.l ?? 0,
    close: b.c ?? 0,
    volume: b.v ?? 0,
  }));
}

/* ── gap detection ───────────────────────────────────────────────────── */

function detectGaps(db, symbol) {
  const rows = db
    .prepare("SELECT date FROM daily_bars WHERE symbol = ? ORDER BY date")
    .all(symbol);
  if (!rows.length) return { dates: [], gaps: [], minDate: null, maxDate: null, count: 0 };
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].date);
    const curr = new Date(rows[i].date);
    const diffDays = (curr - prev) / 86400000;
    if (diffDays > GAP_THRESHOLD_DAYS) {
      gaps.push({
        from: rows[i - 1].date,
        to: rows[i].date,
        days: diffDays,
      });
    }
  }
  return {
    dates: rows.map((r) => r.date),
    gaps,
    minDate: rows[0].date,
    maxDate: rows[rows.length - 1].date,
    count: rows.length,
  };
}

/* ── main ────────────────────────────────────────────────────────────── */

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error("Missing screener.db. Run: npm run init-screener-db && npm run seed-companies");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");

  db.exec(`CREATE TABLE IF NOT EXISTS daily_bars (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume INTEGER,
    PRIMARY KEY (symbol, date)
  )`);

  const today = new Date().toISOString().slice(0, 10);
  const tenYearsAgo = new Date();
  tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - MIN_HISTORY_YEARS);
  const historyStart = tenYearsAgo.toISOString().slice(0, 10);

  /* ── Phase 1: Determine work items ─────────────────────────────────── */

  const workItems = []; // { symbol, ranges: [{ from, to }], reason }

  const etfSet = new Set(REQUIRED_ETF_SYMBOLS);
  const symbolsToCheck = ONLY_SYMBOLS
    ? [...ONLY_SYMBOLS]
    : [...REQUIRED_ETF_SYMBOLS];

  if (!ONLY_SYMBOLS) {
    const allSymbols = db
      .prepare(
        `SELECT DISTINCT symbol FROM daily_bars
         UNION
         SELECT symbol FROM companies`
      )
      .all()
      .map((r) => r.symbol);
    for (const sym of allSymbols) {
      if (!etfSet.has(sym)) symbolsToCheck.push(sym);
    }
  }

  console.log(`Scanning ${symbolsToCheck.length} symbols for gaps and missing history...\n`);

  for (const symbol of symbolsToCheck) {
    const info = detectGaps(db, symbol);
    const ranges = [];
    const reasons = [];

    const isETF = etfSet.has(symbol);
    const isExplicit = ONLY_SYMBOLS?.has(symbol);
    const needsHistory = isETF || isExplicit;

    if (info.count === 0 && needsHistory) {
      ranges.push({ from: historyStart, to: today });
      reasons.push("no data");
    } else if (info.count > 0) {
      if (needsHistory && info.minDate > historyStart) {
        ranges.push({ from: historyStart, to: info.minDate });
        reasons.push(`extend history back to ${historyStart}`);
      }

      for (const gap of info.gaps) {
        if (gap.days > GAP_THRESHOLD_DAYS) {
          ranges.push({ from: gap.from, to: gap.to });
          reasons.push(`gap ${gap.from} -> ${gap.to} (${gap.days}d)`);
        }
      }
    }

    if (ranges.length > 0) {
      workItems.push({ symbol, ranges, reasons });
    }
  }

  /* ── Phase 2: Report ───────────────────────────────────────────────── */

  const etfWork = workItems.filter((w) => etfSet.has(w.symbol));
  const stockWork = workItems.filter((w) => !etfSet.has(w.symbol));

  console.log("=== ETFs needing backfill ===");
  for (const w of etfWork) {
    console.log(`  ${w.symbol}: ${w.reasons.join("; ")}`);
  }
  console.log(`  Total: ${etfWork.length} ETFs\n`);

  console.log(`=== Stocks with gaps > ${GAP_THRESHOLD_DAYS} days ===`);
  console.log(`  Total: ${stockWork.length} stocks with gaps\n`);
  for (const w of stockWork.slice(0, 20)) {
    console.log(`  ${w.symbol}: ${w.reasons.join("; ")}`);
  }
  if (stockWork.length > 20) {
    console.log(`  ... and ${stockWork.length - 20} more\n`);
  }

  const totalRanges = workItems.reduce((n, w) => n + w.ranges.length, 0);
  console.log(`\nTotal: ${workItems.length} symbols, ${totalRanges} API calls needed.\n`);

  if (DRY_RUN) {
    console.log("Dry run — no data written.");
    db.close();
    return;
  }

  /* ── Phase 3: Fetch and insert ─────────────────────────────────────── */

  const insertBar = db.prepare(
    "INSERT OR REPLACE INTO daily_bars (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  const insertMany = db.transaction((bars, sym) => {
    for (const b of bars) {
      insertBar.run(sym, b.date, b.open, b.high, b.low, b.close, b.volume);
    }
  });

  let totalInserted = 0;
  let apiCalls = 0;

  const allWork = [...etfWork, ...stockWork];

  for (let i = 0; i < allWork.length; i++) {
    const { symbol, ranges } = allWork[i];
    let symbolBars = 0;

    for (const range of ranges) {
      try {
        const bars = await fetchDailyBars(symbol, range.from, range.to);
        if (bars.length > 0) {
          insertMany(bars, symbol);
          symbolBars += bars.length;
        }
        apiCalls++;
      } catch (e) {
        console.warn(`  ${symbol} [${range.from} -> ${range.to}]: ${e.message}`);
      }
      await sleep(API_DELAY_MS);
    }

    totalInserted += symbolBars;
    const pct = (((i + 1) / allWork.length) * 100).toFixed(1);
    if (symbolBars > 0) {
      console.log(`  [${pct}%] ${symbol}: +${symbolBars} bars`);
    } else {
      process.stdout.write(`  [${pct}%] ${symbol}: no new bars\r`);
    }
  }

  console.log(`\nBackfill complete: ${totalInserted} bars inserted across ${allWork.length} symbols (${apiCalls} API calls).`);

  db.exec("ANALYZE");
  db.close();

  if (RECOMPUTE) {
    console.log("\nRecomputing indicators...");
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "compute-indicators-from-bars.mjs"), "--years", "10"],
      { stdio: "inherit", cwd: root, env: { ...process.env, NODE_OPTIONS: "" } }
    );
    if (result.status !== 0) {
      console.error("compute-indicators exited with", result.status);
      process.exit(result.status ?? 1);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
