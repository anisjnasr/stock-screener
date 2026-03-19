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
    revenue: row.revenue,
    net_income: row.consolidated_net_income_loss,
    eps: row.diluted_earnings_per_share ?? row.basic_earnings_per_share,
  }));
}

function computeGrowth(current, prior) {
  if (prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  db.pragma("busy_timeout = 10000");

  let symbols = db.prepare("SELECT symbol FROM companies ORDER BY symbol").all().map((r) => r.symbol);
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO financials (symbol, period_type, period_end, eps, eps_growth_yoy, sales, sales_growth_yoy, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const [annual, quarterly] = await Promise.all([
        fetchIncomeStatement(sym, "annual"),
        fetchIncomeStatement(sym, "quarterly"),
      ]);

      for (let j = 0; j < annual.length; j++) {
        const row = annual[j];
        const prev = annual[j + 1];
        const epsGrowth = prev != null ? computeGrowth(row.eps, prev.eps) : null;
        const salesGrowth = prev != null ? computeGrowth(row.revenue, prev.revenue) : null;
        upsert.run(
          sym,
          "annual",
          row.period_end,
          row.eps ?? null,
          epsGrowth,
          row.revenue ?? null,
          salesGrowth,
          now
        );
      }
      for (let j = 0; j < quarterly.length; j++) {
        const row = quarterly[j];
        const prev = quarterly[j + 1];
        const epsGrowth = prev != null ? computeGrowth(row.eps, prev.eps) : null;
        const salesGrowth = prev != null ? computeGrowth(row.revenue, prev.revenue) : null;
        upsert.run(
          sym,
          "quarterly",
          row.period_end,
          row.eps ?? null,
          epsGrowth,
          row.revenue ?? null,
          salesGrowth,
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
  console.log("\nFinancials refresh done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
