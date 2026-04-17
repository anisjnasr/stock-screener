#!/usr/bin/env node
/**
 * Standalone diagnostic for premarket-movers-refactor.md (does not import app TS / no build impact).
 *
 * 1) One GET to full-market snapshot (no tickers= filter).
 * 2) Optional join against local screener.db (same env as the app: MASSIVE_API_KEY, SCREENER_DB_PATH).
 * 3) Prints field coverage + timing + sample top movers (logic mirrors the markdown).
 *
 * Run (RTH or premarket):
 *   node --env-file=.env.local scripts/test-premarket-movers-refactor.mjs
 */

import { existsSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function resolveDbPath() {
  const envPath = process.env.SCREENER_DB_PATH?.trim();
  if (envPath) return isAbsolute(envPath) ? envPath : resolve(root, envPath);
  const dataDir =
    resolveMaybeAbsolute(process.env.SCREENER_DATA_DIR, root) ?? join(root, "data");
  return join(dataDir, "screener.db");
}

function resolveMaybeAbsolute(pathValue, baseDir) {
  if (!pathValue) return null;
  const raw = String(pathValue).trim();
  if (!raw) return null;
  return isAbsolute(raw) ? raw : resolve(baseDir, raw);
}

const BASE = "https://api.polygon.io";
const EFFECTIVE_MARKET_CAP_SQL =
  "COALESCE(q.market_cap, c.shares_outstanding * COALESCE(q.last_price, q.prev_close))";

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchFullMarketSnapshot(apiKey) {
  const url = `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Snapshot HTTP ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  if (data.status && data.status !== "OK" && data.status !== "DELAYED") {
    throw new Error(`Snapshot status: ${data.status}`);
  }
  return data.tickers ?? [];
}

function loadScreenerMap(dbPath) {
  if (!existsSync(dbPath)) return { map: null, date: null, error: `missing file: ${dbPath}` };
  const db = new Database(dbPath, { readonly: true });
  try {
    const dateRow = db.prepare("SELECT MAX(date) AS d FROM quote_daily").get();
    const date = dateRow?.d ? String(dateRow.d) : null;
    if (!date) return { map: new Map(), date: null, error: "no quote_daily date" };
    const sql = `
      SELECT c.symbol, c.name, c.sector, c.industry,
        ${EFFECTIVE_MARKET_CAP_SQL} AS market_cap,
        COALESCE(i.avg_volume_1m, 0) AS avg_volume_1m
      FROM companies c
      INNER JOIN quote_daily q ON q.symbol = c.symbol AND q.date = ?
      LEFT JOIN indicators_daily i ON i.symbol = c.symbol AND i.date = q.date
    `;
    const rows = db.prepare(sql).all(date);
    const map = new Map();
    for (const r of rows) {
      const sym = String(r.symbol ?? "").toUpperCase();
      map.set(sym, {
        symbol: sym,
        name: r.name ?? undefined,
        sector: r.sector ?? undefined,
        industry: r.industry ?? undefined,
        marketCap: num(r.market_cap) ?? 0,
        avgVolume: num(r.avg_volume_1m) ?? 0,
      });
    }
    return { map, date, error: null };
  } finally {
    db.close();
  }
}

function buildMovers(snapshot, screenerByTicker, filters) {
  const movers = [];
  for (const row of snapshot) {
    const ticker = String(row.ticker ?? "").toUpperCase();
    const price = num(row.min?.c);
    const prevClose = num(row.prevDay?.c);
    const pmVolume = num(row.day?.v) ?? 0;
    if (price == null || price <= 0 || prevClose == null || prevClose <= 0) continue;
    const screener = screenerByTicker.get(ticker);
    if (!screener) continue;
    const marketCap = screener.marketCap ?? 0;
    const avgVolume = screener.avgVolume ?? 0;
    if (marketCap <= 0) continue;
    const gapPct = ((price - prevClose) / prevClose) * 100;
    const volRatio = avgVolume > 0 ? pmVolume / avgVolume : 0;
    movers.push({
      ticker,
      name: screener.name,
      price,
      prevClose,
      gapPct,
      pmVolume,
      avgVolume,
      marketCap,
      volRatio,
      sector: screener.sector,
      industry: screener.industry,
    });
  }
  movers.sort((a, b) => b.gapPct - a.gapPct);
  const eligibleNow = movers.filter(
    (m) =>
      m.price >= filters.minPrice &&
      m.gapPct >= filters.minGapPct &&
      m.pmVolume >= filters.minPmVolume &&
      m.avgVolume >= filters.minAvgVolume &&
      m.marketCap >= filters.minMarketCap
  );
  return { movers, eligibleNow };
}

function coverageStats(tickers) {
  let n = 0;
  let hasPrevC = 0;
  let hasMinC = 0;
  let hasDayV = 0;
  let hasLastTradeP = 0;
  let hasLastQuote = 0;
  let joinReady = 0;
  for (const row of tickers) {
    n++;
    const prevC = num(row.prevDay?.c);
    const minC = num(row.min?.c);
    const dayV = num(row.day?.v);
    const ltp = num(row.lastTrade?.p);
    const bid = num(row.lastQuote?.p);
    const ask = num(row.lastQuote?.P);
    if (prevC != null && prevC > 0) hasPrevC++;
    if (minC != null && minC > 0) hasMinC++;
    if (dayV != null && dayV > 0) hasDayV++;
    if (ltp != null && ltp > 0) hasLastTradeP++;
    if ((bid != null && bid > 0) || (ask != null && ask > 0)) hasLastQuote++;
    if (prevC != null && prevC > 0 && minC != null && minC > 0) joinReady++;
  }
  return { n, hasPrevC, hasMinC, hasDayV, hasLastTradeP, hasLastQuote, joinReady };
}

const apiKey = process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY;
if (!apiKey) {
  console.error("Set MASSIVE_API_KEY or POLYGON_API_KEY (e.g. node --env-file=.env.local …)");
  process.exit(1);
}

const filters = {
  minPrice: 5,
  minGapPct: 3,
  minPmVolume: 50_000,
  minAvgVolume: 500_000,
  minMarketCap: 500_000_000,
};

const dbPath = resolveDbPath();

console.log("premarket-movers-refactor test —", new Date().toISOString());
console.log("DB path:", dbPath, existsSync(dbPath) ? "(exists)" : "(missing — join step skipped)");

const t0 = Date.now();
const snapshot = await fetchFullMarketSnapshot(apiKey);
const fetchMs = Date.now() - t0;

const cov = coverageStats(snapshot);
console.log("\n--- Snapshot field coverage ---");
console.log(JSON.stringify({ ...cov, fetchMs }, null, 2));

const tDb = Date.now();
const { map: screenerMap, date: screenerDate, error: dbErr } = loadScreenerMap(dbPath);
const dbMs = Date.now() - tDb;

if (dbErr) {
  console.log("\n--- DB ---");
  console.log("warning:", dbErr);
}

if (screenerMap) {
  console.log("\n--- Screener join ---");
  console.log({ screenerDate, screenerRows: screenerMap.size, dbLoadMs: dbMs });

  const tBuild = Date.now();
  const { movers, eligibleNow } = buildMovers(snapshot, screenerMap, filters);
  const buildMs = Date.now() - tBuild;

  console.log("\n--- buildMovers (markdown logic) ---");
  console.log(
    JSON.stringify(
      {
        snapshotTickerCount: snapshot.length,
        moversCount: movers.length,
        eligibleCount: eligibleNow.length,
        filters,
        buildMs,
        totalElapsedMs: fetchMs + dbMs + buildMs,
      },
      null,
      2
    )
  );

  console.log("\nTop 8 by gapPct (after join, before strict filters):");
  console.table(movers.slice(0, 8).map((m) => ({ ticker: m.ticker, gapPct: +m.gapPct.toFixed(2), price: m.price, pmVolume: m.pmVolume, avgVol: m.avgVolume })));

  if (eligibleNow.length > 0) {
    console.log("\nTop 5 eligibleNow (all filters):");
    console.table(
      eligibleNow.slice(0, 5).map((m) => ({
        ticker: m.ticker,
        gapPct: +m.gapPct.toFixed(2),
        pmVolume: m.pmVolume,
        mktCap: m.marketCap,
      }))
    );
  } else {
    console.log("\n(eligibleNow empty at these thresholds — expected off-hours or strict filters.)");
  }
} else {
  console.log("\nNo DB map — only snapshot coverage was validated.");
}

console.log("\nDone.");
