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
 *   node scripts/backfill-gaps.mjs --strict-calendar    # include strict trading-day gaps from audit report
 *   node scripts/backfill-gaps.mjs --recompute    # recompute indicators after
 *   node scripts/backfill-gaps.mjs --fresh         # ignore resume checkpoint (start Phase 3 from scratch)
 */

import { createRequire } from "module";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
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
const FRESH = args.includes("--fresh");
const STRICT_CALENDAR = args.includes("--strict-calendar");
const symIdx = args.indexOf("--symbols");
const ONLY_SYMBOLS = symIdx >= 0 && args[symIdx + 1]
  ? new Set(args[symIdx + 1].split(",").map((s) => s.trim().toUpperCase()))
  : null;
const auditIdx = args.indexOf("--audit-file");
const AUDIT_FILE = auditIdx >= 0 && args[auditIdx + 1]
  ? args[auditIdx + 1]
  : join("data", "trading-gap-audit.json");

/* ── constants ───────────────────────────────────────────────────────── */

const GAP_THRESHOLD_DAYS = 10;
const MIN_HISTORY_YEARS = 10;
const API_DELAY_MS = 120;
const MAX_RETRIES = 5;
/** Abort hung TCP connections so a single Polygon call cannot stall the whole run. */
const REQUEST_TIMEOUT_MS = 120_000;
/** Flush WAL periodically so data is visible on disk between symbols. */
const WAL_CHECKPOINT_EVERY_SYMBOLS = 5;
const PROGRESS_VERSION = 1;
const PROGRESS_BASENAME = "backfill-gaps-progress.json";

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

function rangeKey(symbol, from, to) {
  return `${symbol}|${from}|${to}`;
}

