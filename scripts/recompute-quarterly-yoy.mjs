#!/usr/bin/env node
/**
 * Recompute and persist quarterly YoY growth (EPS + revenue) in the financials table.
 *
 * Why: historical DBs stored quarter-over-quarter (sequential) growth in
 * eps_growth_yoy / sales_growth_yoy for quarterly rows instead of true
 * year-on-year (same fiscal quarter, prior year). This rewrites those columns
 * using the canonical fiscal-aware helper (scripts/_financial-growth.mjs):
 * fiscal_period + fiscal_year match when present, otherwise same MM-DD in the
 * prior calendar year, otherwise the nearest quarter within ±14 days.
 *
 * Annual rows are left untouched (annual YoY is already correct).
 *
 * Run:
 *   node scripts/recompute-quarterly-yoy.mjs               # offline recompute from existing DB
 *   node scripts/recompute-quarterly-yoy.mjs --with-fiscal # backfill fiscal_period/year from Polygon first
 *   node scripts/recompute-quarterly-yoy.mjs --dry-run     # report changes without writing
 *   node scripts/recompute-quarterly-yoy.mjs --limit 100   # only first N symbols (testing)
 *
 * Requires: data/screener.db. --with-fiscal additionally requires MASSIVE_API_KEY.
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { dbPath as DB_PATH, root } from "./_db-paths.mjs";
import { computeQuarterlyYoYGrowth } from "./_financial-growth.mjs";

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

const DRY_RUN = process.argv.includes("--dry-run");
const WITH_FISCAL = process.argv.includes("--with-fiscal");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : null;

const API_KEY = process.env.MASSIVE_API_KEY;
const BASE = "https://api.polygon.io";
function url(path, params = {}) {
  const search = new URLSearchParams({ ...params, apiKey: API_KEY });
  return `${BASE}${path}?${search}`;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchQuarterlyFiscal(symbol) {
  const res = await fetch(
    url("/stocks/financials/v1/income-statements", {
      tickers: symbol,
      "timeframe.any_of": "quarterly",
      limit: "50",
      sort: "period_end.desc",
    })
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results = data.results ?? [];
  return results.map((row) => ({
    period_end: row.period_end ?? "",
    fiscal_period:
      typeof row.fiscal_period === "string" && row.fiscal_period.trim() ? row.fiscal_period.trim() : null,
    fiscal_year:
      row.fiscal_year != null && Number.isFinite(Number(row.fiscal_year)) ? Number(row.fiscal_year) : null,
  }));
}

function ensureFiscalColumns(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(financials)").all().map((r) => r.name));
  if (!cols.has("fiscal_period")) db.exec("ALTER TABLE financials ADD COLUMN fiscal_period TEXT");
  if (!cols.has("fiscal_year")) db.exec("ALTER TABLE financials ADD COLUMN fiscal_year INTEGER");
}

const approxEq = (a, b) => a == null && b == null ? true : a != null && b != null && Math.abs(a - b) < 1e-6;

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Missing screener DB at ${DB_PATH}`);
    process.exit(1);
  }
  if (WITH_FISCAL && !API_KEY) {
    console.error("--with-fiscal requires MASSIVE_API_KEY.");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");
  ensureFiscalColumns(db);

  let symbols = db
    .prepare("SELECT DISTINCT symbol FROM financials WHERE period_type = 'quarterly' ORDER BY symbol")
    .all()
    .map((r) => r.symbol);
  if (LIMIT != null && LIMIT > 0) {
    symbols = symbols.slice(0, LIMIT);
    console.log("Limiting to", LIMIT, "symbols");
  }
  console.log(`Recomputing quarterly YoY for ${symbols.length} symbols${DRY_RUN ? " (dry run)" : ""}...`);

  // Optional: backfill fiscal_period/fiscal_year from Polygon so fiscal-aware matching can fire.
  if (WITH_FISCAL) {
    console.log("Backfilling fiscal_period/fiscal_year from Polygon...");
    const updFiscal = db.prepare(
      "UPDATE financials SET fiscal_period = ?, fiscal_year = ? WHERE symbol = ? AND period_type = 'quarterly' AND period_end = ?"
    );
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      try {
        const rows = await fetchQuarterlyFiscal(sym);
        const tx = db.transaction((list) => {
          for (const r of list) {
            if (!r.period_end) continue;
            updFiscal.run(r.fiscal_period, r.fiscal_year, sym, r.period_end);
          }
        });
        if (!DRY_RUN) tx(rows);
      } catch (e) {
        console.warn("  fiscal skip", sym, e.message);
      }
      if ((i + 1) % 100 === 0 || i === symbols.length - 1) {
        process.stdout.write(`  fiscal: ${i + 1}/${symbols.length}\r`);
      }
      await sleep(150);
    }
    process.stdout.write("\n");
  }

  const selectRows = db.prepare(
    `SELECT period_end, eps, eps_growth_yoy, sales, sales_growth_yoy, fiscal_period, fiscal_year
     FROM financials WHERE symbol = ? AND period_type = 'quarterly'`
  );
  const updGrowth = db.prepare(
    "UPDATE financials SET eps_growth_yoy = ?, sales_growth_yoy = ? WHERE symbol = ? AND period_type = 'quarterly' AND period_end = ?"
  );

  let rowsScanned = 0;
  let epsChanged = 0;
  let salesChanged = 0;
  let epsNowSet = 0;
  let salesNowSet = 0;
  const samples = [];

  const applyForSymbol = db.transaction((sym) => {
    const rows = selectRows.all(sym);
    // Shape expected by computeQuarterlyYoYGrowth: { period_end, fiscal_period, fiscal_year, eps, revenue }.
    const series = rows.map((r) => ({
      period_end: r.period_end,
      fiscal_period: r.fiscal_period ?? null,
      fiscal_year: r.fiscal_year ?? null,
      eps: r.eps ?? null,
      revenue: r.sales ?? null,
    }));
    for (const r of rows) {
      rowsScanned++;
      const current = series.find((s) => s.period_end === r.period_end);
      const { epsGrowth, salesGrowth } = computeQuarterlyYoYGrowth(current, series);
      const epsDiff = !approxEq(epsGrowth, r.eps_growth_yoy);
      const salesDiff = !approxEq(salesGrowth, r.sales_growth_yoy);
      if (epsDiff) {
        epsChanged++;
        if (r.eps_growth_yoy == null && epsGrowth != null) epsNowSet++;
      }
      if (salesDiff) {
        salesChanged++;
        if (r.sales_growth_yoy == null && salesGrowth != null) salesNowSet++;
      }
      if ((epsDiff || salesDiff) && samples.length < 12) {
        samples.push(
          `${sym} ${r.period_end} eps ${fmt(r.eps_growth_yoy)}→${fmt(epsGrowth)}  sales ${fmt(r.sales_growth_yoy)}→${fmt(salesGrowth)}`
        );
      }
      if (!DRY_RUN && (epsDiff || salesDiff)) {
        updGrowth.run(epsGrowth, salesGrowth, sym, r.period_end);
      }
    }
  });

  for (let i = 0; i < symbols.length; i++) {
    applyForSymbol(symbols[i]);
    if ((i + 1) % 500 === 0 || i === symbols.length - 1) {
      process.stdout.write(`  recompute: ${i + 1}/${symbols.length}\r`);
    }
  }
  process.stdout.write("\n");

  if (!DRY_RUN) db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  db.close();

  console.log(`\nDone${DRY_RUN ? " (dry run — no writes)" : ""}.`);
  console.log(`  quarterly rows scanned:      ${rowsScanned}`);
  console.log(`  eps_growth_yoy changed:      ${epsChanged} (newly set from null: ${epsNowSet})`);
  console.log(`  sales_growth_yoy changed:    ${salesChanged} (newly set from null: ${salesNowSet})`);
  if (samples.length) {
    console.log("  sample changes:");
    for (const s of samples) console.log("   ", s);
  }
}

function fmt(x) {
  return x == null ? "null" : Number(x).toFixed(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
