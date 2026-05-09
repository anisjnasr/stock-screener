#!/usr/bin/env node
/**
 * Precompute constituent-level perf rows used by Industries chevron expansion.
 *
 * Populates `industry_constituents_perf_cache` for the latest trading date so
 * UI expand calls are lookup-only (no runtime perf calculations).
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";

const MAX_CONSTITUENTS = 1500;

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

function normalizeSymbols(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const sym = String(raw ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]*$/.test(sym)) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

function parseIndustryRows() {
  const src = readFileSync(join(root, "src", "lib", "industry-etf-universe.ts"), "utf8");
  const rows = [];
  const re = /^\s*"([^"]+)":\s*"([A-Z]+)"/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    rows.push({
      name: String(m[1]),
      ticker: String(m[2]).toUpperCase(),
      drillKind: "industry",
      drillValue: String(m[1]),
    });
  }
  return rows;
}

function parseThematicRows() {
  const src = readFileSync(join(root, "src", "lib", "thematic-etfs.ts"), "utf8");
  const rows = [];
  const re = /\{\s*id:\s*"([^"]+)",\s*category:\s*"[^"]*",\s*theme:\s*"([^"]+)",\s*ticker:\s*"([A-Z]+)"\s*\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    rows.push({
      name: String(m[2]),
      ticker: String(m[3]).toUpperCase(),
      drillKind: "theme",
      drillValue: String(m[1]),
    });
  }
  return rows;
}

function loadThematicConstituentsMap() {
  const file = join(root, "data", "thematic-etf-constituents.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const out = {};
    for (const [key, value] of Object.entries(parsed ?? {})) {
      out[String(key).toUpperCase()] = normalizeSymbols(value);
    }
    return out;
  } catch {
    return {};
  }
}

function buildUniverseRows() {
  const industryRows = parseIndustryRows();
  const industryTickers = new Set(industryRows.map((r) => r.ticker));
  const thematicRows = parseThematicRows().filter((r) => !industryTickers.has(r.ticker));
  return [...industryRows, ...thematicRows].sort((a, b) => a.name.localeCompare(b.name));
}

function queryIndustrySymbols(db, industryName, asOfDate) {
  const rows = db
    .prepare(
      `
      SELECT c.symbol AS symbol
      FROM companies c
      WHERE c.industry = ?
        AND IFNULL(c.is_etf, 0) = 0
        AND EXISTS (SELECT 1 FROM daily_bars d WHERE d.symbol = c.symbol AND d.date = ?)
      ORDER BY c.symbol
      LIMIT ?
      `
    )
    .all(industryName, asOfDate, MAX_CONSTITUENTS);
  return rows.map((r) => String(r.symbol).toUpperCase());
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function main() {
  loadEnvLocal();
  if (!existsSync(DB_PATH)) {
    console.error(`Missing screener DB at ${DB_PATH}.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("cache_size = -64000");
  db.pragma("busy_timeout = 10000");

  const asOfDate = String(
    db.prepare("SELECT MAX(date) AS d FROM daily_bars WHERE date <= date('now')").get()?.d ?? ""
  );
  if (!asOfDate) {
    console.error("No latest trading date in daily_bars.");
    db.close();
    process.exit(1);
  }

  const asOf = new Date(`${asOfDate}T00:00:00Z`);
  const yearStart = `${asOf.getUTCFullYear()}-01-01`;

  db.exec(`
    CREATE TABLE IF NOT EXISTS industry_constituents_perf_cache (
      as_of_date TEXT NOT NULL,
      etf_ticker TEXT NOT NULL,
      drill_kind TEXT NOT NULL,
      drill_value TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      perf_day REAL,
      perf_week REAL,
      perf_month REAL,
      perf_quarter REAL,
      perf_half_year REAL,
      perf_year REAL,
      perf_ytd REAL,
      PRIMARY KEY (as_of_date, etf_ticker, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_icpc_lookup ON industry_constituents_perf_cache (as_of_date, etf_ticker);
  `);

  db.prepare("DELETE FROM industry_constituents_perf_cache WHERE as_of_date = ?").run(asOfDate);

  const dayMap = new Map();
  for (const r of db.prepare("SELECT symbol, change_pct FROM quote_daily WHERE date = ?").all(asOfDate)) {
    dayMap.set(String(r.symbol).toUpperCase(), r.change_pct != null ? Number(r.change_pct) : null);
  }

  const indMap = new Map();
  for (const r of db
    .prepare(
      `
      SELECT
        symbol,
        price_change_1w_pct,
        price_change_1m_pct,
        price_change_3m_pct,
        price_change_6m_pct,
        price_change_12m_pct
      FROM indicators_daily
      WHERE date = ?
      `
    )
    .all(asOfDate)) {
    indMap.set(String(r.symbol).toUpperCase(), {
      week: r.price_change_1w_pct != null ? Number(r.price_change_1w_pct) : null,
      month: r.price_change_1m_pct != null ? Number(r.price_change_1m_pct) : null,
      quarter: r.price_change_3m_pct != null ? Number(r.price_change_3m_pct) : null,
      half_year: r.price_change_6m_pct != null ? Number(r.price_change_6m_pct) : null,
      year: r.price_change_12m_pct != null ? Number(r.price_change_12m_pct) : null,
    });
  }

  const latestCloseMap = new Map();
  for (const r of db.prepare("SELECT symbol, close FROM daily_bars WHERE date = ?").all(asOfDate)) {
    latestCloseMap.set(String(r.symbol).toUpperCase(), Number(r.close));
  }
  const firstYtdCloseMap = new Map();
  for (const r of db
    .prepare(
      `
      WITH first_dates AS (
        SELECT symbol, MIN(date) AS first_date
        FROM daily_bars
        WHERE date >= ? AND date <= ?
        GROUP BY symbol
      )
      SELECT f.symbol, d.close AS first_close
      FROM first_dates f
      INNER JOIN daily_bars d ON d.symbol = f.symbol AND d.date = f.first_date
      `
    )
    .all(yearStart, asOfDate)) {
    firstYtdCloseMap.set(String(r.symbol).toUpperCase(), Number(r.first_close));
  }

  const thematicConstituents = loadThematicConstituentsMap();
  const universeRows = buildUniverseRows();

  const etfToSymbols = new Map();
  const allSymbols = new Set();
  for (const row of universeRows) {
    const symbols =
      row.drillKind === "industry"
        ? queryIndustrySymbols(db, row.name, asOfDate)
        : (thematicConstituents[row.ticker] ?? []).slice(0, MAX_CONSTITUENTS);
    etfToSymbols.set(row.ticker, symbols);
    for (const sym of symbols) allSymbols.add(sym);
  }

  const nameBySymbol = new Map();
  for (const chunk of chunkArray([...allSymbols], 500)) {
    if (chunk.length === 0) continue;
    const ph = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT symbol, name FROM companies WHERE symbol IN (${ph})`)
      .all(...chunk);
    for (const r of rows) {
      const sym = String(r.symbol).toUpperCase();
      const name = r.name != null ? String(r.name) : sym;
      nameBySymbol.set(sym, name);
    }
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO industry_constituents_perf_cache (
      as_of_date, etf_ticker, drill_kind, drill_value, symbol, name,
      perf_day, perf_week, perf_month, perf_quarter, perf_half_year, perf_year, perf_ytd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const row of universeRows) {
      const symbols = etfToSymbols.get(row.ticker) ?? [];
      for (const sym of symbols) {
        const latestClose = latestCloseMap.get(sym);
        const ytdStartClose = firstYtdCloseMap.get(sym);
        const perfYtd =
          latestClose != null &&
          ytdStartClose != null &&
          Number.isFinite(latestClose) &&
          Number.isFinite(ytdStartClose) &&
          ytdStartClose > 0
            ? ((latestClose - ytdStartClose) * 100) / ytdStartClose
            : null;
        const i = indMap.get(sym) ?? {};
        upsert.run(
          asOfDate,
          row.ticker,
          row.drillKind,
          row.drillValue,
          sym,
          nameBySymbol.get(sym) ?? sym,
          dayMap.get(sym) ?? null,
          i.week ?? null,
          i.month ?? null,
          i.quarter ?? null,
          i.half_year ?? null,
          i.year ?? null,
          perfYtd
        );
        inserted++;
      }
    }
  });
  tx();

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  console.log(
    `Precomputed industry constituents perf cache for ${asOfDate}: ${inserted} rows across ${universeRows.length} ETFs/themes.`
  );
}

main();
