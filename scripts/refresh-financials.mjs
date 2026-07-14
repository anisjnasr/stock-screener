#!/usr/bin/env node
/**
 * Quarterly refresh: fetch income statements from Polygon, upsert financials table.
 * Run: node scripts/refresh-financials.mjs [--limit N]  or  npm run refresh-financials
 * Requires: MASSIVE_API_KEY, data/screener.db
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";
import {
  computeAnnualYoYGrowth,
  computeQuarterlyYoYGrowth,
} from "./_financial-growth.mjs";

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
  console.error("Missing MASSIVE_API_KEY.");
  process.exit(1);
}

const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : null;

const BASE = "https://api.polygon.io";
function url(path, params = {}) {
  const search = new URLSearchParams({ ...params, apiKey: API_KEY });
  return `${BASE}${path}?${search}`;
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
    fiscal_period: row.fiscal_period ?? null,
    fiscal_year:
      row.fiscal_year != null && Number.isFinite(Number(row.fiscal_year))
        ? Number(row.fiscal_year)
        : null,
    revenue: row.revenue,
    net_income: row.consolidated_net_income_loss,
    eps: row.diluted_earnings_per_share ?? row.basic_earnings_per_share,
  }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Yahoo Finance fallback (for ADRs / foreign filers Polygon doesn't cover) ----
let _yf = null;
async function getYahoo() {
  if (_yf) return _yf;
  const YahooFinance = (await import("yahoo-finance2")).default;
  _yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  return _yf;
}

function yfToIso(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}
function yfNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && typeof v.raw === "number") return Number.isFinite(v.raw) ? v.raw : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch income statements from Yahoo Finance in the same shape as the Polygon
 * fetcher: { period_end, fiscal_period, fiscal_year, revenue, eps }.
 *
 * Uses `fundamentalsTimeSeries` (module: "financials") — Yahoo's supported
 * time-series API, which returns revenue and diluted/basic EPS with multiple
 * years of history (enough for YoY). The older quoteSummary income-statement
 * submodules have been unreliable since late 2024. fiscal_period is left null
 * (Yahoo has no fiscal tags), so YoY matching falls back to period_end dates.
 */
async function fetchTimeSeries(yf, symbol, type, period1) {
  try {
    const res = await yf.fundamentalsTimeSeries(symbol, { period1, type, module: "financials" });
    return (res ?? [])
      .map((r) => {
        const period_end = yfToIso(r?.date);
        if (!period_end) return null;
        const revenue = yfNum(r?.totalRevenue);
        const eps = yfNum(r?.dilutedEPS) ?? yfNum(r?.basicEPS);
        if (revenue == null && eps == null) return null;
        return {
          period_end,
          fiscal_period: null,
          fiscal_year: Number(period_end.slice(0, 4)) || null,
          revenue,
          eps,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchIncomeStatementYahoo(yf, symbol) {
  const period1 = new Date();
  period1.setUTCFullYear(period1.getUTCFullYear() - 11);
  const from = period1.toISOString().slice(0, 10);
  const [annual, quarterly] = await Promise.all([
    fetchTimeSeries(yf, symbol, "annual", from),
    fetchTimeSeries(yf, symbol, "quarterly", from),
  ]);
  return { annual, quarterly };
}

const rowsHaveData = (rows) => rows.some((r) => r.eps != null || r.revenue != null);

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
  db.pragma("busy_timeout = 10000");

  const finCols = new Set(db.prepare("PRAGMA table_info(financials)").all().map((r) => r.name));
  if (!finCols.has("fiscal_period")) db.exec("ALTER TABLE financials ADD COLUMN fiscal_period TEXT");
  if (!finCols.has("fiscal_year")) db.exec("ALTER TABLE financials ADD COLUMN fiscal_year INTEGER");

  let symbols = db.prepare("SELECT symbol FROM companies ORDER BY symbol").all().map((r) => r.symbol);
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO financials (symbol, period_type, period_end, eps, eps_growth_yoy, sales, sales_growth_yoy, fiscal_period, fiscal_year, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let yahooFilled = 0;
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      let [annual, quarterly] = await Promise.all([
        fetchIncomeStatement(sym, "annual"),
        fetchIncomeStatement(sym, "quarterly"),
      ]);

      // Fallback to Yahoo Finance for any timeframe Polygon doesn't cover
      // (common for ADRs / foreign private issuers filing 20-F). Only fetch
      // Yahoo when a whole timeframe is missing, so pre-revenue companies that
      // legitimately report EPS-without-revenue don't trigger needless lookups.
      const needAnnual = !rowsHaveData(annual);
      const needQuarterly = !rowsHaveData(quarterly);
      if (needAnnual || needQuarterly) {
        try {
          const yf = await getYahoo();
          const y = await fetchIncomeStatementYahoo(yf, sym);
          let used = false;
          if (needAnnual && rowsHaveData(y.annual)) {
            annual = y.annual;
            used = true;
          }
          if (needQuarterly && rowsHaveData(y.quarterly)) {
            quarterly = y.quarterly;
            used = true;
          }
          if (used) yahooFilled++;
        } catch {
          /* Yahoo lookup failed; leave Polygon result as-is. */
        }
      }

      for (let j = 0; j < annual.length; j++) {
        const row = annual[j];
        const prev = annual[j + 1];
        const { epsGrowth, salesGrowth } = computeAnnualYoYGrowth(row, prev);
        const annualFiscalYear =
          row.fiscal_year != null && Number.isFinite(Number(row.fiscal_year))
            ? Number(row.fiscal_year)
            : null;
        upsert.run(
          sym,
          "annual",
          row.period_end,
          row.eps ?? null,
          epsGrowth,
          row.revenue ?? null,
          salesGrowth,
          null,
          annualFiscalYear,
          now
        );
      }
      for (let j = 0; j < quarterly.length; j++) {
        const row = quarterly[j];
        const { epsGrowth, salesGrowth } = computeQuarterlyYoYGrowth(row, quarterly);
        const qFiscalYear =
          row.fiscal_year != null && Number.isFinite(Number(row.fiscal_year))
            ? Number(row.fiscal_year)
            : null;
        const qFiscalPeriod =
          typeof row.fiscal_period === "string" && row.fiscal_period.trim() ? row.fiscal_period.trim() : null;
        upsert.run(
          sym,
          "quarterly",
          row.period_end,
          row.eps ?? null,
          epsGrowth,
          row.revenue ?? null,
          salesGrowth,
          qFiscalPeriod,
          qFiscalYear,
          now
        );
      }
    } catch (e) {
      console.warn("Skip", sym, e.message);
    }
    if ((i + 1) % 100 === 0 || i === symbols.length - 1) {
      process.stdout.write(`  financials: ${i + 1}/${symbols.length}\r`);
    }
    await sleep(150);
  }

  db.pragma("optimize");
  db.close();
  console.log(`\nFinancials refresh done. Yahoo fallback filled ${yahooFilled} symbols Polygon didn't cover.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