function workFingerprint(allWork, strictCalendar) {
  const payload = {
    strict: strictCalendar,
    items: allWork.map((w) => ({ symbol: w.symbol, ranges: w.ranges })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function progressPath() {
  return join(root, "data", PROGRESS_BASENAME);
}

function loadProgress(expectedFingerprint) {
  const p = progressPath();
  if (!existsSync(p)) return { completed: new Set(), fingerprint: null };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (raw.v !== PROGRESS_VERSION || raw.fingerprint !== expectedFingerprint) {
      return { completed: new Set(), fingerprint: null };
    }
    const arr = Array.isArray(raw.completed) ? raw.completed : [];
    return { completed: new Set(arr), fingerprint: raw.fingerprint };
  } catch {
    return { completed: new Set(), fingerprint: null };
  }
}

function saveProgress(fingerprint, completedSet) {
  const dir = dirname(progressPath());
  mkdirSync(dir, { recursive: true });
  const tmp = `${progressPath()}.${process.pid}.tmp`;
  const body = JSON.stringify(
    {
      v: PROGRESS_VERSION,
      fingerprint,
      completed: [...completedSet],
      updatedAt: new Date().toISOString(),
    },
    null,
    0
  );
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, progressPath());
}

function removeProgressFile() {
  const p = progressPath();
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
}

async function fetchWithRetry(fetchUrl, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(fetchUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        if (attempt >= retries) return res;
        const wait = Math.min(2000 * attempt, 30_000);
        console.warn(`  Rate limited, waiting ${wait}ms (attempt ${attempt}/${retries})`);
        await sleep(wait);
        continue;
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        if (attempt < retries) {
          const wait = Math.min(1500 * attempt, 20_000);
          console.warn(`  HTTP ${res.status}, retry in ${wait}ms (${attempt}/${retries})`);
          await sleep(wait);
          continue;
        }
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      const aborted = err?.name === "AbortError";
      if (attempt === retries) throw err;
      const wait = Math.min(2000 * attempt, 30_000);
      if (aborted) {
        console.warn(`  Request timed out after ${REQUEST_TIMEOUT_MS}ms (attempt ${attempt}/${retries}), retry in ${wait}ms`);
      } else {
        console.warn(`  Network error, retry in ${wait}ms: ${err.message}`);
      }
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
    return { bars: [], status: res?.status ?? 0 };
  }
  const data = await res.json();
  const bars = (data.results ?? []).map((b) => ({
    date: new Date(b.t).toISOString().slice(0, 10),
    open: b.o ?? 0,
    high: b.h ?? 0,
    low: b.l ?? 0,
    close: b.c ?? 0,
    volume: b.v ?? 0,
  }));
  return { bars, status: res.status };
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

function normalizeRanges(ranges) {
  const keyset = new Set();
  const out = [];
  for (const r of ranges) {
    const from = String(r.from);
    const to = String(r.to);
    if (!from || !to || from > to) continue;
    const key = `${from}|${to}`;
    if (keyset.has(key)) continue;
    keyset.add(key);
    out.push({ from, to });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function loadStrictAuditRanges() {
  const p = join(root, AUDIT_FILE);
  if (!existsSync(p)) {
    console.log(`Strict audit report missing at ${p}; generating now...`);
    const gen = spawnSync(
      process.execPath,
      [join(root, "scripts", "audit-trading-calendar-gaps.mjs"), "--out", AUDIT_FILE],
      { stdio: "inherit", cwd: root, env: { ...process.env, NODE_OPTIONS: "" } }
    );
    if (gen.status !== 0) {
      throw new Error(`Failed to generate strict audit report (${gen.status ?? "unknown"})`);
    }
  }

  const raw = JSON.parse(readFileSync(p, "utf8"));
  const symbols = Array.isArray(raw?.symbols) ? raw.symbols : [];
  const map = new Map();
  for (const s of symbols) {
    const symbol = String(s?.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    const missingRanges = Array.isArray(s?.missingRanges) ? s.missingRanges : [];
    const ranges = missingRanges
      .map((r) => ({ from: String(r?.from ?? ""), to: String(r?.to ?? "") }))
      .filter((r) => r.from && r.to && r.from <= r.to);
    if (ranges.length > 0) map.set(symbol, normalizeRanges(ranges));
  }
  return map;
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
  const strictRangesBySymbol = STRICT_CALENDAR ? loadStrictAuditRanges() : new Map();

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

    if (STRICT_CALENDAR) {
      const strictRanges = strictRangesBySymbol.get(symbol) ?? [];
      if (strictRanges.length > 0) {
        ranges.push(...strictRanges);
        reasons.push(`strict missing trading days (${strictRanges.length} ranges)`);
      }
    }

    const normalizedRanges = normalizeRanges(ranges);
    if (normalizedRanges.length > 0) {
      workItems.push({ symbol, ranges: normalizedRanges, reasons });
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
  if (STRICT_CALENDAR) {
    console.log(`Strict calendar mode enabled (audit file: ${AUDIT_FILE}).\n`);
  }

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
  let rangesSkippedResume = 0;

  const allWork = [...etfWork, ...stockWork];
  const fingerprint = workFingerprint(allWork, STRICT_CALENDAR);

  if (FRESH) {
    removeProgressFile();
    console.log("Phase 3: --fresh — cleared resume checkpoint.\n");
  }

  let { completed } = FRESH ? { completed: new Set() } : loadProgress(fingerprint);
  if (!FRESH && completed.size > 0) {
    console.log(
      `Resume: ${completed.size} range(s) already done (checkpoint matches this work queue). Use --fresh to restart Phase 3 from scratch.\n`
    );
  }

  for (let i = 0; i < allWork.length; i++) {
    const { symbol, ranges } = allWork[i];
    let symbolBars = 0;
    let http403Ranges = 0;
    let otherErrors = 0;

    for (const range of ranges) {
      const key = rangeKey(symbol, range.from, range.to);
      if (completed.has(key)) {
        rangesSkippedResume++;
        continue;
      }

      try {
        const { bars, status } = await fetchDailyBars(symbol, range.from, range.to);
        if (status === 403) http403Ranges++;
        if (bars.length > 0) {
          insertMany(bars, symbol);
          symbolBars += bars.length;
        }
        apiCalls++;
        completed.add(key);
      } catch (e) {
        otherErrors++;
        console.warn(`  ${symbol} [${range.from} -> ${range.to}]: ${e.message}`);
      }
      await sleep(API_DELAY_MS);
    }

    /* One checkpoint file per symbol: durable progress without 29k tiny writes. */
    saveProgress(fingerprint, completed);

    if ((i + 1) % WAL_CHECKPOINT_EVERY_SYMBOLS === 0) {
      try {
        db.pragma("wal_checkpoint(PASSIVE)");
      } catch {
        /* ignore */
      }
    }

    totalInserted += symbolBars;
    const pct = (((i + 1) / allWork.length) * 100).toFixed(1);
    const parts = [];
    if (symbolBars > 0) parts.push(`+${symbolBars} bars`);
    if (http403Ranges > 0) parts.push(`${http403Ranges}×403`);
    if (otherErrors > 0) parts.push(`${otherErrors} err`);
    const suffix = parts.length ? ` (${parts.join(", ")})` : "";
    if (symbolBars > 0 || http403Ranges > 0 || otherErrors > 0) {
      console.log(`  [${pct}%] ${symbol}${suffix}`);
    } else {
      process.stdout.write(`  [${pct}%] ${symbol}: no new bars\r`);
    }
  }

  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* ignore */
  }

  removeProgressFile();

  console.log(`\nBackfill complete: ${totalInserted} bars inserted across ${allWork.length} symbols (${apiCalls} API calls).`);
  if (rangesSkippedResume > 0) {
    console.log(`Skipped ${rangesSkippedResume} range(s) from resume checkpoint (no refetch).`);
  }

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

    console.log("Recomputing market aggregates...");
    const aggs = spawnSync(
      process.execPath,
      [join(root, "scripts", "compute-market-aggregates.mjs")],
      { stdio: "inherit", cwd: root, env: { ...process.env, NODE_OPTIONS: "" } }
    );
    if (aggs.status !== 0) {
      console.error("compute-market-aggregates exited with", aggs.status);
      process.exit(aggs.status ?? 1);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
